import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronUp, FolderOpen, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onError } from "@/components/Common";
import { FileIcon } from "@/components/FileBits";
import { useAccounts } from "@/hooks/queries";
import { api } from "@/services/api";
import { queryClient } from "@/services/queryClient";
import { useUploads, type LocalItem } from "@/stores/uploads";
import type { UploadJob } from "@/types";
import { cn } from "@/utils/cn";
import { bytes } from "@/utils/format";
import { useMask } from "@/utils/privacy";

// Failures caused by the target account itself: retrying on the same account wouldn't help.
const ACCOUNT_PROBLEM = ["INSUFFICIENT_SPACE", "RULE_ACCOUNT_FULL", "NO_ACCOUNT_HAS_SPACE", "ACCOUNT_NEEDS_REAUTH", "ACCOUNT_REMOVED", "RULE_ACCOUNT_MISSING", "DESTINATION_INVALID"];
const STATE: Record<string, string> = { QUEUED: "Waiting…", VALIDATING: "Checking…", ALLOCATING: "Choosing account…", FINALIZING: "Finishing…" };

/** Progress ring for one item (0–100). */
function Ring({ pct }: { pct: number }) {
  const r = 8, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-primary transition-all"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)} />
    </svg>
  );
}

type Row =
  | { kind: "local"; item: LocalItem }
  | { kind: "job"; item: LocalItem; job: UploadJob | undefined };

/**
 * Google-Drive-style upload panel, bottom right. Lists uploads started in this browser session: files being sent to the
 * server, then the server's progress to Google. Stays until closed; ⌄ collapses it to the header.
 */
