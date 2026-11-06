"""Background worker: scheduler (quota + sync), job dispatcher (uploads + syncs), housekeeping. One instance only."""
from __future__ import annotations

import fcntl
import logging
import os
import shutil
import signal
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select, update

from app.config import get_settings
from app.core.logging import setup_logging
from app.core.time import iso, utcnow
from app.database.database import session_scope
from app.database.models import Account, SyncJob, UploadJob
from app.database.repositories.settings import set_setting
from app.services import accounts, events, quota, sessions, sync, upload_runner

log = logging.getLogger("worker")
stop = threading.Event()
HEARTBEAT_FILE = "/tmp/worker_heartbeat"
SYNC_CONCURRENCY = 2


def heartbeat() -> None:
    with open(HEARTBEAT_FILE, "w") as f:
        f.write(str(time.time()))
    try:
        with session_scope() as db:
            set_setting(db, "worker_heartbeat", {"at": utcnow().isoformat(timespec="seconds"), "pid": os.getpid()})
    except Exception:
        log.warning("Heartbeat DB write failed", exc_info=True)


def wait_for_schema() -> None:
    for _ in range(120):
        try:
            with session_scope() as db:
                db.execute(select(SyncJob.id).limit(1))
                db.execute(select(UploadJob.id).limit(1))
            return
        except Exception:
            time.sleep(2)
    log.error("Database schema not ready after 4 minutes; exiting")
    sys.exit(1)


def recover() -> None:
    """After a crash/restart: resume interrupted work. Upload sessions resume from Google's recorded offset."""
    with session_scope() as db:
        n = db.execute(update(UploadJob).where(UploadJob.state.in_(["VALIDATING", "ALLOCATING", "UPLOADING", "FINALIZING"]))
                       .values(state="QUEUED")).rowcount
        m = db.execute(update(SyncJob).where(SyncJob.state == "RUNNING").values(state="QUEUED")).rowcount
        db.commit()
    if n or m:
        log.info("Recovered %d upload job(s) and %d sync job(s) interrupted by the last shutdown", n, m)


def enqueue_syncs() -> None:
    with session_scope() as db:
        for acc in db.scalars(select(Account).where(Account.status == "ACTIVE")):
            accounts.queue_sync(db, acc, "INCREMENTAL")


def refresh_quotas() -> None:
    with session_scope() as db:
        quota.refresh_all_active(db)


def housekeeping() -> None:
    s = get_settings()
    with session_scope() as db:
        events.prune(db)
        quota.prune(db)
        sessions.purge_expired(db)
        jobs_dir = os.path.join(s.staging_dir, "jobs")
        if os.path.isdir(jobs_dir):
            cutoff = utcnow() - timedelta(hours=s.staging_retention_hours)
            for name in os.listdir(jobs_dir):
                job = db.get(UploadJob, name)
                orphan = job is None
                done = job is not None and job.state in ("COMPLETED", "CANCELLED")
                stale = job is not None and job.state == "FAILED" and (job.finished_at or utcnow()) < cutoff
                if orphan and time.time() - os.path.getmtime(os.path.join(jobs_dir, name)) < 3600:
                    continue                     # may be mid-upload from the browser
                if orphan or done or stale:
                    shutil.rmtree(os.path.join(jobs_dir, name), ignore_errors=True)
                    log.info("Removed staging data for %s job %s", "orphan" if orphan else job.state.lower(), name)
        tmp = os.path.join(s.staging_dir, ".tmp")
        if os.path.isdir(tmp):
            for name in os.listdir(tmp):
                p = os.path.join(tmp, name)
                if time.time() - os.path.getmtime(p) > 86400:
                    shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else os.remove(p)


def _claim(model, ids: list[str], new_state: str) -> list[str]:
    claimed = []
    with session_scope() as db:
        for i in ids:
            if db.execute(update(model).where(model.id == i, model.state == "QUEUED").values(state=new_state)).rowcount == 1:
                claimed.append(i)
        db.commit()
    return claimed


def dispatch_loop(pool: ThreadPoolExecutor) -> None:
    s = get_settings()
    running: dict[str, tuple[str, Future]] = {}
    last_hb = 0.0
    while not stop.is_set():
        if time.time() - last_hb > 15:
            heartbeat()
            last_hb = time.time()
        for jid, (_, fut) in list(running.items()):
            if fut.done():
                running.pop(jid)
        up = sum(1 for k, _ in running.values() if k == "upload")
        sy = sum(1 for k, _ in running.values() if k == "sync")
        try:
            with session_scope() as db:
                up_ids = list(db.scalars(select(UploadJob.id).where(UploadJob.state == "QUEUED").order_by(UploadJob.created_at)
                                         .limit(max(s.upload_concurrency - up, 0))))
                sy_ids = list(db.scalars(select(SyncJob.id).where(SyncJob.state == "QUEUED").order_by(SyncJob.requested_at)
                                         .limit(max(SYNC_CONCURRENCY - sy, 0))))
            for i in _claim(UploadJob, up_ids, "VALIDATING"):
                running[i] = ("upload", pool.submit(upload_runner.run, i))
            for i in _claim(SyncJob, sy_ids, "RUNNING"):
                with session_scope() as db:
                    db.execute(update(SyncJob).where(SyncJob.id == i).values(started_at=utcnow()))
                    db.commit()
                running[i] = ("sync", pool.submit(sync.run_sync_job, i))
        except Exception:
            log.exception("Dispatcher error")
        stop.wait(2)


def main() -> None:
    s = get_settings()
    setup_logging("worker", s.log_dir)
    lock = open("/data/.worker.lock" if os.path.isdir("/data") else "/tmp/.worker.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.error("Another worker already holds the lock. Only one worker may run.")
        sys.exit(1)

    def _term(*_):
        log.info("Shutdown requested; finishing current chunks")
        stop.set()
        upload_runner.shutdown.set()

    signal.signal(signal.SIGTERM, _term)
    signal.signal(signal.SIGINT, _term)

    wait_for_schema()
    if not s.worker_enabled:
        log.warning("WORKER_ENABLED=false: worker is idle. Uploads and syncs will not run.")
        while not stop.is_set():
            heartbeat()
            stop.wait(30)
        return
    recover()
    sched = BackgroundScheduler(timezone="UTC", job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 120})
    sched.add_job(enqueue_syncs, "interval", minutes=s.sync_interval_minutes, id="sync")
    sched.add_job(refresh_quotas, "interval", minutes=s.quota_refresh_interval_minutes, id="quota")
    sched.add_job(housekeeping, "interval", hours=1, id="housekeeping")
    sched.add_job(refresh_quotas, id="quota-boot")
    sched.add_job(housekeeping, id="housekeeping-boot")
    sched.start()
    log.info("Worker started (uploads x%d, sync every %d min, quota every %d min)", s.upload_concurrency, s.sync_interval_minutes, s.quota_refresh_interval_minutes)
    pool = ThreadPoolExecutor(max_workers=s.upload_concurrency + SYNC_CONCURRENCY, thread_name_prefix="job")
    try:
        dispatch_loop(pool)
    finally:
        sched.shutdown(wait=False)
        pool.shutdown(wait=True, cancel_futures=True)
        log.info("Worker stopped")


if __name__ == "__main__":
    main()
