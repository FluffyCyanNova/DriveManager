import { Archive, File, FileText, Film, Folder, Image, Music, Presentation, Sheet } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { ApiError, api, downloadUrl } from "@/services/api";
import { toast } from "@/stores/ui";
import type { VFolder } from "@/types";
import { isGoogleNative } from "@/utils/format";

export function FileIcon({ mime, className = "h-4 w-4" }: { mime: string; className?: string }) {
  const c = `${className} shrink-0`;
  if (mime === "application/vnd.google-apps.folder") return <Folder className={`${c} text-primary`} />;
  if (mime.startsWith("image/")) return <Image className={c} />;
  if (mime.startsWith("video/")) return <Film className={c} />;
  if (mime.startsWith("audio/")) return <Music className={c} />;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return <Sheet className={c} />;
  if (mime.includes("presentation") || mime.includes("powerpoint")) return <Presentation className={c} />;
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("7z") || mime.includes("tar") || mime.includes("gzip")) return <Archive className={c} />;
  if (mime.startsWith("text/") || mime.includes("document") || mime.includes("pdf") || mime.includes("word")) return <FileText className={c} />;
  return <File className={c} />;
}

/** Checks the download will work first (so errors show as toasts, not a JSON page), then triggers the browser download. */
export async function startDownload(accountId: string, fileId: string, format?: string) {
  const url = downloadUrl(accountId, fileId, format);
  const ac = new AbortController();
  try {
    const r = await fetch(url, { signal: ac.signal, credentials: "same-origin" });
    if (!r.ok) { const j = await r.json().catch(() => null); toast.error(j?.error?.message ?? "Download failed."); return; }
    ac.abort();
  } catch (e) { if (!(e instanceof DOMException)) { toast.error(e instanceof ApiError ? e.message : "Download failed."); return; } }
  const a = document.createElement("a");
  a.href = url; a.download = ""; document.body.appendChild(a); a.click(); a.remove();
}

export function ExportDialog({ item, onClose }: { item: { account_id: string; google_file_id: string; name: string; mime_type: string } | null; onClose: () => void }) {
  const sheet = item?.mime_type.endsWith("spreadsheet"), slides = item?.mime_type.endsWith("presentation");
  const options = sheet ? [["xlsx", "Excel (.xlsx)"], ["csv", "CSV (first sheet)"], ["pdf", "PDF"]] : slides ? [["pptx", "PowerPoint (.pptx)"], ["pdf", "PDF"]] : [["docx", "Word (.docx)"], ["pdf", "PDF"], ["txt", "Plain text"]];
  const [fmt, setFmt] = useState("");
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()} title="Download Google document" description="Google documents have no file of their own, so they are exported first.">
      <Label htmlFor="fmt">Format</Label>
      <Select id="fmt" className="mt-2" value={fmt || options[0][0]} onChange={(e) => setFmt(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { if (item) startDownload(item.account_id, item.google_file_id, fmt || options[0][0]); onClose(); }}>Download</Button></div>
    </Dialog>
  );
}
export const download = (it: { account_id: string; google_file_id: string; mime_type: string }, ask: () => void) =>
  isGoogleNative(it.mime_type) ? ask() : startDownload(it.account_id, it.google_file_id);

export function flattenFolders(list: VFolder[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, prefix: string) => list.filter((f) => f.parent_id === parent).sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => { out.push({ id: f.id, label: prefix + f.name }); walk(f.id, `${prefix}${f.name} / `); });
  walk(null, "");
  return out;
}

export function VirtualFolderPicker({ open, folders, title, confirmLabel, onClose, onPick, onCreate, excludeId }: {
  open: boolean; folders: VFolder[]; title: string; confirmLabel: string; onClose: () => void; onPick: (folderId: string) => void; onCreate?: (name: string) => Promise<string>; excludeId?: string;
}) {
  const flat = flattenFolders(folders).filter((f) => f.id !== excludeId);
  const [sel, setSel] = useState("");
  const [name, setName] = useState("");
  const value = sel || flat[0]?.id || "";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} description="Virtual folders only organise links. Your files in Google Drive stay exactly where they are.">
      <div className="space-y-4">
        {flat.length > 0 && <div className="space-y-1.5"><Label htmlFor="vf">Folder</Label><Select id="vf" value={value} onChange={(e) => setSel(e.target.value)}>{flat.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></div>}
        {onCreate && <div className="space-y-1.5"><Label htmlFor="vfn">{flat.length ? "Or create a new folder" : "Create a folder to start"}</Label>
          <div className="flex gap-2"><Input id="vfn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" />
            <Button variant="outline" disabled={!name.trim()} onClick={async () => { const id = await onCreate(name.trim()); setName(""); setSel(id); onPick(id); }}>Create and add</Button></div></div>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!value} onClick={() => onPick(value)}>{confirmLabel}</Button></div>
      </div>
    </Dialog>
  );
}
