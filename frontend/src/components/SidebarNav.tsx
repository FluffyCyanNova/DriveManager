import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDown, ArrowUp, BarChart3, FolderTree, GripVertical, LayoutDashboard, Link2, Pin, PinOff, Settings, Trash2, UploadCloud, Users } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { create } from "zustand";
import { Link, useLocation } from "react-router-dom";
import { onError } from "@/components/Common";
import { useContextMenu, useLongPress } from "@/components/ui/contextmenu";
import { api } from "@/services/api";
import { cn } from "@/utils/cn";

type Icon = typeof FolderTree;
export interface NavItem { key: string; to: string; label: string; icon: Icon }
export interface SidebarState { order: string[]; pinned: string[]; default: string[]; default_pinned: string[]; customized: boolean }

export const NAV_ITEMS: Record<string, NavItem> = Object.fromEntries(([
  { key: "dashboard", to: "/", label: "Dashboard", icon: LayoutDashboard },
  { key: "uploads", to: "/uploads", label: "Uploads", icon: UploadCloud },
  { key: "files", to: "/files", label: "Files", icon: FolderTree },
  { key: "trash", to: "/files?view=trash", label: "Trash", icon: Trash2 },
  { key: "accounts", to: "/accounts", label: "Accounts", icon: Users },
  { key: "virtual", to: "/files?view=virtual", label: "Virtual folders", icon: Link2 },
  { key: "activity", to: "/activity", label: "Activity", icon: Activity },
  { key: "analytics", to: "/analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", to: "/settings", label: "Settings", icon: Settings },
] as NavItem[]).map((i) => [i.key, i]));
const FALLBACK: SidebarState = { order: Object.keys(NAV_ITEMS), pinned: ["dashboard"], default: Object.keys(NAV_ITEMS), default_pinned: ["dashboard"], customized: false };

// The server is the source of truth; the last state seen is kept in this browser only to avoid a flash on page load.
const CACHE = "dm-sidebar";
const remember = (st: SidebarState) => { try { localStorage.setItem(CACHE, JSON.stringify(st)); } catch { /* storage unavailable */ } };
const cached = (): SidebarState | undefined => {
  try { const v = JSON.parse(localStorage.getItem(CACHE) ?? "null"); return v && Array.isArray(v.pinned) ? v : undefined; } catch { return undefined; }
};

/** Sidebar order + pins, saved on the server, with optimistic updates. Used by the sidebar and Settings. */
export function useSidebar() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sidebar"],
    queryFn: async () => { const s = await api.get<SidebarState>("/api/settings/sidebar"); remember(s); return s; },
    initialData: cached, initialDataUpdatedAt: 0, staleTime: 5 * 60_000,
  });
  const state = q.data ?? FALLBACK;
  const settle = (s: SidebarState) => { qc.setQueryData(["sidebar"], s); remember(s); };
  const save = useMutation({
    mutationFn: (v: { order: string[]; pinned: string[] }) => api.put<SidebarState>("/api/settings/sidebar", v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["sidebar"] });
      const prev = qc.getQueryData<SidebarState>(["sidebar"]);
      qc.setQueryData<SidebarState>(["sidebar"], { ...(prev ?? FALLBACK), ...v, customized: true });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["sidebar"], ctx.prev); onError(e); },
    onSuccess: settle,
  });
  const reset = useMutation({ mutationFn: () => api.del<SidebarState>("/api/settings/sidebar"), onSuccess: settle, onError });

  const order = state.order.filter((k) => NAV_ITEMS[k]);
  const pinned = state.pinned.filter((k) => NAV_ITEMS[k]);
  const unpinned = order.filter((k) => !pinned.includes(k));
  const togglePin = (key: string) => save.mutate({ order, pinned: pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key] });
  /** Move an item one step within its own group (pinned items among pinned, others among others). */
  const step = (key: string, dir: -1 | 1) => {
    if (pinned.includes(key)) {
      const i = pinned.indexOf(key), j = i + dir;
      if (j < 0 || j >= pinned.length) return;
      const next = [...pinned]; [next[i], next[j]] = [next[j], next[i]];
      save.mutate({ order, pinned: next });
    } else {
      const i = unpinned.indexOf(key), j = i + dir;
      if (j < 0 || j >= unpinned.length) return;
      const a = order.indexOf(unpinned[i]), b = order.indexOf(unpinned[j]);
      const next = [...order]; [next[a], next[b]] = [next[b], next[a]];
      save.mutate({ order: next, pinned });
    }
  };
  /** Drag-and-drop among unpinned items: put `key` before/after `target`. */
  const place = (key: string, target: string, after: boolean) => {
    if (key === target || pinned.includes(key) || pinned.includes(target)) return;
    const rest = order.filter((k) => k !== key);
    const i = rest.indexOf(target) + (after ? 1 : 0);
    const next = [...rest.slice(0, i), key, ...rest.slice(i)];
    if (next.join() !== order.join()) save.mutate({ order: next, pinned });
  };
  return { state, order, pinned, unpinned, togglePin, step, place, reset, saving: save.isPending };
}

