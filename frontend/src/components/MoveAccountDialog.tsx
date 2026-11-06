import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderOpen } from "lucide-react";
import { useState } from "react";
import { onError } from "@/components/Common";
import { FileIcon } from "@/components/FileBits";
import { FolderPicker, type PickedFolder } from "@/components/FolderPicker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";
import { useAccounts } from "@/hooks/queries";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { DriveItem } from "@/types";
import { bytes } from "@/utils/format";
import { useMask } from "@/utils/privacy";

interface MoveResult { method: "transfer" | "copy"; file: DriveItem }

/**
 * "Move to another account…": nothing is downloaded. The server first tries to transfer ownership (same file and link);
 * if Google refuses, it copies the file inside Google and moves the original to the source account's Trash.
 */
export function MoveAccountDialog({ item, onClose }: { item: DriveItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMask();
  const accounts = useAccounts();
  const targets = (accounts.data ?? []).filter((a) => a.status === "ACTIVE" && a.id !== item?.account_id);
  const [target, setTarget] = useState("");
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  const [picking, setPicking] = useState(false);
  const chosen = targets.find((a) => a.id === target) ?? targets[0];
  const free = chosen?.quota?.free ?? null;
  const tooBig = free != null && item?.size != null && item.size > free;

  const close = () => { setTarget(""); setFolder(null); setPicking(false); onClose(); };
  const move = useMutation({
    mutationFn: () => api.post<MoveResult>(`/api/files/${item!.account_id}/${item!.google_file_id}/move-to-account`,
      { target_account_id: chosen!.id, target_folder_id: folder?.id ?? null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["files"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["virtual-items"] });
      toast.success(r.method === "transfer"
        ? `Moved to ${chosen!.email}. Ownership was transferred, so the link stays the same.`
        : `Copied to ${chosen!.email} and the original was moved to the old account's Trash. Google didn't allow an ownership transfer, so the link changed.`);
      close();
    },
    onError,
  });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && close()} title="Move to another account"
      description="Nothing is downloaded: the file moves inside Google Drive.">
      {item && (picking && chosen ? (
        <FolderPicker accountId={chosen.id} onCancel={() => setPicking(false)} onPick={(f) => { setFolder(f.id ? f : null); setPicking(false); }} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm">
            <FileIcon mime={item.mime_type} />
            <span className="min-w-0 flex-1 truncate font-medium" title={item.name}>{item.name}</span>
            {item.size != null && <span className="shrink-0 text-muted-foreground">{bytes(item.size)}</span>}
          </div>
          {targets.length === 0 ? <p className="text-sm text-muted-foreground">Connect another account first. There's no other connected account to move it to.</p> : (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                <div className="space-y-1.5"><Label>From</Label><p className="truncate rounded-md border bg-muted/40 px-3 py-2 text-sm">{m.email(item.account_email)}</p></div>
                <ArrowRight className="mx-auto mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block" />
                <div className="space-y-1.5"><Label htmlFor="move-target">To</Label>
                  <Select id="move-target" value={chosen?.id ?? ""} onChange={(e) => { setTarget(e.target.value); setFolder(null); }}>
                    {targets.map((a) => <option key={a.id} value={a.id}>{m.email(a.email)}{a.quota?.free != null ? ` — ${bytes(a.quota.free)} free` : ""}</option>)}</Select></div>
              </div>
              <div className="space-y-1.5"><Label>Folder</Label>
                <Button variant="outline" className="w-full justify-start" onClick={() => setPicking(true)}><FolderOpen className="h-4 w-4" /><span className="truncate">{folder?.name ?? "My Drive (root)"}</span></Button></div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>First it tries to <b>transfer ownership</b>: same file, same link, comments and sharing kept.</li>
                <li>If Google doesn't allow that (e.g. work accounts or files you don't own), it <b>copies</b> the file and moves the original to the old account's <b>Trash</b>. The link changes.</li>
                <li>Storage moves to the new account. Virtual folders are updated to point to the moved file.</li>
              </ul>
              {tooBig && <p className="rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">{m.email(chosen.email)} has {bytes(free)} free, not enough for this file.</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={close}>Cancel</Button>
                <Button disabled={move.isPending || !chosen || tooBig} onClick={() => move.mutate()}>{move.isPending ? "Moving…" : "Move"}</Button>
              </div>
            </>)}
        </div>
      ))}
    </Dialog>
  );
}
