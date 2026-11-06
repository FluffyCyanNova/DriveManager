import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CloudUpload, FolderOpen, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { AccountChip, EmptyState, onError, PageHeader, Spinner } from "@/components/Common";
import { FolderPicker, type PickedFolder } from "@/components/FolderPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useAccounts } from "@/hooks/queries";
import { ApiError, api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { UploadJob } from "@/types";
import { cn } from "@/utils/cn";
import { bytes } from "@/utils/format";

interface Params { mode: "MANUAL" | "AUTO"; accountId: string; folder: PickedFolder | null }
interface Local { key: string; file: File; params: Params; sent: number; status: "waiting" | "sending" | "error"; error?: string }

const STATE: Record<string, string> = { QUEUED: "Waiting for the worker", VALIDATING: "Checking file", ALLOCATING: "Choosing account", UPLOADING: "Uploading to Google", FINALIZING: "Finishing up", COMPLETED: "Done", FAILED: "Failed", CANCELLED: "Cancelled" };
const SWITCHABLE = ["INSUFFICIENT_SPACE", "RULE_ACCOUNT_FULL", "NO_ACCOUNT_HAS_SPACE", "DESTINATION_INVALID", "ACCOUNT_NEEDS_REAUTH", "ACCOUNT_REMOVED", "RULE_ACCOUNT_MISSING"];

export default function Uploads() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => a.status === "ACTIVE");
  const [mode, setMode] = useState<"MANUAL" | "AUTO">("MANUAL");
  const [accountId, setAccountId] = useState("");
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  const [pickFolder, setPickFolder] = useState(false);
  const [drag, setDrag] = useState(false);
  const [local, setLocal] = useState<Local[]>([]);
  const queue = useRef<Local[]>([]);
  const running = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const [retrying, setRetrying] = useState<UploadJob | null>(null);

  const jobs = useQuery({ queryKey: ["uploads", "list"], queryFn: () => api.get<UploadJob[]>("/api/uploads?limit=100"), refetchInterval: (q) => ((q.state.data ?? []).some((j) => !["COMPLETED", "FAILED", "CANCELLED"].includes(j.state)) ? 3000 : 20000) });
  const effectiveAccount = accountId || active[0]?.id || "";

  const patch = (key: string, p: Partial<Local>) => setLocal((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const pump = () => {
    while (running.current < 2 && queue.current.length) {
      const it = queue.current.shift()!;
      running.current++;
      patch(it.key, { status: "sending" });
      const form = new FormData();
      form.append("mode", it.params.mode);
      if (it.params.mode === "MANUAL") form.append("account_id", it.params.accountId);
      if (it.params.folder?.id) { form.append("folder_id", it.params.folder.id); form.append("folder_name", it.params.folder.name); }
      form.append("file", it.file);
      api.upload("/api/uploads", form, (sent) => patch(it.key, { sent }))
        .then(() => { setLocal((l) => l.filter((x) => x.key !== it.key)); qc.invalidateQueries({ queryKey: ["uploads"] }); })
        .catch((e) => patch(it.key, { status: "error", error: e instanceof ApiError ? e.message : "Upload failed." }))
        .finally(() => { running.current--; pump(); });
    }
  };
  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    if (mode === "MANUAL" && !effectiveAccount) { toast.error("Connect an account first."); return; }
    const params: Params = { mode, accountId: effectiveAccount, folder: mode === "MANUAL" ? folder : null };
    const items = list.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, params, sent: 0, status: "waiting" as const }));
    queue.current.push(...items);
    setLocal((l) => [...l, ...items]);
    pump();
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); };

  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/api/uploads/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["uploads"] }), onError });
  const retry = useMutation({ mutationFn: (v: { id: string; account_id?: string }) => api.post(`/api/uploads/${v.id}/retry`, v.account_id ? { account_id: v.account_id } : {}), onSuccess: () => { setRetrying(null); qc.invalidateQueries({ queryKey: ["uploads"] }); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/uploads/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["uploads"] }), onError });
  const clearDone = async () => { for (const j of (jobs.data ?? []).filter((j) => ["COMPLETED", "CANCELLED"].includes(j.state))) await api.del(`/api/uploads/${j.id}`).catch(() => undefined); qc.invalidateQueries({ queryKey: ["uploads"] }); };

  return (
    <>
      <PageHeader title="Uploads" description="Files are first received by your DriveManager server, then sent to Google in resumable pieces. If anything is interrupted, it continues where it stopped." />
      <Card className="mb-6">
        <CardContent className="space-y-5 pt-5">
          <div role="radiogroup" aria-label="Destination mode" className="grid gap-3 sm:grid-cols-2">
            {([["MANUAL", "Choose an account", "You decide exactly where the file goes."], ["AUTO", "Automatic", "Uses your routing rules and account priority, and only picks an account with enough room."]] as const).map(([k, t, d]) => (
              <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn("rounded-lg border p-3.5 text-left transition-colors", mode === k ? "border-primary bg-accent" : "hover:bg-muted")}>
                <p className="flex items-center gap-2 font-medium">{k === "AUTO" && <Sparkles className="h-4 w-4 text-primary" />}{t}</p><p className="mt-0.5 text-sm text-muted-foreground">{d}</p>
              </button>))}
          </div>
          {mode === "MANUAL" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="acct">Account</Label>
                <Select id="acct" value={effectiveAccount} onChange={(e) => { setAccountId(e.target.value); setFolder(null); }}>
                  {active.map((a) => <option key={a.id} value={a.id}>{a.email}{a.quota?.free != null ? ` — ${bytes(a.quota.free)} free` : ""}</option>)}</Select></div>
              <div className="space-y-1.5"><Label>Folder</Label>
                <Button variant="outline" className="w-full justify-start" onClick={() => setPickFolder(true)} disabled={!effectiveAccount}><FolderOpen className="h-4 w-4" /><span className="truncate">{folder?.name ?? "My Drive (root)"}</span></Button></div>
            </div>)}
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            className={cn("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors", drag ? "border-primary bg-accent" : "border-border")}>
            <CloudUpload className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Drop files here</p>
            <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={active.length === 0}>Browse files</Button>
            <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            {active.length === 0 && <p className="text-sm text-destructive">No connected account is available. Connect or reconnect one on the Accounts page.</p>}
          </div>
        </CardContent>
      </Card>

      {local.length > 0 && (
        <Card className="mb-6"><CardContent className="pt-5">
          <h2 className="mb-3 font-semibold">Sending to your server</h2>
          <ul className="space-y-3">{local.map((l) => (
            <li key={l.key} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate">{l.file.name}</span>
              {l.status === "error" ? <Button size="sm" variant="ghost" onClick={() => setLocal((x) => x.filter((i) => i.key !== l.key))}><X className="h-3.5 w-3.5" />Dismiss</Button> : <span className="text-muted-foreground">{l.status === "waiting" ? "Waiting" : `${bytes(l.sent)} / ${bytes(l.file.size)}`}</span>}</div>
              {l.status === "error" ? <p className="text-xs text-destructive">{l.error}</p> : <Progress className="mt-1.5" value={(l.sent / Math.max(l.file.size, 1)) * 100} />}</li>))}</ul>
        </CardContent></Card>)}

      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Queue and history</h2>
        {(jobs.data ?? []).some((j) => ["COMPLETED", "CANCELLED"].includes(j.state)) && <Button variant="ghost" size="sm" onClick={clearDone}>Clear finished</Button>}</div>
      <Card>
        {jobs.isLoading ? <Spinner /> : (jobs.data ?? []).length === 0 ? <EmptyState icon={<CloudUpload className="h-8 w-8" />} title="No uploads yet">Files you upload will show up here with live progress.</EmptyState> : (
          <ul className="divide-y">{jobs.data!.map((j) => {
            const busy = !["COMPLETED", "FAILED", "CANCELLED"].includes(j.state);
            return (
              <li key={j.id} className="space-y-2 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-medium">{j.filename}</p>
                    <p className="text-xs text-muted-foreground">{bytes(j.size)}{j.account_id ? <> → <AccountChip id={j.account_id} email={j.account_email} /></> : " → account not chosen yet"}{j.destination_folder_name ? ` / ${j.destination_folder_name}` : ""}</p></div>
                  <div className="flex items-center gap-2">
                    {j.state === "COMPLETED" ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" />Done</Badge> : j.state === "FAILED" ? <Badge tone="danger"><AlertCircle className="h-3 w-3" />Failed</Badge> : j.state === "CANCELLED" ? <Badge>Cancelled</Badge> : <Badge tone="info">{j.cancel_requested ? "Cancelling" : STATE[j.state]}</Badge>}
                    {busy && !j.cancel_requested && <Button size="sm" variant="outline" onClick={() => cancel.mutate(j.id)}>Cancel</Button>}
                    {busy && j.cancel_requested && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {j.retryable && <Button size="sm" variant="outline" onClick={() => retry.mutate({ id: j.id })}><RotateCcw className="h-3.5 w-3.5" />Retry</Button>}
                    {!busy && <Button size="icon" variant="ghost" aria-label="Remove from list" onClick={() => remove.mutate(j.id)}><X className="h-4 w-4" /></Button>}
                  </div>
                </div>
                {busy && <div><Progress value={j.progress} /><p className="mt-1 text-xs text-muted-foreground">{bytes(j.bytes_uploaded)} of {bytes(j.size)} ({Math.round(j.progress)}%)</p></div>}
                {j.allocation_reason && j.state !== "FAILED" && <p className="text-xs text-muted-foreground">Why this account: {j.allocation_reason}</p>}
                {j.state === "FAILED" && (
                  <div className="rounded-md bg-destructive/10 p-3"><p className="text-destructive">{j.error_message}</p>
                    {j.error_code && SWITCHABLE.includes(j.error_code) && <Button size="sm" className="mt-2" variant="outline" onClick={() => setRetrying(j)}>Retry on another account…</Button>}</div>)}
              </li>);
          })}</ul>)}
      </Card>

      <Dialog open={pickFolder} onOpenChange={setPickFolder} title="Choose destination folder" description="Pick where in this account the files will be stored.">
        {pickFolder && effectiveAccount && <FolderPicker accountId={effectiveAccount} onCancel={() => setPickFolder(false)} onPick={(f) => { setFolder(f.id ? f : null); setPickFolder(false); }} />}
      </Dialog>
      <RetryDialog job={retrying} accounts={active} onClose={() => setRetrying(null)} onGo={(id, account_id) => retry.mutate({ id, account_id })} busy={retry.isPending} />
    </>
  );
}

function RetryDialog({ job, accounts, onClose, onGo, busy }: { job: UploadJob | null; accounts: { id: string; email: string; quota: { free: number | null } | null }[]; onClose: () => void; onGo: (id: string, account: string) => void; busy: boolean }) {
  const [sel, setSel] = useState("");
  const options = accounts.filter((a) => a.id !== job?.account_id);
  const value = sel || options[0]?.id || "";
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()} title="Retry on another account" description={job ? <>“{job.filename}” ({bytes(job.size)}) is still safely stored on your server. Choose where it should go instead. The destination folder will be reset to My Drive.</> : ""}>
      {options.length === 0 ? <p className="text-sm text-muted-foreground">There is no other connected account.</p> : (
        <div className="space-y-4"><Select aria-label="Account" value={value} onChange={(e) => setSel(e.target.value)}>
          {options.map((a) => <option key={a.id} value={a.id}>{a.email}{a.quota?.free != null ? ` — ${bytes(a.quota.free)} free` : ""}</option>)}</Select>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !value} onClick={() => job && onGo(job.id, value)}>Retry upload</Button></div></div>)}
    </Dialog>
  );
}
