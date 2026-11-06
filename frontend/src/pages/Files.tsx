import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Download, ExternalLink, FolderInput, FolderPlus, FolderTree, Link, Link2, Pencil, RotateCcw, Search, Share2, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AccountChip, DoubleConfirm, type DoomedItem, EmptyState, onError, PageHeader, PromptDialog, Spinner } from "@/components/Common";
import { download, ExportDialog, FileIcon, VirtualFolderPicker } from "@/components/FileBits";
import { FolderPicker } from "@/components/FolderPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { useContextMenu, useLongPress } from "@/components/ui/contextmenu";
import { RowMenu } from "@/components/ui/menu";
import { fitColumn, ResizableTh, useColumnWidths, useMinWidth, type ColumnSpec } from "@/hooks/useColumnWidths";
import { useAccounts } from "@/hooks/queries";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { DriveItem, FilePage, SharedDrive, VFolder } from "@/types";
import { cn } from "@/utils/cn";
import { bytes, when } from "@/utils/format";
import VirtualBrowser from "./VirtualBrowser";
import { useMask } from "@/utils/privacy";
import { useFileOpener } from "@/components/FileOpen";
import { copyLink, ShareDialog } from "@/components/ShareDialog";
import { MoveAccountDialog } from "@/components/MoveAccountDialog";
import { useUploads } from "@/stores/uploads";

type Loc = "my_drive" | "shared_with_me" | "shared_drive" | "trash";
interface Crumb { accountId: string; id: string; name: string }
type Col = "name" | "account" | "modified" | "size";
const COLUMNS: Record<Col, ColumnSpec> = {
  name: { width: 420, min: 140, max: 1400 },
  account: { width: 240, min: 90, max: 600 },
  modified: { width: 190, min: 110, max: 400 },
  size: { width: 100, min: 64, max: 240 },
};
const EDGE = 44; // checkbox and row-menu columns
// The ⋮ column stays pinned to the right edge however wide the other columns are dragged. Sticky cells need an opaque
// background, so the card colour sits underneath and the row's hover/selected tint is repeated on a ::before layer.
const STICKY_BASE = "sticky right-0 z-[1] bg-card px-2 before:pointer-events-none before:absolute before:inset-0 before:content-[''] shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.35)]";
const STICKY_TH = `${STICKY_BASE} py-2.5 before:bg-muted/50`;
const STICKY_TD = `${STICKY_BASE} py-2 group-hover:before:bg-muted/40`;
// First click on a column: names and accounts A–Z, dates and sizes newest/largest first. Clicking again flips it.
const FIRST_DIR: Record<Col, "asc" | "desc"> = { name: "asc", account: "asc", modified: "desc", size: "desc" };
type FolderPlacement = "first" | "last" | "mixed";
const FOLDERS_KEY = "dm-files-folders";
const readFolders = (): FolderPlacement => {
  try { const v = localStorage.getItem(FOLDERS_KEY); return v === "last" || v === "mixed" ? v : "first"; } catch { return "first"; }
};

