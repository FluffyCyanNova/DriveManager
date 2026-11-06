import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BarChart3, FolderTree, GripVertical, LayoutDashboard, Link2, Pin, Settings, Trash2, UploadCloud, Users } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { onError } from "@/components/Common";
import { api } from "@/services/api";
import { cn } from "@/utils/cn";

type Icon = typeof FolderTree;
interface Item { key: string; to: string; label: string; icon: Icon }
export interface SidebarState { order: string[]; default: string[]; customized: boolean }

// Dashboard is pinned first and isn't reorderable. The rest follow the order saved on the server.
const DASHBOARD: Item = { key: "dashboard", to: "/", label: "Dashboard", icon: LayoutDashboard };
const ITEMS: Record<string, Item> = Object.fromEntries(([
  { key: "files", to: "/files", label: "Files", icon: FolderTree },
  { key: "trash", to: "/files?view=trash", label: "Trash", icon: Trash2 },
  { key: "virtual", to: "/files?view=virtual", label: "Virtual folders", icon: Link2 },
  { key: "uploads", to: "/uploads", label: "Uploads", icon: UploadCloud },
  { key: "accounts", to: "/accounts", label: "Accounts", icon: Users },
  { key: "activity", to: "/activity", label: "Activity", icon: Activity },
  { key: "analytics", to: "/analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", to: "/settings", label: "Settings", icon: Settings },
] as Item[]).map((i) => [i.key, i]));
const FALLBACK = Object.keys(ITEMS);

// The server is the source of truth; the last order seen is kept in this browser only to avoid a flash of the
// default order while the page loads.
const CACHE = "dm-sidebar-order";
export const rememberSidebar = (st: SidebarState) => { try { localStorage.setItem(CACHE, JSON.stringify(st)); } catch { /* storage unavailable */ } };
const cached = (): SidebarState | undefined => { try { const v = localStorage.getItem(CACHE); return v ? JSON.parse(v) : undefined; } catch { return undefined; } };
export const useSidebarOrder = () => useQuery({
  queryKey: ["sidebar"],
  queryFn: async () => {
    const s = await api.get<SidebarState>("/api/settings/sidebar");
    rememberSidebar(s);
    return s;
  },
  initialData: cached, initialDataUpdatedAt: 0,   // shown instantly, then refreshed from the server
  staleTime: 5 * 60_000,
});

/** Which item is the current page. Files, Trash and Virtual folders share /files and differ by ?view=. */
function activeKey(pathname: string, search: string): string | null {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/files")) {
    const v = new URLSearchParams(search).get("view");
    return v === "trash" ? "trash" : v === "virtual" ? "virtual" : "files";
  }
  const hit = Object.values(ITEMS).find((i) => !i.to.includes("?") && i.to !== "/files" && pathname.startsWith(i.to));
  return hit?.key ?? null;
}

const itemCls = (active: boolean) => cn(
  "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
  active && "bg-accent text-accent-foreground",
);

export function SidebarNav() {
  const qc = useQueryClient();
  const loc = useLocation();
  const current = activeKey(loc.pathname, loc.search);
  const q = useSidebarOrder();
  const order = (q.data?.order ?? FALLBACK).filter((k) => ITEMS[k]);
  const save = useMutation({
    mutationFn: (next: string[]) => api.put<SidebarState>("/api/settings/sidebar", { order: next }),
    onMutate: async (next) => {           // update instantly; roll back if the server refuses
      await qc.cancelQueries({ queryKey: ["sidebar"] });
      const prev = qc.getQueryData<SidebarState>(["sidebar"]);
      if (prev) qc.setQueryData<SidebarState>(["sidebar"], { ...prev, order: next, customized: true });
      return { prev };
    },
    onError: (e, _n, ctx) => { if (ctx?.prev) qc.setQueryData(["sidebar"], ctx.prev); onError(e); },
    onSuccess: (s) => { qc.setQueryData(["sidebar"], s); rememberSidebar(s); },
  });

  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);

  const reorder = (key: string, target: string, after: boolean) => {
    if (key === target) return;
    const rest = order.filter((k) => k !== key);
    const i = rest.indexOf(target) + (after ? 1 : 0);
    const next = [...rest.slice(0, i), key, ...rest.slice(i)];
    if (next.join() !== order.join()) save.mutate(next);
  };
  const onDragOver = (e: DragEvent, key: string) => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (drop?.key !== key || drop.after !== after) setDrop({ key, after });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragging && drop) reorder(dragging, drop.key, drop.after);
    setDragging(null); setDrop(null);
  };
  const onKey = (e: KeyboardEvent, key: string) => {          // Alt + ↑/↓ moves the focused item
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = order.indexOf(key), j = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
    save.mutate(next);
  };

  const D = DASHBOARD.icon;
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0">
      {/* Pinned: always first, outlined so it reads as fixed. */}
      <Link to="/" aria-current={current === "dashboard" ? "page" : undefined} title="Pinned to the top"
        className={cn(itemCls(current === "dashboard"), "sticky left-0 z-10 border border-black/40 bg-card md:static md:mb-1",
          current === "dashboard" && "bg-accent")}>
        <D className="h-4 w-4" /><span className="flex-1">{DASHBOARD.label}</span><Pin className="hidden h-3 w-3 opacity-50 md:block" />
      </Link>
      {order.map((key) => {
        const it = ITEMS[key];
        const Icon = it.icon;
        const showLine = drop?.key === key && dragging && dragging !== key;
        return (
          <div key={key} className="relative shrink-0" onDragOver={(e) => onDragOver(e, key)} onDrop={onDrop}>
            {showLine && <span className={cn("pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded bg-primary", drop!.after ? "-bottom-0.5" : "-top-0.5")} />}
            <Link to={it.to} aria-current={current === key ? "page" : undefined}
              draggable onDragStart={(e) => { setDragging(key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }}
              onDragEnd={() => { setDragging(null); setDrop(null); }}
              onKeyDown={(e) => onKey(e, key)}
              title="Drag to reorder (or Alt + ↑/↓)"
              className={cn(itemCls(current === key), "group", dragging === key && "opacity-40")}>
              <Icon className="h-4 w-4" /><span className="flex-1">{it.label}</span>
              <GripVertical aria-hidden className="hidden h-3.5 w-3.5 cursor-grab opacity-0 transition-opacity group-hover:opacity-50 md:block" />
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
