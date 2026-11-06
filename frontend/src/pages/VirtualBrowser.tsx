import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, ExternalLink, FolderInput, FolderPlus, Link, Link2Off, Pencil, Share2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountChip, ConfirmDialog, EmptyState, onError, PromptDialog, Spinner } from "@/components/Common";
import { download, ExportDialog, FileIcon, VirtualFolderPicker } from "@/components/FileBits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useContextMenu, useLongPress } from "@/components/ui/contextmenu";
import { RowMenu } from "@/components/ui/menu";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { DriveItem, VFolder, VItem } from "@/types";
import { cn } from "@/utils/cn";
import { bytes, when } from "@/utils/format";
import { useFileOpener } from "@/components/FileOpen";
import { copyLink, ShareDialog } from "@/components/ShareDialog";
import { useUploads } from "@/stores/uploads";

type Dlg = { kind: "new"; parent: string | null } | { kind: "rename"; f: VFolder } | { kind: "delete"; f: VFolder } | null;

export default function VirtualBrowser() {
  const qc = useQueryClient();
  const tree = useQuery({ queryKey: ["virtual-tree"], queryFn: () => api.get<VFolder[]>("/api/virtual-folders") });
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dlg>(null);
  const [movingItem, setMovingItem] = useState<VItem | null>(null);
  const [exporting, setExporting] = useState<DriveItem | null>(null);
  const [sharing, setSharing] = useState<DriveItem | null>(null);
  const { openFile, dialog: openFileDialog } = useFileOpener(setExporting, setSharing);
  const folders = tree.data ?? [];
  const current = folders.find((f) => f.id === selected) ?? null;
  const setUploadContext = useUploads((s) => s.setContext);
  useEffect(() => { setUploadContext(current ? { virtualFolderId: current.id } : {}); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setUploadContext({}), []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useQuery({ queryKey: ["virtual-items", selected], enabled: !!selected && !!current, queryFn: () => api.get<{ items: VItem[] }>(`/api/virtual-folders/${selected}/items`) });
  const inval = () => { qc.invalidateQueries({ queryKey: ["virtual-tree"] }); qc.invalidateQueries({ queryKey: ["virtual-items"] }); };
  const create = useMutation({ mutationFn: (v: { name: string; parent: string | null }) => api.post<{ id: string }>("/api/virtual-folders", { name: v.name, parent_id: v.parent }), onSuccess: (r, v) => { setDlg(null); inval(); setSelected(r.id); if (v.parent) setOpen(new Set(open).add(v.parent)); }, onError });
  const rename = useMutation({ mutationFn: (v: { id: string; name: string }) => api.patch(`/api/virtual-folders/${v.id}`, { name: v.name }), onSuccess: () => { setDlg(null); inval(); }, onError });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/virtual-folders/${id}`), onSuccess: (_, id) => { setDlg(null); if (selected === id) setSelected(null); inval(); toast.success("Virtual folder removed. No files in Google Drive were changed."); }, onError });
  const removeItem = useMutation({ mutationFn: (it: VItem) => api.del(`/api/virtual-folders/${selected}/items/${it.item_id}`), onSuccess: inval, onError });
  const moveItem = useMutation({ mutationFn: (v: { it: VItem; to: string }) => api.post(`/api/virtual-folders/items/${v.it.item_id}/move`, { target_folder_id: v.to }), onSuccess: () => { setMovingItem(null); inval(); }, onError });

  const Node = ({ parent, depth }: { parent: string | null; depth: number }) => (
    <ul>{folders.filter((f) => f.parent_id === parent).map((f) => {
      const kids = folders.some((k) => k.parent_id === f.id), isOpen = open.has(f.id);
      return (
        <li key={f.id}>
          <div className={cn("group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted", selected === f.id && "bg-accent text-accent-foreground")} style={{ paddingLeft: depth * 14 + 4 }}>
            <button aria-label={isOpen ? "Collapse" : "Expand"} className={cn("rounded p-0.5", !kids && "invisible")} onClick={() => { const n = new Set(open); isOpen ? n.delete(f.id) : n.add(f.id); setOpen(n); }}>{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
            <button className="flex-1 truncate py-1.5 text-left" onClick={() => setSelected(f.id)}>{f.name} <span className="text-xs text-muted-foreground">{f.item_count || ""}</span></button>
            <RowMenu label={`Actions for ${f.name}`} items={[
              { label: "New sub-folder", icon: <FolderPlus className="h-4 w-4" />, onSelect: () => setDlg({ kind: "new", parent: f.id }) },
              { label: "Rename", icon: <Pencil className="h-4 w-4" />, onSelect: () => setDlg({ kind: "rename", f }) },
              { label: "Delete folder", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setDlg({ kind: "delete", f }) }]} />
          </div>
          {kids && isOpen && <Node parent={f.id} depth={depth + 1} />}
        </li>);
    })}</ul>
  );

  // Right-click (or long-press) a row: same actions as its ⋮ menu. Shift + right-click keeps the browser's menu.
  const ctx = useContextMenu();
  const longPress = useLongPress();
  const [ctxRow, setCtxRow] = useState<string | null>(null);
  useEffect(() => { if (!ctx.openFor) setCtxRow(null); }, [ctx.openFor]);

  const menu = (it: VItem) => it.file ? [
    { label: "Open in Google Drive", icon: <ExternalLink className="h-4 w-4" />, hidden: !it.file.web_view_link, onSelect: () => window.open(it.file!.web_view_link!, "_blank", "noopener") },
    { label: "Download", icon: <Download className="h-4 w-4" />, hidden: it.file.is_folder || it.status !== "ok", onSelect: () => download(it.file!, () => setExporting(it.file)) },
    { label: "Share…", icon: <Share2 className="h-4 w-4" />, hidden: it.status !== "ok", onSelect: () => setSharing(it.file) },
    { label: "Copy link", icon: <Link className="h-4 w-4" />, hidden: it.status !== "ok" || !it.file.web_view_link, onSelect: () => copyLink(it.file!) },
    { label: "Move to another virtual folder", icon: <FolderInput className="h-4 w-4" />, onSelect: () => setMovingItem(it) },
    { label: "Remove from this folder", icon: <Link2Off className="h-4 w-4" />, onSelect: () => removeItem.mutate(it) },
  ] : [{ label: "Remove from this folder", icon: <Link2Off className="h-4 w-4" />, onSelect: () => removeItem.mutate(it) }];

  return (
    <div className="grid gap-4 md:grid-cols-[17rem_1fr]">
      <Card className="self-start p-3">
        <div className="mb-2 flex items-center justify-between px-1"><h2 className="text-sm font-semibold">Folders</h2><Button size="sm" variant="ghost" onClick={() => setDlg({ kind: "new", parent: null })}><FolderPlus className="h-3.5 w-3.5" />New</Button></div>
        {tree.isLoading ? <Spinner /> : folders.length === 0 ? <p className="px-2 py-6 text-sm text-muted-foreground">No virtual folders yet. They let you group files from different accounts without moving anything.</p> : <Node parent={null} depth={0} />}
      </Card>
      <Card className="min-h-64 overflow-hidden">
        {!current ? <EmptyState title="Pick a virtual folder">Virtual folders are shortcuts you organise yourself. Add files from the Google Drive tab with “Add to virtual folder”.</EmptyState>
          : items.isLoading ? <Spinner /> : (items.data?.items ?? []).length === 0 ? <EmptyState title={`${current.name} is empty`}>Use “Add to virtual folder” on any file in the Google Drive tab.</EmptyState> : (
            <ul className="divide-y">{items.data!.items.map((it) => (
              <li key={it.item_id} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", ctxRow === it.item_id && "bg-muted/60 outline outline-1 -outline-offset-1 outline-primary/50")}
                onContextMenu={(e) => { if (ctx.onContextMenu(e, menu(it), it.name ?? undefined)) setCtxRow(it.item_id); }}
                {...longPress((x, y) => { ctx.openAt(x, y, menu(it), it.name ?? undefined); setCtxRow(it.item_id); })}>
                <FileIcon mime={it.mime_type ?? ""} />
                <div className="min-w-0 flex-1">{it.file && !it.file.is_folder && it.status !== "missing"
                  ? <button className="block max-w-full truncate text-left hover:underline" title={`${it.name}: download or open in Google Drive`} onClick={() => openFile(it.file!)}>{it.name}</button>
                  : <p className={cn("truncate", it.status === "missing" && "text-muted-foreground line-through")}>{it.name}</p>}<AccountChip id={it.account_id} email={it.account_email} /></div>
                {it.status === "missing" && <Badge tone="danger">No longer in Drive</Badge>}
                {it.status === "trashed" && <Badge tone="warning">In trash</Badge>}
                {it.status === "inaccessible" && <Badge tone="warning">Account needs reconnecting</Badge>}
                <span className="hidden w-20 text-right text-muted-foreground sm:block">{it.file && !it.file.is_folder ? bytes(it.file.size) : ""}</span>
                <span className="hidden w-36 text-muted-foreground lg:block">{it.file ? when(it.file.modified_time) : ""}</span>
                <RowMenu items={menu(it)} label={`Actions for ${it.name}`} /></li>))}</ul>)}
      </Card>

      {dlg?.kind === "new" && <PromptDialog open onOpenChange={() => setDlg(null)} title="New virtual folder" label="Folder name" confirmLabel="Create" busy={create.isPending} onSubmit={(name) => create.mutate({ name, parent: dlg.parent })} />}
      {dlg?.kind === "rename" && <PromptDialog open onOpenChange={() => setDlg(null)} title="Rename virtual folder" label="Folder name" initial={dlg.f.name} confirmLabel="Rename" busy={rename.isPending} onSubmit={(name) => rename.mutate({ id: dlg.f.id, name })} />}
      <ConfirmDialog open={dlg?.kind === "delete"} onOpenChange={() => setDlg(null)} title="Delete virtual folder?" confirmLabel="Delete folder" danger busy={del.isPending} onConfirm={() => dlg?.kind === "delete" && del.mutate(dlg.f.id)}>
        “{dlg?.kind === "delete" ? dlg.f.name : ""}” and its sub-folders will be removed from DriveManager. <b>Your files in Google Drive are not touched.</b></ConfirmDialog>
      <VirtualFolderPicker open={!!movingItem} title="Move to another virtual folder" confirmLabel="Move" folders={folders} excludeId={selected ?? undefined} onClose={() => setMovingItem(null)} onPick={(to) => movingItem && moveItem.mutate({ it: movingItem, to })} />
      <ExportDialog item={exporting} onClose={() => setExporting(null)} />
      {openFileDialog}
      {ctx.node}
      <ShareDialog item={sharing} onClose={() => setSharing(null)} />
    </div>
  );
}