export default function Files() {
  // The view lives in the URL (?view=trash|virtual) so the sidebar's Trash and Virtual folders links can open it directly.
  const [search, setSearch] = useSearchParams();
  const tab = search.get("view") === "virtual" ? "virtual" : "drive";
  const setTab = (t: "drive" | "virtual") => setSearch(t === "virtual" ? { view: "virtual" } : {});
  return (
    <>
      <PageHeader title="Files" description="Browse every connected account in one place. Changes are made in Google Drive itself." />
      <div className="mb-5 flex flex-wrap items-center gap-3">
      <div role="tablist" className="inline-flex rounded-lg border bg-card p-1">
        {([["drive", "Google Drive", FolderTree], ["virtual", "Virtual folders", Link2]] as const).map(([k, t, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium", tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="h-4 w-4" />{t}</button>))}
      </div>
      </div>
      {tab === "drive" ? <DriveBrowser /> : <VirtualBrowser />}
    </>
  );
}

function DriveBrowser() {
  const m = useMask();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useSearchParams();
  const [baseLoc, setBaseLoc] = useState<Exclude<Loc, "trash">>("my_drive");
  const loc: Loc = search.get("view") === "trash" ? "trash" : baseLoc;
  const [stack, setStack] = useState<Crumb[]>([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [folders, setFolders] = useState<FolderPlacement>(readFolders);
  // "Show all files": every file at any depth in the current tab, as one flat list (remembered in this browser).
  const [allFiles, setAllFilesState] = useState(() => { try { return localStorage.getItem("dm-files-all") !== "0"; } catch { return true; } });
  const setAllFiles = (v: boolean) => { setAllFilesState(v); setPage(1); setStack([]); try { localStorage.setItem("dm-files-all", v ? "1" : "0"); } catch { /* storage unavailable */ } };
  useEffect(() => { try { localStorage.setItem(FOLDERS_KEY, folders); } catch { /* storage unavailable */ } }, [folders]);
  const sortBy = (c: Col) => { if (sort === c) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(c); setDir(FIRST_DIR[c]); } setPage(1); };
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Shift + click on a checkbox ticks (or unticks) every row between it and the last checkbox clicked, on this page.
  const anchor = useRef<string | null>(null);
  const shiftHeld = useRef(false);
  const { widths, setWidth } = useColumnWidths<Col>("dm-files-columns", COLUMNS);
  const tableRef = useRef<HTMLTableElement>(null);
  const showAccount = useMinWidth(768), showModified = useMinWidth(640);
  const tableWidth = EDGE * 2 + widths.name + widths.size + (showAccount ? widths.account : 0) + (showModified ? widths.modified : 0);
  const head = (c: Col, label: string, className?: string) => (
    <ResizableTh label={label} width={widths[c]} className={className} onResize={(w) => setWidth(c, w)}
      onSort={() => sortBy(c)} sorted={sort === c ? dir : null}
      onFit={() => { const w = fitColumn(tableRef.current, c); if (w) setWidth(c, w); }} />
  );
  const [renaming, setRenaming] = useState<DriveItem | null>(null);
  const [moving, setMoving] = useState<DriveItem | null>(null);
  const [deleting, setDeleting] = useState<DriveItem | null>(null);
  const [exporting, setExporting] = useState<DriveItem | null>(null);
  const [sharing, setSharing] = useState<DriveItem | null>(null);
  const [movingAcross, setMovingAcross] = useState<DriveItem | null>(null);
  const otherAccounts = (accounts.data ?? []).filter((a) => a.status === "ACTIVE").length > 1;
  const { openFile, dialog: openFileDialog } = useFileOpener(setExporting, setSharing);
  const [addTo, setAddTo] = useState<DriveItem[] | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState<DriveItem[] | null>(null);
  const [emptying, setEmptying] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [qInput]);
  // ?account=…&folder=…&name=… (from the upload panel's folder button) opens that account / folder, then tidies the URL.
  const linkAccount = search.get("account"), linkFolder = search.get("folder");
  useEffect(() => {
    if (!linkAccount) return;
    const target = linkFolder ? [{ accountId: linkAccount, id: linkFolder, name: search.get("name") ?? "Folder" }] : [];
    // The tab-reset effect below may run in the same pass (on first load or a tab change): hand it the folder to keep.
    pendingStack.current = target;
    setTimeout(() => { pendingStack.current = null; }, 0);
    setBaseLoc("my_drive"); setAccountId(linkFolder ? "" : linkAccount); setStack(target);
    const n = new URLSearchParams(search); ["account", "folder", "name"].forEach((k) => n.delete(k)); setSearch(n, { replace: true });
  }, [linkAccount, linkFolder]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sidebar search (or a shared link) sets ?q=: search everything, i.e. all accounts and every location except Trash.
  const urlQ = search.get("q") ?? "";
  useEffect(() => {
    if (urlQ === qInput) return;
    setQInput(urlQ);
    if (urlQ) { setAccountId(""); setBaseLoc("my_drive"); setStack([]); }
  }, [urlQ]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeSearch = (v: string) => {
    setQInput(v);
    const next = new URLSearchParams(search);
    if (v) next.set("q", v); else next.delete("q");
    setSearch(next, { replace: true });
  };
  useEffect(() => { setSel(new Set()); anchor.current = null; }, [loc, stack, q, accountId, type, page]);

  const top = stack[stack.length - 1];
  // "Upload files" starts in the folder being browsed (one account's My Drive or a shared drive); otherwise the defaults.
  const setUploadContext = useUploads((s) => s.setContext);
  useEffect(() => {
    setUploadContext(top && (loc === "my_drive" || loc === "shared_drive") && !q ? { accountId: top.accountId, folder: { id: top.id, name: top.name } } : {});
  }, [top?.id, top?.accountId, loc, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setUploadContext({}), []); // eslint-disable-line react-hooks/exhaustive-deps
  const flat = allFiles && loc !== "trash" && !q;
  const sharedRoot = loc === "shared_drive" && !top && !q && !flat;
  const params = new URLSearchParams({ sort, direction: dir, folders, page: String(page), page_size: "100" });
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  if (loc === "trash") params.set("trashed", "true");
  if (accountId && !top) params.set("account_id", accountId);
  if (flat) { params.set("all_files", "true"); params.set("location", loc); }
  else if (top && !q && loc !== "trash") { params.set("parent_id", top.id); params.set("account_id", top.accountId); }
  else if (!top && !q && loc !== "trash") params.set("location", loc);
  if (loc === "shared_drive" && (q)) params.set("location", "shared_drive");

  const files = useQuery({ queryKey: ["files", "list", params.toString()], enabled: !sharedRoot, queryFn: () => api.get<FilePage>(`/api/files?${params}`), placeholderData: (p) => p });
  const drives = useQuery({ queryKey: ["drives"], enabled: sharedRoot, queryFn: () => api.get<SharedDrive[]>("/api/drives") });
  const vtree = useQuery({ queryKey: ["virtual-tree"], queryFn: () => api.get<VFolder[]>("/api/virtual-folders") });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["files"] }); qc.invalidateQueries({ queryKey: ["storage"] }); };
  // Re-read storage numbers so the dashboard's trash and free space catch up (Google can still lag a few minutes).
  const refreshQuota = async (ids: string[]) => {
    await Promise.all([...new Set(ids)].map((id) => api.post(`/api/accounts/${id}/quota/refresh`).catch(() => undefined)));
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };
  const ok = (msg: string) => () => { toast.success(msg); refresh(); };
  const rename = useMutation({ mutationFn: (v: { it: DriveItem; name: string }) => api.patch(`/api/files/${v.it.account_id}/${v.it.google_file_id}`, { name: v.name }), onSuccess: () => { setRenaming(null); ok("Renamed.")(); }, onError });
  const trash = useMutation({ mutationFn: (it: DriveItem) => api.post(`/api/files/${it.account_id}/${it.google_file_id}/trash`), onSuccess: ok("Moved to Google Drive trash. You can restore it from Trash."), onError });
  const restore = useMutation({ mutationFn: (it: DriveItem) => api.post(`/api/files/${it.account_id}/${it.google_file_id}/restore`), onSuccess: (_r, it) => { ok("Restored.")(); refreshQuota([it.account_id]); }, onError });
  const purge = useMutation({ mutationFn: (it: DriveItem) => api.del(`/api/files/${it.account_id}/${it.google_file_id}?permanent=true&confirm=true`), onSuccess: (_r, it) => { setDeleting(null); ok("Deleted permanently.")(); refreshQuota([it.account_id]); }, onError });
  // Bulk actions in Trash: run one by one so a single failure doesn't stop the rest, then report.
  const bulk = useMutation({
    mutationFn: async (v: { items: DriveItem[]; action: "restore" | "delete" }) => {
      let done = 0; const failed: string[] = [];
      for (const it of v.items) {
        try {
          if (v.action === "restore") await api.post(`/api/files/${it.account_id}/${it.google_file_id}/restore`);
          else await api.del(`/api/files/${it.account_id}/${it.google_file_id}?permanent=true&confirm=true`);
          done++;
        } catch { failed.push(it.name); }
      }
      return { ...v, done, failed };
    },
    onSuccess: (r) => {
      setBulkDeleting(null); setSel(new Set()); refresh(); refreshQuota(r.items.map((i) => i.account_id));
      const verb = r.action === "restore" ? "Restored" : "Deleted permanently";
      if (r.failed.length) toast.error(`${verb} ${r.done} item(s). ${r.failed.length} failed: ${r.failed.slice(0, 3).join(", ")}${r.failed.length > 3 ? "…" : ""}`);
      else toast.success(`${verb} ${r.done} item(s).`);
    }, onError,
  });
  const emptyTrash = useMutation({
    mutationFn: async (ids: string[]) => {
      let removed = 0; const failed: string[] = [];
      for (const id of ids) {
        try { removed += (await api.post<{ removed: number }>(`/api/files/${id}/trash/empty?confirm=true`)).removed; }
        catch { failed.push((accounts.data ?? []).find((a) => a.id === id)?.email ?? id); }
      }
      return { removed, failed };
    },
    onSuccess: (r) => {
      setEmptying(false); setSel(new Set()); refresh(); qc.invalidateQueries({ queryKey: ["accounts"] });
      if (r.failed.length) toast.error(`Couldn't empty the trash for ${r.failed.join(", ")}. Check the Activity page or logs.`);
      else toast.success(`Trash emptied${r.removed ? ` (${r.removed} item${r.removed === 1 ? "" : "s"})` : ""}. Freed space can take a few minutes to show.`);
    }, onError,
  });
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
  const toggleRow = (id: string, checked: boolean) => {
    const n = new Set(sel);
    const from = anchor.current ? items.findIndex((i) => i.id === anchor.current) : -1;
    const to = items.findIndex((i) => i.id === id);
    if (shiftHeld.current && from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      for (const it of items.slice(a, b + 1)) { if (checked) n.add(it.id); else n.delete(it.id); }
    } else if (checked) n.add(id); else n.delete(id);
    shiftHeld.current = false;
    anchor.current = id;
    setSel(n);
  };
  const emptyTargets = (accounts.data ?? []).filter((a) => a.status === "ACTIVE" && (!accountId || a.id === accountId));
  const go = (l: Loc) => {
    if (l === "trash") setSearch({ view: "trash" });
    else { setBaseLoc(l); if (search.get("view")) setSearch({}); }
    setStack([]); setPage(1); setQInput("");
    if (search.get("q")) { const n = new URLSearchParams(search); n.delete("q"); if (l === "trash") n.set("view", "trash"); setSearch(n, { replace: true }); }
  };
  // Also reset when the view changes from outside (sidebar links, browser back/forward).
  const pendingStack = useRef<Crumb[] | null>(null);   // a folder link that arrived together with a tab change
  useEffect(() => { setStack(pendingStack.current ?? []); pendingStack.current = null; setPage(1); }, [loc]);
  const openFolder = (it: DriveItem) => { if (it.trashed) return; if (q) { typeSearch(""); setStack([{ accountId: it.account_id, id: it.google_file_id, name: it.name }]); } else setStack([...stack, { accountId: it.account_id, id: it.google_file_id, name: it.name }]); setPage(1); };

  // Right-click (or long-press) on a row opens the same actions as ⋮. If the row is part of a multi-selection,
  // the menu acts on every selected item instead. Shift + right-click keeps the browser's own menu.
  const ctx = useContextMenu();
  const longPress = useLongPress();
  const [ctxRow, setCtxRow] = useState<string | null>(null);
  useEffect(() => { if (!ctx.openFor) setCtxRow(null); }, [ctx.openFor]);
  const bulkMenu = (list: DriveItem[]) => loc === "trash" ? [
    { label: `Restore ${list.length} items`, icon: <RotateCcw className="h-4 w-4" />, disabled: !list.some((i) => i.can.untrash), onSelect: () => bulk.mutate({ items: list.filter((i) => i.can.untrash), action: "restore" }) },
    { label: "Delete permanently…", icon: <Trash2 className="h-4 w-4" />, danger: true, disabled: !list.some((i) => i.can.delete), onSelect: () => setBulkDeleting(list.filter((i) => i.can.delete)) },
  ] : [
    { label: "Add to virtual folder", icon: <Link2 className="h-4 w-4" />, onSelect: () => setAddTo(list) },
    { label: `Move ${list.length} items to trash`, icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: async () => { for (const i of list) if (i.can.trash) await trash.mutateAsync(i).catch(() => undefined); setSel(new Set()); } },
    { label: "Delete permanently…", icon: <Trash2 className="h-4 w-4" />, danger: true, disabled: !list.some((i) => i.can.delete), onSelect: () => setBulkDeleting(list.filter((i) => i.can.delete)) },
  ];
  const rowMenu = (it: DriveItem) => (sel.has(it.id) && sel.size > 1
    ? { items: bulkMenu(items.filter((i) => sel.has(i.id))), title: `${sel.size} selected` }
    : { items: menu(it), title: it.name });

  const menu = (it: DriveItem) => [
    { label: "Open in Google Drive", icon: <ExternalLink className="h-4 w-4" />, hidden: !it.web_view_link, onSelect: () => window.open(it.web_view_link!, "_blank", "noopener") },
    { label: "Download", icon: <Download className="h-4 w-4" />, hidden: it.is_folder || !it.can.download, onSelect: () => download(it, () => setExporting(it)) },
    { label: "Share…", icon: <Share2 className="h-4 w-4" />, hidden: it.trashed, onSelect: () => setSharing(it) },
    { label: "Copy link", icon: <Link className="h-4 w-4" />, hidden: it.trashed || !it.web_view_link, onSelect: () => copyLink(it) },
    { label: "Rename", icon: <Pencil className="h-4 w-4" />, hidden: it.trashed || !it.can.rename, onSelect: () => setRenaming(it) },
    { label: "Move to…", icon: <FolderInput className="h-4 w-4" />, hidden: it.trashed || !it.can.move, onSelect: () => setMoving(it) },
    { label: "Move to another account…", icon: <ArrowLeftRight className="h-4 w-4" />, hidden: it.trashed || it.is_folder || !!it.shortcut_target_id || !otherAccounts, onSelect: () => setMovingAcross(it) },
    { label: "Add to virtual folder", icon: <Link2 className="h-4 w-4" />, hidden: it.trashed, onSelect: () => setAddTo([it]) },
    { label: "Move to trash", icon: <Trash2 className="h-4 w-4" />, danger: true, hidden: it.trashed || !it.can.trash, onSelect: () => trash.mutate(it) },
    { label: "Restore", icon: <RotateCcw className="h-4 w-4" />, hidden: !it.trashed || !it.can.untrash, onSelect: () => restore.mutate(it) },
    { label: "Delete permanently…", icon: <Trash2 className="h-4 w-4" />, danger: true, hidden: !it.can.delete, onSelect: () => setDeleting(it) },
  ];

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Location" className="inline-flex rounded-md border bg-card p-0.5">
          {([["my_drive", "My Drive"], ["shared_with_me", "Shared with me"], ["shared_drive", "Shared drives"], ["trash", "Trash"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={loc === k} onClick={() => go(k)} className={cn("rounded px-3 py-1 text-sm", loc === k ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>{t}</button>))}
        </div>
        {canMkdir && <Button variant="outline" className="ml-auto" onClick={() => setNewFolder(true)}><FolderPlus className="h-4 w-4" />New folder</Button>}
      </div>
      {/* Filters on their own row; w-auto lets each select size to its longest option so labels never get cut off. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select aria-label="Account" className="w-auto max-w-xs" value={accountId} onChange={(e) => { setAccountId(e.target.value); setStack([]); setPage(1); }}>
          <option value="">All accounts</option>{(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{m.email(a.email)}</option>)}</Select>
        <Select aria-label="File type" className="w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Any type</option><option value="folder">Folders</option><option value="document">Documents</option><option value="spreadsheet">Spreadsheets</option><option value="presentation">Presentations</option><option value="pdf">PDFs</option><option value="image">Images</option><option value="video">Video</option><option value="audio">Audio</option><option value="archive">Archives</option><option value="other">Other</option></Select>
        <Select aria-label="Sort" className="w-auto" value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); setSort(s); setDir(d as "asc" | "desc"); setPage(1); }}>
          <option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="account:asc">Account A–Z</option><option value="account:desc">Account Z–A</option><option value="modified:desc">Newest first</option><option value="modified:asc">Oldest first</option><option value="size:desc">Largest first</option><option value="size:asc">Smallest first</option></Select>
        <Select aria-label="Folder placement" className="w-auto" value={folders} onChange={(e) => { setFolders(e.target.value as FolderPlacement); setPage(1); }}>
          <option value="first">Folders first</option><option value="last">Files first</option><option value="mixed">Mixed together</option></Select>
        {loc !== "trash" && (
          <label className={cn("flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", allFiles ? "border-primary/60 bg-accent text-accent-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
            title="List every file in every folder of this tab as one flat list">
            <input type="checkbox" checked={allFiles} onChange={(e) => setAllFiles(e.target.checked)} />Show all files</label>)}
      </div>
      <div className="relative mb-4"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search files" className="pl-8" placeholder="Search by name across accounts…" value={qInput} onChange={(e) => typeSearch(e.target.value)} /></div>

      {(stack.length > 0 && !q) && (
        <nav aria-label="Folder path" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
          <button className="rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => setStack([])}>{{ my_drive: "My Drive", shared_with_me: "Shared with me", shared_drive: "Shared drives", trash: "Trash" }[loc]}</button>
          {stack.map((c, i) => <span key={`${c.id}${i}`} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><button className={cn("rounded px-1.5 py-0.5 hover:bg-accent", i === stack.length - 1 && "font-semibold")} onClick={() => setStack(stack.slice(0, i + 1))}>{c.name}</button></span>)}
        </nav>)}
      {loc === "trash" && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">Items in trash still use storage. Google deletes them for good after 30 days.</span>
          <Button size="sm" variant="outline" className="text-destructive" disabled={emptyTargets.length === 0 || items.length === 0 || emptyTrash.isPending} onClick={() => setEmptying(true)}>
            <Trash2 className="h-3.5 w-3.5" />{accountId ? "Empty this account's trash…" : "Empty trash (all accounts)…"}</Button>
        </div>)}
      {q && <p className="mb-3 text-sm text-muted-foreground">Search results for “{q}”{loc === "trash" ? " in Trash" : ""}.</p>}

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          <b>{selected.length} selected</b>
          {loc !== "trash" && <Button size="sm" variant="outline" onClick={() => setAddTo(selected)}><Link2 className="h-3.5 w-3.5" />Add to virtual folder</Button>}
          {loc !== "trash" && <Button size="sm" variant="outline" className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={async () => { for (const i of selected) if (i.can.trash) await trash.mutateAsync(i).catch(() => undefined); setSel(new Set()); }}><Trash2 className="h-3.5 w-3.5" />Move to trash</Button>}
          {loc === "trash" && <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate({ items: selected.filter((i) => i.can.untrash), action: "restore" })}><RotateCcw className="h-3.5 w-3.5" />Restore</Button>}
          <Button size="sm" variant="destructive" disabled={bulk.isPending || !selected.some((i) => i.can.delete)} onClick={() => setBulkDeleting(selected.filter((i) => i.can.delete))}><Trash2 className="h-3.5 w-3.5" />Delete permanently…</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
        </div>)}

      <Card className="overflow-hidden">
        {sharedRoot ? (
          drives.isLoading ? <Spinner /> : (drives.data ?? []).filter((d) => !accountId || d.account_id === accountId).length === 0 ? <EmptyState icon={<Users className="h-8 w-8" />} title="No shared drives">None of your connected accounts are members of a shared drive.</EmptyState> : (
            <ul className="divide-y">{drives.data!.filter((d) => !accountId || d.account_id === accountId).map((d) => (
              <li key={d.account_id + d.id}><button onClick={() => setStack([{ accountId: d.account_id, id: d.id, name: d.name }])} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"><Users className="h-4 w-4 text-primary" /><span className="flex-1 font-medium">{d.name}</span><AccountChip id={d.account_id} email={m.email(d.account_email)} /></button></li>))}</ul>)
        ) : files.isLoading ? <Spinner /> : items.length === 0 ? (
          <EmptyState icon={<FolderTree className="h-8 w-8" />} title={q ? "No matches" : loc === "trash" ? "Trash is empty" : (accounts.data ?? []).length === 0 ? "No accounts connected" : "Nothing in this folder"}>
            {!q && (accounts.data ?? []).some((a) => !a.initial_scan_complete) ? "Some accounts are still being indexed for the first time. Files appear as the scan progresses." : undefined}</EmptyState>
        ) : (
          <div className="overflow-x-auto"><table ref={tableRef} className="min-w-full table-fixed text-sm" style={{ width: tableWidth }}>
            <colgroup>
              <col style={{ width: EDGE }} /><col style={{ width: widths.name }} />
              <col className="hidden md:table-column" style={{ width: widths.account }} />
              <col className="hidden sm:table-column" style={{ width: widths.modified }} />
              <col style={{ width: widths.size }} /><col /><col style={{ width: EDGE }} />
            </colgroup>
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>
              <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Select all" checked={selected.length === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} /></th>
              {head("name", "Name")}{head("account", "Account", "hidden md:table-cell")}{head("modified", "Modified", "hidden sm:table-cell")}{head("size", "Size", "text-right")}<th /><th className={STICKY_TH} aria-label="Actions" /></tr></thead>
            <tbody className="divide-y">{items.map((it) => (
              <tr key={it.id} className={cn("group", sel.has(it.id) ? "bg-accent/50 hover:bg-accent/50 hover:shadow-[inset_0_0_0_9999px_rgb(0_0_0/0.18)]" : "hover:bg-muted/40", ctxRow === it.id && "bg-muted/60 outline outline-1 -outline-offset-1 outline-primary/50")}
                onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); /* no text highlighting on shift-click */ }}
                onClick={(e) => {
                  if (!e.shiftKey || (e.target as HTMLElement).closest("button, a, input, select, label")) return;
                  shiftHeld.current = true; toggleRow(it.id, !sel.has(it.id));
                }}
                onContextMenu={(e) => { const m = rowMenu(it); if (ctx.onContextMenu(e, m.items, m.title)) setCtxRow(it.id); }}
                {...longPress((x, y) => { const m = rowMenu(it); ctx.openAt(x, y, m.items, m.title); setCtxRow(it.id); })}>
                <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${it.name}`} title="Shift + click to select a range" checked={sel.has(it.id)}
                  onClick={(e) => { shiftHeld.current = e.shiftKey; }} onChange={(e) => toggleRow(it.id, e.target.checked)} /></td>
                <td data-col="name" className="px-2 py-2"><div className="flex min-w-0 items-center gap-2.5"><FileIcon mime={it.mime_type} />
                  {it.is_folder ? <button className="truncate text-left font-medium hover:underline" title={it.name} onClick={() => openFolder(it)}>{it.name}</button> : <button className="truncate text-left hover:underline" title={`${it.name}: download or open in Google Drive`} onClick={() => openFile(it)}>{it.name}</button>}
                  {it.location === "SHARED_WITH_ME" && <span className="shrink-0 rounded bg-secondary px-1.5 text-[11px] text-muted-foreground">shared</span>}</div>
                  {flat && it.parent && <button className="ml-7 block max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline" title={`Open the folder “${it.parent.name}”`}
                    onClick={() => { setAllFiles(false); setStack([{ accountId: it.account_id, id: it.parent!.id, name: it.parent!.name }]); }}>in {it.parent.name}</button>}</td>
                <td data-col="account" className="hidden px-2 py-2 md:table-cell"><AccountChip id={it.account_id} email={it.account_email} /></td>
                <td data-col="modified" className="hidden px-2 py-2 text-muted-foreground sm:table-cell"><span className="block truncate">{when(it.modified_time)}</span></td>
                <td data-col="size" className="px-2 py-2 text-right text-muted-foreground"><span className="block truncate">{it.is_folder ? "—" : bytes(it.size)}</span></td>
                <td />
                <td className={cn(STICKY_TD, sel.has(it.id) && "before:bg-accent/50 group-hover:before:bg-accent/50 group-hover:shadow-[inset_0_0_0_9999px_rgb(0_0_0/0.18),-6px_0_6px_-6px_rgb(0_0_0/0.35)]")}><div className="relative"><RowMenu items={menu(it)} label={`Actions for ${it.name}`} /></div></td></tr>))}</tbody></table></div>)}
        {!sharedRoot && total > 100 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm"><span className="text-muted-foreground">{total.toLocaleString()} items</span>
            <div className="flex items-center gap-2"><Button size="icon" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button><span>Page {page} of {pages}</span><Button size="icon" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button></div></div>)}
      </Card>

      {renaming && <PromptDialog open onOpenChange={(o) => !o && setRenaming(null)} title="Rename" label="New name" initial={renaming.name} confirmLabel="Rename" busy={rename.isPending} onSubmit={(name) => rename.mutate({ it: renaming, name })} />}
      {newFolder && <PromptDialog open onOpenChange={setNewFolder} title="New folder" label={`Folder name${top ? ` (inside ${top.name})` : ""}`} confirmLabel="Create" busy={mkdir.isPending} onSubmit={(n) => mkdir.mutate(n)} />}
      <Dialog open={!!moving} onOpenChange={(o) => !o && setMoving(null)} title={`Move “${moving?.name ?? ""}”`} description="Items can be moved within the same account.">
        {moving && <FolderPicker accountId={moving.account_id} label="Move here" onCancel={() => setMoving(null)} onPick={(f) => move.mutate({ it: moving, dest: f.id ?? "root" })} />}</Dialog>
      <DoubleConfirm open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete permanently?" confirmLabel="Delete forever" busy={purge.isPending}
        items={deleting ? [{ name: deleting.name, size: deleting.size, isFolder: deleting.is_folder }] : []} onConfirm={() => deleting && purge.mutate(deleting)}>
        “{deleting?.name}” will be removed from Google Drive right away{deleting && !deleting.trashed ? ", without going to the trash first" : ""}.
        {deleting?.is_folder ? " Everything inside this folder that you own is deleted with it." : ""} This can't be undone.</DoubleConfirm>
      <DoubleConfirm open={!!bulkDeleting} onOpenChange={(o) => !o && setBulkDeleting(null)} title={`Delete ${bulkDeleting?.length ?? 0} item(s) permanently?`} confirmLabel="Delete forever" busy={bulk.isPending}
        items={(bulkDeleting ?? []).map((i) => ({ name: i.name, size: i.size, isFolder: i.is_folder }))}
        onConfirm={() => bulkDeleting && bulk.mutate({ items: bulkDeleting, action: "delete" })}>
        The selected items will be removed from Google Drive right away{loc !== "trash" ? ", without going to the trash first" : ""}.
        {bulkDeleting?.some((i) => i.is_folder) ? " Everything you own inside the selected folders is deleted with them." : ""} This can't be undone.</DoubleConfirm>
      <DoubleConfirm open={emptying} onOpenChange={setEmptying} title="Empty trash?" confirmLabel="Empty trash" finalLabel="Empty trash permanently" busy={emptyTrash.isPending}
        items={async () => {
          const out: DoomedItem[] = [];
          for (const a of emptyTargets) {
            for (let page = 1; ; page++) {
              const r = await api.get<FilePage>(`/api/files?${new URLSearchParams({ trashed: "true", account_id: a.id, page: String(page), page_size: "500" })}`);
              r.items.filter((i) => i.owned_by_me && !i.drive_id).forEach((i) => out.push({ name: i.name, size: i.size, isFolder: i.is_folder }));
              if (page * 500 >= r.total) break;
            }
          }
          return out;
        }}
        onConfirm={() => emptyTrash.mutate(emptyTargets.map((a) => a.id))}>
        Everything in the Google Drive trash of {emptyTargets.length === 1 ? m.email(emptyTargets[0].email) : `all ${emptyTargets.length} connected accounts`} will be deleted permanently. This can't be undone.
        Shared-drive trash and files owned by other people aren't affected.</DoubleConfirm>
      <ExportDialog item={exporting} onClose={() => setExporting(null)} />
      {openFileDialog}
      {ctx.node}
      <ShareDialog item={sharing} onClose={() => setSharing(null)} />
      <MoveAccountDialog item={movingAcross} onClose={() => setMovingAcross(null)} />
      <VirtualFolderPicker open={!!addTo} title="Add to virtual folder" confirmLabel="Add" folders={vtree.data ?? []} onClose={() => setAddTo(null)}
        onPick={(id) => addTo && addItems.mutate({ folderId: id, items: addTo })}
        onCreate={async (name) => { const f = await api.post<{ id: string }>("/api/virtual-folders", { name, parent_id: null }); qc.invalidateQueries({ queryKey: ["virtual-tree"] }); return f.id; }} />
    </>
  );
}