/** Which item is the current page. Files, Trash and Virtual folders share /files and differ by ?view=. */
function activeKey(pathname: string, search: string): string | null {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/files")) {
    const v = new URLSearchParams(search).get("view");
    return v === "trash" ? "trash" : v === "virtual" ? "virtual" : "files";
  }
  return Object.values(NAV_ITEMS).find((i) => i.to !== "/" && !i.to.startsWith("/files") && pathname.startsWith(i.to))?.key ?? null;
}

const itemCls = (active: boolean, pinned: boolean, collapsed: boolean) => cn(
  "relative flex shrink-0 items-center gap-2.5 rounded-md py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
  collapsed ? "justify-center px-0 md:h-10 md:w-10" : "px-3 md:pr-8",
  pinned && "border border-black/40",
  active && "bg-accent text-accent-foreground",
);

export function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const loc = useLocation();
  const current = activeKey(loc.pathname, loc.search);
  const sb = useSidebar();
  const ctx = useContextMenu();
  const longPress = useLongPress();
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);

  const menuFor = (key: string) => {
    const isPinned = sb.pinned.includes(key);
    const group = isPinned ? sb.pinned : sb.unpinned;
    const i = group.indexOf(key);
    return [
      { label: isPinned ? "Unpin" : "Pin to top", icon: isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />, onSelect: () => sb.togglePin(key) },
      { label: "Move up", icon: <ArrowUp className="h-4 w-4" />, disabled: i <= 0, onSelect: () => sb.step(key, -1) },
      { label: "Move down", icon: <ArrowDown className="h-4 w-4" />, disabled: i >= group.length - 1, onSelect: () => sb.step(key, 1) },
    ];
  };

  const onDragOver = (e: DragEvent, key: string) => {
    if (!dragging || sb.pinned.includes(key)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (drop?.key !== key || drop.after !== after) setDrop({ key, after });
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); if (dragging && drop) sb.place(dragging, drop.key, drop.after); setDragging(null); setDrop(null); };
  const onKey = (e: KeyboardEvent, key: string) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    sb.step(key, e.key === "ArrowUp" ? -1 : 1);
  };

  const row = (key: string, isPinned: boolean) => {
    const it = NAV_ITEMS[key];
    const Icon = it.icon;
    const showLine = !isPinned && drop?.key === key && dragging && dragging !== key;
    const open = ctx.openFor?.title === it.label;
    return (
      <div key={key} className="group relative shrink-0" onDragOver={(e) => onDragOver(e, key)} onDrop={onDrop}>
        {showLine && <span className={cn("pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded bg-primary", drop!.after ? "-bottom-0.5" : "-top-0.5")} />}
        <Link to={it.to} aria-current={current === key ? "page" : undefined} aria-label={collapsed ? it.label : undefined}
          draggable={!isPinned}
          onDragStart={(e) => { setDragging(key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }}
          onDragEnd={() => { setDragging(null); setDrop(null); }}
          onKeyDown={(e) => onKey(e, key)}
          onContextMenu={(e) => ctx.onContextMenu(e, () => menuFor(key), it.label)}
          {...longPress((x, y) => ctx.openAt(x, y, menuFor(key), it.label))}
          title={collapsed ? `${it.label}${isPinned ? " (pinned)" : ""}` : isPinned ? "Pinned. Right-click or long-press for options" : "Drag to reorder (or Alt + ↑/↓). Right-click or long-press for options"}
          className={cn(itemCls(current === key, isPinned, collapsed), dragging === key && "opacity-40", open && "ring-1 ring-primary/60")}>
          <Icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1">{it.label}</span>}
          {!collapsed && !isPinned && <GripVertical aria-hidden className="hidden h-3.5 w-3.5 cursor-grab opacity-0 transition-opacity group-hover:opacity-50 md:block" />}
          {collapsed && isPinned && <Pin aria-hidden className="absolute right-0.5 top-0.5 hidden h-2.5 w-2.5 fill-current opacity-60 md:block" />}
        </Link>
        {/* wide desktop: pin button on hover (always visible on pinned items) */}
        {!collapsed && (
          <button type="button" onClick={() => sb.togglePin(key)} aria-label={isPinned ? `Unpin ${it.label}` : `Pin ${it.label} to the top`}
            title={isPinned ? "Unpin" : "Pin to the top"}
            className={cn("absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground md:block",
              isPinned ? "opacity-60" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-60")}>
            <Pin className={cn("h-3 w-3", isPinned && "fill-current")} />
          </button>)}
      </div>
    );
  };

  return (
    <nav aria-label="Main" className={cn("flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0", collapsed && "md:items-center")}>
      {/* Pinned group. On phones it sticks to the left on a solid strip that covers items scrolling underneath. */}
      {sb.pinned.length > 0 && (
        <div className={cn("sticky -left-2 z-10 -ml-2 flex shrink-0 gap-1 bg-card pl-2 pr-1 after:pointer-events-none after:absolute after:-right-4 after:top-0 after:h-full after:w-4 after:bg-gradient-to-r after:from-card after:to-transparent after:content-[''] md:static md:m-0 md:flex-col md:p-0 md:pb-1 md:after:hidden", collapsed && "md:items-center")}>
          {sb.pinned.map((k) => row(k, true))}
        </div>
      )}
      {sb.unpinned.map((k) => row(k, false))}
      {ctx.node}
    </nav>
  );
}

// ---------------- desktop sidebar width (this browser only) ----------------
export const SIDEBAR_MIN = 200, SIDEBAR_MAX = 360, SIDEBAR_DEFAULT_W = 224, SIDEBAR_ICONS = 64;
const WIDTH_KEY = "dm-sidebar-width";
const readWidth = (): { width: number; collapsed: boolean } => {
  try {
    const v = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? "null");
    if (v && typeof v.width === "number") return { width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v.width)), collapsed: !!v.collapsed };
  } catch { /* storage unavailable */ }
  return { width: SIDEBAR_DEFAULT_W, collapsed: false };
};
const saveWidth = (v: { width: number; collapsed: boolean }) => { try { localStorage.setItem(WIDTH_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };
export const useSidebarWidth = create<{ width: number; collapsed: boolean; set: (v: Partial<{ width: number; collapsed: boolean }>) => void; reset: () => void }>((setState, get) => ({
  ...readWidth(),
  set: (v) => { const next = { width: v.width ?? get().width, collapsed: v.collapsed ?? get().collapsed }; saveWidth(next); setState(next); },
  reset: () => { const next = { width: SIDEBAR_DEFAULT_W, collapsed: false }; saveWidth(next); setState(next); },
}));
