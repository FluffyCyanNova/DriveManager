import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FolderInput, FolderPlus, FolderTree, Link2, Pencil, RotateCcw, Search, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountChip, ConfirmDialog, EmptyState, onError, PageHeader, PromptDialog, Spinner } from "@/components/Common";
import { download, ExportDialog, FileIcon, VirtualFolderPicker } from "@/components/FileBits";
import { FolderPicker } from "@/components/FolderPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { RowMenu } from "@/components/ui/menu";
import { useAccounts } from "@/hooks/queries";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { DriveItem, FilePage, SharedDrive, VFolder } from "@/types";
import { cn } from "@/utils/cn";
import { bytes, when } from "@/utils/format";
import VirtualBrowser from "./VirtualBrowser";

type Loc = "my_drive" | "shared_with_me" | "shared_drive" | "trash";
interface Crumb { accountId: string; id: string; name: string }

export default function Files() {
  const [tab, setTab] = useState<"drive" | "virtual">("drive");
  return (
    <>
      <PageHeader title="Files" description="Browse every connected account in one place. Changes are made in Google Drive itself." />
      <div role="tablist" className="mb-5 inline-flex rounded-lg border bg-card p-1">
        {([["drive", "Google Drive", FolderTree], ["virtual", "Virtual folders", Link2]] as const).map(([k, t, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium", tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="h-4 w-4" />{t}</button>))}
      </div>
      {tab === "drive" ? <DriveBrowser /> : <VirtualBrowser />}
    </>
  );
}

function DriveBrowser() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [loc, setLoc] = useState<Loc>("my_drive");
  const [stack, setStack] = useState<Crumb[]>([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<DriveItem | null>(null);
  const [moving, setMoving] = useState<DriveItem | null>(null);
  const [deleting, setDeleting] = useState<DriveItem | null>(null);
  const [exporting, setExporting] = useState<DriveItem | null>(null);
  const [addTo, setAddTo] = useState<DriveItem[] | null>(null);
  const [newFolder, setNewFolder] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => { setSel(new Set()); }, [loc, stack, q, accountId, type, page]);

  const top = stack[stack.length - 1];
  const sharedRoot = loc === "shared_drive" && !top && !q;
  const params = new URLSearchParams({ sort, direction: dir, page: String(page), page_size: "100" });
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  if (loc === "trash") params.set("trashed", "true");
  if (accountId && !top) params.set("account_id", accountId);
  if (top && !q && loc !== "trash") { params.set("parent_id", top.id); params.set("account_id", top.accountId); }
  if (!top && !q && loc !== "trash") params.set("location", loc);
  if (loc === "shared_drive" && (q)) params.set("location", "shared_drive");

  const files = useQuery({ queryKey: ["files", "list", params.toString()], enabled: !sharedRoot, queryFn: () => api.get<FilePage>(`/api/files?${params}`), placeholderData: (p) => p });
  const drives = useQuery({ queryKey: ["drives"], enabled: sharedRoot, queryFn: () => api.get<SharedDrive[]>("/api/drives") });
  const vtree = useQuery({ queryKey: ["virtual-tree"], queryFn: () => api.get<VFolder[]>("/api/virtual-folders") });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["files"] }); qc.invalidateQueries({ queryKey: ["storage"] }); };
  const ok = (msg: string) => () => { toast.success(msg); refresh(); };
  const rename = useMutation({ mutationFn: (v: { it: DriveItem; name: string }) => api.patch(`/api/files/${v.it.account_id}/${v.it.google_file_id}`, { name: v.name }), onSuccess: () => { setRenaming(null); ok("Renamed.")(); }, onError });
  const trash = useMutation({ mutationFn: (it: DriveItem) => api.post(`/api/files/${it.account_id}/${it.google_file_id}/trash`), onSuccess: ok("Moved to Google Drive trash. You can restore it from Trash."), onError });
  const restore = useMutation({ mutationFn: (it: DriveItem) => api.post(`/api/files/${it.account_id}/${it.google_file_id}/restore`), onSuccess: ok("Restored."), onError });
  const purge = useMutation({ mutationFn: (it: DriveItem) => api.del(`/api/files/${it.account_id}/${it.google_file_id}?permanent=true&confirm=true`), onSuccess: () => { setDeleting(null); ok("Deleted permanently.")(); }, onError });
  const move = useMutation({ mutationFn: (v: { it: DriveItem; dest: string }) => api.post(`/api/files/${v.it.account_id}/${v.it.google_file_id}/move`, { destination_id: v.dest }), onSuccess: () => { setMoving(null); ok("Moved.")(); }, onError });
  const mkdir = useMutation({
    mutationFn: (name: string) => { const a = top?.accountId ?? accountId; return api.post(`/api/files/${a}/folders`, { name, parent_id: top?.id ?? null }); },
    onSuccess: () => { setNewFolder(false); ok("Folder created.")(); }, onError,
  });
  const addItems = useMutation({
    mutationFn: (v: { folderId: string; items: DriveItem[] }) => api.post<{ added: number }>(`/api/virtual-folders/${v.folderId}/items`, { items: v.items.map((i) => ({ account_id: i.account_id, google_file_id: i.google_file_id })) }),
    onSuccess: (r) => { setAddTo(null); setSel(new Set()); toast.success(r.added ? `Added ${r.added} item(s) to the virtual folder.` : "Those items were already in that folder."); qc.invalidateQueries({ queryKey: ["virtual-tree"] }); qc.invalidateQueries({ queryKey: ["virtual-items"] }); }, onError,
  });

  const items = files.data?.items ?? [];
  const total = files.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 100));
  const canMkdir = loc !== "trash" && loc !== "shared_with_me" && (top ? true : !!accountId && loc === "my_drive");
  const selected = items.filter((i) => sel.has(i.id));
  const go = (l: Loc) => { setLoc(l); setStack([]); setPage(1); setQInput(""); };
  const openFolder = (it: DriveItem) => { if (it.trashed) return; if (q) { setQInput(""); setStack([{ accountId: it.account_id, id: it.google_file_id, name: it.name }]); } else setStack([...stack, { accountId: it.account_id, id: it.google_file_id, name: it.name }]); setPage(1); };

  const menu = (it: DriveItem) => [
    { label: "Open in Google Drive", icon: <ExternalLink className="h-4 w-4" />, hidden: !it.web_view_link, onSelect: () => window.open(it.web_view_link!, "_blank", "noopener") },
    { label: "Download", icon: <Download className="h-4 w-4" />, hidden: it.is_folder || !it.can.download, onSelect: () => download(it, () => setExporting(it)) },
    { label: "Rename", icon: <Pencil className="h-4 w-4" />, hidden: it.trashed || !it.can.rename, onSelect: () => setRenaming(it) },
    { label: "Move to…", icon: <FolderInput className="h-4 w-4" />, hidden: it.trashed || !it.can.move, onSelect: () => setMoving(it) },
    { label: "Add to virtual folder", icon: <Link2 className="h-4 w-4" />, hidden: it.trashed, onSelect: () => setAddTo([it]) },
    { label: "Move to trash", icon: <Trash2 className="h-4 w-4" />, hidden: it.trashed || !it.can.trash, onSelect: () => trash.mutate(it) },
    { label: "Restore", icon: <RotateCcw className="h-4 w-4" />, hidden: !it.trashed || !it.can.untrash, onSelect: () => restore.mutate(it) },
    { label: "Delete permanently…", icon: <Trash2 className="h-4 w-4" />, danger: true, hidden: !it.trashed || !it.can.delete, onSelect: () => setDeleting(it) },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Location" className="inline-flex rounded-md border bg-card p-0.5">
          {([["my_drive", "My Drive"], ["shared_with_me", "Shared with me"], ["shared_drive", "Shared drives"], ["trash", "Trash"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={loc === k} onClick={() => go(k)} className={cn("rounded px-3 py-1 text-sm", loc === k ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>{t}</button>))}
        </div>
        <Select aria-label="Account" className="w-52" value={accountId} onChange={(e) => { setAccountId(e.target.value); setStack([]); setPage(1); }}>
          <option value="">All accounts</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</Select>
        <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search files" className="pl-8" placeholder="Search by name across accounts…" value={qInput} onChange={(e) => setQInput(e.target.value)} /></div>
        <Select aria-label="File type" className="w-36" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Any type</option><option value="folder">Folders</option><option value="document">Documents</option><option value="spreadsheet">Spreadsheets</option><option value="presentation">Presentations</option><option value="pdf">PDFs</option><option value="image">Images</option><option value="video">Video</option><option value="audio">Audio</option><option value="archive">Archives</option><option value="other">Other</option></Select>
        <Select aria-label="Sort" className="w-36" value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); setSort(s); setDir(d as "asc" | "desc"); }}>
          <option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="modified:desc">Newest first</option><option value="modified:asc">Oldest first</option><option value="size:desc">Largest first</option><option value="size:asc">Smallest first</option></Select>
        {canMkdir && <Button variant="outline" onClick={() => setNewFolder(true)}><FolderPlus className="h-4 w-4" />New folder</Button>}
      </div>

      {(stack.length > 0 && !q) && (
        <nav aria-label="Folder path" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
          <button className="rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => setStack([])}>{{ my_drive: "My Drive", shared_with_me: "Shared with me", shared_drive: "Shared drives", trash: "Trash" }[loc]}</button>
          {stack.map((c, i) => <span key={`${c.id}${i}`} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><button className={cn("rounded px-1.5 py-0.5 hover:bg-accent", i === stack.length - 1 && "font-semibold")} onClick={() => setStack(stack.slice(0, i + 1))}>{c.name}</button></span>)}
        </nav>)}
      {q && <p className="mb-3 text-sm text-muted-foreground">Search results for “{q}”{loc === "trash" ? " in Trash" : ""}.</p>}

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          <b>{selected.length} selected</b>
          {loc !== "trash" && <Button size="sm" variant="outline" onClick={() => setAddTo(selected)}><Link2 className="h-3.5 w-3.5" />Add to virtual folder</Button>}
          {loc !== "trash" && <Button size="sm" variant="outline" onClick={async () => { for (const i of selected) if (i.can.trash) await trash.mutateAsync(i).catch(() => undefined); setSel(new Set()); }}><Trash2 className="h-3.5 w-3.5" />Move to trash</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
        </div>)}

      <Card className="overflow-hidden">
        {sharedRoot ? (
          drives.isLoading ? <Spinner /> : (drives.data ?? []).filter((d) => !accountId || d.account_id === accountId).length === 0 ? <EmptyState icon={<Users className="h-8 w-8" />} title="No shared drives">None of your connected accounts are members of a shared drive.</EmptyState> : (
            <ul className="divide-y">{drives.data!.filter((d) => !accountId || d.account_id === accountId).map((d) => (
              <li key={d.account_id + d.id}><button onClick={() => setStack([{ accountId: d.account_id, id: d.id, name: d.name }])} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"><Users className="h-4 w-4 text-primary" /><span className="flex-1 font-medium">{d.name}</span><AccountChip id={d.account_id} email={d.account_email} /></button></li>))}</ul>)
        ) : files.isLoading ? <Spinner /> : items.length === 0 ? (
          <EmptyState icon={<FolderTree className="h-8 w-8" />} title={q ? "No matches" : loc === "trash" ? "Trash is empty" : (accounts.data ?? []).length === 0 ? "No accounts connected" : "Nothing in this folder"}>
            {!q && (accounts.data ?? []).some((a) => !a.initial_scan_complete) ? "Some accounts are still being indexed for the first time. Files appear as the scan progresses." : undefined}</EmptyState>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>
              <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Select all" checked={selected.length === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} /></th>
              <th className="px-2 py-2.5">Name</th><th className="hidden px-2 py-2.5 md:table-cell">Account</th><th className="hidden px-2 py-2.5 sm:table-cell">Modified</th><th className="px-2 py-2.5 text-right">Size</th><th className="w-10" /></tr></thead>
            <tbody className="divide-y">{items.map((it) => (
              <tr key={it.id} className={cn("hover:bg-muted/40", sel.has(it.id) && "bg-accent/50")}>
                <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${it.name}`} checked={sel.has(it.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(it.id) : n.delete(it.id); setSel(n); }} /></td>
                <td className="max-w-0 px-2 py-2"><div className="flex items-center gap-2.5"><FileIcon mime={it.mime_type} />
                  {it.is_folder ? <button className="truncate text-left font-medium hover:underline" onClick={() => openFolder(it)}>{it.name}</button> : <span className="truncate" title={it.name}>{it.name}</span>}
                  {it.location === "SHARED_WITH_ME" && <span className="shrink-0 rounded bg-secondary px-1.5 text-[11px] text-muted-foreground">shared</span>}</div></td>
                <td className="hidden px-2 py-2 md:table-cell"><AccountChip id={it.account_id} email={it.account_email} /></td>
                <td className="hidden whitespace-nowrap px-2 py-2 text-muted-foreground sm:table-cell">{when(it.modified_time)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">{it.is_folder ? "—" : bytes(it.size)}</td>
                <td className="px-2 py-2"><RowMenu items={menu(it)} label={`Actions for ${it.name}`} /></td></tr>))}</tbody></table></div>)}
        {!sharedRoot && total > 100 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm"><span className="text-muted-foreground">{total.toLocaleString()} items</span>
            <div className="flex items-center gap-2"><Button size="icon" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button><span>Page {page} of {pages}</span><Button size="icon" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button></div></div>)}
      </Card>

      {renaming && <PromptDialog open onOpenChange={(o) => !o && setRenaming(null)} title="Rename" label="New name" initial={renaming.name} confirmLabel="Rename" busy={rename.isPending} onSubmit={(name) => rename.mutate({ it: renaming, name })} />}
      {newFolder && <PromptDialog open onOpenChange={setNewFolder} title="New folder" label={`Folder name${top ? ` (inside ${top.name})` : ""}`} confirmLabel="Create" busy={mkdir.isPending} onSubmit={(n) => mkdir.mutate(n)} />}
      <Dialog open={!!moving} onOpenChange={(o) => !o && setMoving(null)} title={`Move “${moving?.name ?? ""}”`} description="Items can be moved within the same account.">
        {moving && <FolderPicker accountId={moving.account_id} label="Move here" onCancel={() => setMoving(null)} onPick={(f) => move.mutate({ it: moving, dest: f.id ?? "root" })} />}</Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete permanently?" confirmLabel="Delete forever" danger busy={purge.isPending} onConfirm={() => deleting && purge.mutate(deleting)}>
        “{deleting?.name}” will be removed from Google Drive and can't be recovered. This can't be undone.</ConfirmDialog>
      <ExportDialog item={exporting} onClose={() => setExporting(null)} />
      <VirtualFolderPicker open={!!addTo} title="Add to virtual folder" confirmLabel="Add" folders={vtree.data ?? []} onClose={() => setAddTo(null)}
        onPick={(id) => addTo && addItems.mutate({ folderId: id, items: addTo })}
        onCreate={async (name) => { const f = await api.post<{ id: string }>("/api/virtual-folders", { name, parent_id: null }); qc.invalidateQueries({ queryKey: ["virtual-tree"] }); return f.id; }} />
    </>
  );
}
