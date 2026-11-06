import { useQuery } from "@tanstack/react-query";
import { CloudUpload, FolderOpen, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { FolderPicker, type PickedFolder } from "@/components/FolderPicker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";
import { useAccounts } from "@/hooks/queries";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import { useUploads, type UploadPrefill } from "@/stores/uploads";
import type { VFolder } from "@/types";
import { cn } from "@/utils/cn";
import { bytes } from "@/utils/format";
import { useMask } from "@/utils/privacy";

/** Virtual folder paths ("Work / Invoices") in tree order. */
export function useVirtualPaths() {
  const vtree = useQuery({ queryKey: ["virtual-tree"], queryFn: () => api.get<VFolder[]>("/api/virtual-folders") });
  return useMemo(() => {
    const all = vtree.data ?? [];
    const kids = (pid: string | null) => all.filter((f) => f.parent_id === pid).sort((a, b) => a.name.localeCompare(b.name));
    const out: { id: string; path: string }[] = [];
    const walk = (pid: string | null, prefix: string) => kids(pid).forEach((f) => { const path = prefix ? `${prefix} / ${f.name}` : f.name; out.push({ id: f.id, path }); walk(f.id, path); });
    walk(null, "");
    return out;
  }, [vtree.data]);
}

/**
 * Destination controls + drop zone, shared by the Uploads page and the "Upload files" dialog.
 * `prefill` sets the starting account / folder / virtual folder; `onQueued` runs after files are handed to the queue.
 */
export function UploadForm({ prefill, onQueued, compact, initialFiles }: { prefill?: UploadPrefill; onQueued?: (count: number) => void; compact?: boolean; initialFiles?: File[] }) {
  const m = useMask();
  const accounts = useAccounts();
  const enqueue = useUploads((s) => s.enqueue);
  const active = (accounts.data ?? []).filter((a) => a.status === "ACTIVE");
  const [mode, setMode] = useState<"MANUAL" | "AUTO">(prefill?.folder ? "MANUAL" : "AUTO");
  const [accountId, setAccountId] = useState(prefill?.accountId ?? "");
  const [folder, setFolder] = useState<PickedFolder | null>(prefill?.folder ?? null);
  const [virtualFolderId, setVirtualFolderId] = useState(prefill?.virtualFolderId ?? "");
  const [pickFolder, setPickFolder] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Files dropped on the window arrive here first ("staged"): listed for review, uploaded only after pressing Upload.
  const [staged, setStaged] = useState<File[]>(initialFiles ?? []);
  const staging = (initialFiles?.length ?? 0) > 0;
  const vpaths = useVirtualPaths();
  const chosenVirtual = vpaths.some((v) => v.id === virtualFolderId) ? virtualFolderId : "";
  const effectiveAccount = active.some((a) => a.id === accountId) ? accountId : active[0]?.id || "";
  const folderForAccount = effectiveAccount === accountId || !accountId ? folder : null;

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    if (staging) { setStaged((s) => [...s, ...list]); return; }
    send(list);
  };
  const send = (list: File[]) => {
    if (!list.length) return;
    if (mode === "MANUAL" && !effectiveAccount) { toast.error("Connect an account first."); return; }
    const dest = mode === "MANUAL" && folderForAccount?.id ? { id: folderForAccount.id, name: folderForAccount.name } : null;
    enqueue(list, { mode, accountId: effectiveAccount, folder: dest, virtualFolderId: chosenVirtual });
    onQueued?.(list.length);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); };

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Destination mode" className="grid gap-3 sm:grid-cols-2">
        {([["AUTO", "Automatic", "Uses your routing rules and account priority, and only picks an account with enough room."], ["MANUAL", "Choose an account", "You decide exactly where the file goes."]] as const).map(([k, t, d]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn("rounded-lg border p-3.5 text-left transition-colors", mode === k ? "border-primary bg-accent" : "hover:bg-muted")}>
            <p className="flex items-center gap-2 font-medium">{k === "AUTO" && <Sparkles className="h-4 w-4 text-primary" />}{t}</p>
            {!compact && <p className="mt-0.5 text-sm text-muted-foreground">{d}</p>}
          </button>))}
      </div>
      {mode === "MANUAL" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="up-acct">Account</Label>
            <Select id="up-acct" value={effectiveAccount} onChange={(e) => { setAccountId(e.target.value); setFolder(null); }}>
              {active.map((a) => <option key={a.id} value={a.id}>{m.email(a.email)}{a.quota?.free != null ? ` — ${bytes(a.quota.free)} free` : ""}</option>)}</Select></div>
          <div className="space-y-1.5"><Label>Folder</Label>
            <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setPickFolder(true)} disabled={!effectiveAccount}><FolderOpen className="h-4 w-4" /><span className="truncate">{folderForAccount?.name ?? "My Drive (root)"}</span></Button></div>
        </div>)}
      <div className={cn("space-y-1.5", !compact && "sm:max-w-[calc(50%-0.5rem)]")}><Label htmlFor="up-vfolder">Also add to virtual folder <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Select id="up-vfolder" value={chosenVirtual} onChange={(e) => setVirtualFolderId(e.target.value)}>
          <option value="">Don't add to a virtual folder</option>
          {vpaths.map((v) => <option key={v.id} value={v.id}>{v.path}</option>)}</Select>
        {!compact && <p className="text-xs text-muted-foreground">{vpaths.length === 0 ? "You have no virtual folders yet. Create one under Files → Virtual folders." : "Each file is added once its upload to Google finishes."}</p>}</div>
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className={cn("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 text-center transition-colors", compact ? "py-7" : "py-10", drag ? "border-primary bg-accent" : "border-border")}>
        <CloudUpload className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{staging ? "Drop more files here" : "Drop files here"}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={active.length === 0}>Browse files</Button>
        <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {active.length === 0 && <p className="text-sm text-destructive">No connected account is available. Connect or reconnect one on the Accounts page.</p>}
      </div>
      {staging && (
        <div className="space-y-2">
          <ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm">
            {staged.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{bytes(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setStaged((s) => s.filter((_, j) => j !== i))}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              </li>))}
          </ul>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">{staged.length} file{staged.length === 1 ? "" : "s"} · {bytes(staged.reduce((a, f) => a + f.size, 0))}</span>
            <Button type="button" disabled={!staged.length || (mode === "MANUAL" && !effectiveAccount)} onClick={() => send(staged)}>
              <CloudUpload className="h-4 w-4" />Upload {staged.length || ""} file{staged.length === 1 ? "" : "s"}</Button>
          </div>
        </div>)}
      <Dialog open={pickFolder} onOpenChange={setPickFolder} title="Choose destination folder" description="Pick where in this account the files will be stored.">
        {pickFolder && effectiveAccount && <FolderPicker accountId={effectiveAccount} onCancel={() => setPickFolder(false)} onPick={(f) => { setFolder(f.id ? f : null); setAccountId(effectiveAccount); setPickFolder(false); }} />}
      </Dialog>
    </div>
  );
}

/** The "Upload files" dialog (sidebar / phone top-bar button, or files dropped on the window). Closes once files are queued. */
export function UploadDialog() {
  const dialog = useUploads((s) => s.dialog);
  const close = useUploads((s) => s.closeDialog);
  return (
    <Dialog open={dialog.open} onOpenChange={(o) => !o && close()} title="Upload files" className="max-w-xl"
      description="Files go to your DriveManager server first, then to Google in the background. Progress shows at the bottom right.">
      {dialog.open && <UploadForm compact prefill={dialog.prefill} initialFiles={dialog.files} onQueued={() => close()} />}
    </Dialog>
  );
}