export function UploadPanel() {
  const m = useMask();
  const navigate = useNavigate();
  const { items, panelOpen, panelCollapsed, setCollapsed, closePanel, resend } = useUploads();
  const sessionIds = items.map((i) => i.jobId).filter(Boolean) as string[];
  const jobs = useQuery({
    queryKey: ["uploads", "list"], enabled: panelOpen && sessionIds.length > 0,
    queryFn: () => api.get<UploadJob[]>("/api/uploads?limit=100"),
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => sessionIds.includes(j.id) && !["COMPLETED", "FAILED", "CANCELLED"].includes(j.state)) ? 2000 : false),
  });
  const byId = new Map((jobs.data ?? []).map((j) => [j.id, j]));
  const rows: Row[] = items.map((it) => (it.status === "sent" ? { kind: "job", item: it, job: byId.get(it.jobId!) } : { kind: "local", item: it }));

  // Tell the toast area how tall the panel is, so notices stack above it instead of covering it.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const setH = (h: number) => document.documentElement.style.setProperty("--upload-panel-h", `${h}px`);
    if (!el) { setH(0); return; }
    const ro = new ResizeObserver(() => setH(el.offsetHeight + 8));
    ro.observe(el);
    return () => { ro.disconnect(); setH(0); };
  }, [panelOpen]);

  if (!panelOpen || rows.length === 0) return null;

  const status = (r: Row): "active" | "done" | "failed" | "cancelled" => {
    if (r.kind === "local") return r.item.status === "error" ? "failed" : "active";
    const st = r.job?.state;
    return st === "COMPLETED" ? "done" : st === "FAILED" ? "failed" : st === "CANCELLED" ? "cancelled" : "active";
  };
  const progress = (r: Row) => {
    if (r.kind === "local") return { done: r.item.sent, total: r.item.file.size };
    const j = r.job;
    return j ? { done: j.state === "COMPLETED" ? j.size : j.bytes_uploaded, total: j.size } : { done: 0, total: r.item.file.size };
  };
  const counts = rows.reduce((a, r) => ({ ...a, [status(r)]: a[status(r)] + 1 }), { active: 0, done: 0, failed: 0, cancelled: 0 });
  const totals = rows.filter((r) => status(r) !== "cancelled").reduce((a, r) => { const p = progress(r); return { done: a.done + p.done, total: a.total + p.total }; }, { done: 0, total: 0 });
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const title = counts.active > 0 ? `Uploading ${plural(counts.active, "item")} · ${pct}%`
    : counts.failed > 0 ? `${counts.done} complete, ${counts.failed} failed`
    : `${plural(counts.done, "upload")} complete`;

  const openFolder = (j: UploadJob) => {
    if (!j.account_id) return;
    const p = new URLSearchParams({ account: j.account_id });
    if (j.destination_folder_id) { p.set("folder", j.destination_folder_id); p.set("name", j.destination_folder_name ?? "Folder"); }
    navigate(`/files?${p}`);
  };

  return (
    <div ref={ref} role="region" aria-label="Uploads"
      className="fixed inset-x-0 bottom-0 z-50 overflow-hidden border-t bg-card shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96 sm:rounded-lg sm:border">
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-2.5">
        <p className="flex-1 truncate text-sm font-semibold" aria-live="polite">{title}</p>
        <button onClick={() => setCollapsed(!panelCollapsed)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={panelCollapsed ? "Expand" : "Collapse"}>
          {panelCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        <button onClick={closePanel} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close (uploads keep going)" title="Close. Uploads keep going">
          <X className="h-4 w-4" /></button>
      </div>
      {counts.active > 0 && <div className="h-0.5 bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>}
      {!panelCollapsed && (
        <ul className="max-h-72 divide-y overflow-y-auto">
          {rows.map((r) => <PanelRow key={r.item.key} row={r} status={status(r)} progress={progress(r)} m={m} onResend={() => resend(r.item.key)} onOpenFolder={openFolder} />)}
        </ul>)}
    </div>
  );
}

function PanelRow({ row, status, progress, m, onResend, onOpenFolder }: {
  row: Row; status: "active" | "done" | "failed" | "cancelled"; progress: { done: number; total: number };
  m: ReturnType<typeof useMask>; onResend: () => void; onOpenFolder: (j: UploadJob) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const name = row.kind === "job" && row.job ? row.job.filename : row.item.file.name;
  const mime = row.kind === "job" && row.job ? row.job.mime_type : row.item.file.type;
  const job = row.kind === "job" ? row.job : undefined;
  const reason = row.kind === "local" ? row.item.error : job?.error_message;
  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
  const detail = status === "active"
    ? row.kind === "local" ? (row.item.status === "waiting" ? "Waiting…" : `Sending to server · ${bytes(progress.done)} / ${bytes(progress.total)}`)
      : job && STATE[job.state] ? STATE[job.state] : `${bytes(progress.done)} / ${bytes(progress.total)}`
    : status === "cancelled" ? "Cancelled" : null;

  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <FileIcon mime={mime ?? ""} />
        <div className="min-w-0 flex-1">
          <p className="truncate" title={name}>{name}</p>
          {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
        </div>
        {status === "active" && <Ring pct={pct} />}
        {status === "done" && <><Check className="h-4 w-4 text-success" aria-label="Done" />
          {job && <button onClick={() => onOpenFolder(job)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Open folder" title="Show in Files"><FolderOpen className="h-4 w-4" /></button>}</>}
        {status === "failed" && <><AlertTriangle className="h-4 w-4 text-destructive" aria-label="Failed" />
          <button onClick={() => (row.kind === "local" ? onResend() : setChoosing(!choosing))} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Retry" title={row.kind === "local" ? "Send the file to the server again" : "Retry"}><RotateCcw className="h-4 w-4" /></button></>}
      </div>
      {status === "failed" && reason && <p className="ml-8 mt-1 text-xs text-destructive">{m.text(reason)}</p>}
      {choosing && job && <RetryChoices job={job} onDone={() => setChoosing(false)} />}
    </li>
  );
}

/** Retry choices for a failed server job: same account (when the problem isn't the account), or another connected account. */
function RetryChoices({ job, onDone }: { job: UploadJob; onDone: () => void }) {
  const m = useMask();
  const accounts = useAccounts();
  const track = useUploads((s) => s.track);
  const others = (accounts.data ?? []).filter((a) => a.status === "ACTIVE" && a.id !== job.account_id);
  const sameOk = !ACCOUNT_PROBLEM.includes(job.error_code ?? "");
  const retry = useMutation({
    mutationFn: (accountId?: string) => api.post<UploadJob>(`/api/uploads/${job.id}/retry`, accountId ? { account_id: accountId } : {}),
    onSuccess: (j) => { track(j); queryClient.invalidateQueries({ queryKey: ["uploads"] }); onDone(); },
    onError,
  });
  if (!sameOk && others.length === 0) return <p className="ml-8 mt-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">No other account available. Connect another account, or free up space on this one.</p>;
  return (
    <div className="ml-8 mt-1.5 space-y-1 rounded-md border p-1.5">
      {sameOk && <button disabled={retry.isPending} onClick={() => retry.mutate(undefined)} className="flex w-full items-center rounded px-2 py-1 text-left text-xs hover:bg-accent">Same account (try again)</button>}
      {others.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">No other account available.</p> : (
        <>
          <p className="px-2 pt-0.5 text-[11px] text-muted-foreground">Or upload to another account (My Drive):</p>
          {others.map((a) => {
            const free = a.quota?.free ?? null;
            const tooSmall = free != null && free < job.size;
            return (
              <button key={a.id} disabled={tooSmall || retry.isPending} onClick={() => retry.mutate(a.id)}
                className={cn("flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent")}>
                <span className="truncate">{m.email(a.email)}</span>
                <span className="shrink-0 text-muted-foreground">{tooSmall ? "not enough space" : free != null ? `${bytes(free)} free` : ""}</span>
              </button>);
          })}
        </>)}
    </div>
  );
}
