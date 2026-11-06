"""Logging with secret redaction. Tokens and OAuth codes must never reach log files."""
from __future__ import annotations

import logging
import os
import re
import sys
from logging.handlers import RotatingFileHandler

_PATTERNS = [
    (re.compile(r"ya29\.[\w\-.]+"), "[REDACTED_ACCESS_TOKEN]"),
    (re.compile(r"1//[\w\-]{20,}"), "[REDACTED_REFRESH_TOKEN]"),
    (re.compile(r"(?i)(bearer\s+)[\w\-.~+/=]+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)([?&](?:code|state|access_token|refresh_token|upload_id|client_secret)=)[^&\s\"']+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)((?:refresh_token|client_secret|password|access_token)['\"]?\s*[:=]\s*['\"]?)[^\s,'\"}]+"), r"\1[REDACTED]"),
]


def redact(text: str) -> str:
    for pat, repl in _PATTERNS:
        text = pat.sub(repl, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact(record.getMessage())
            record.args = ()
        except Exception:  # never break logging
            pass
        return True


def setup_logging(service: str, log_dir: str | None = None, level: int = logging.INFO) -> None:
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s")
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)
    flt = RedactingFilter()
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    sh.addFilter(flt)
    root.addHandler(sh)
    if log_dir:
        try:
            os.makedirs(log_dir, exist_ok=True)
            fh = RotatingFileHandler(os.path.join(log_dir, f"{service}.log"), maxBytes=5_000_000, backupCount=5)
            fh.setFormatter(fmt)
            fh.addFilter(flt)
            root.addHandler(fh)
        except OSError:
            root.warning("Could not open log directory %s; logging to stdout only", log_dir)
    for noisy in ("googleapiclient.discovery_cache", "urllib3", "apscheduler.executors.default", "httpx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True
