import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MenuItem } from "@/components/ui/menu";
import { cn } from "@/utils/cn";

const WIDTH = 224;
const MARGIN = 8;

/**
 * Our own right-click menu, opened at the pointer. Shift + right-click is left alone so the browser's menu (Copy,
 * Inspect…) is still available. Closes on outside click, Escape, scroll or resize, and flips to stay on screen.
 */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setState(null), []);

  const openAt = useCallback((x: number, y: number, items: MenuItem[], title?: string) => {
    const visible = items.filter((i) => !i.hidden);
    if (visible.length) setState({ x, y, items: visible, title });
  }, []);
  /** onContextMenu handler. Returns false (and does nothing) for Shift + right-click. */
  const onContextMenu = useCallback((e: RMouseEvent, items: MenuItem[] | (() => MenuItem[]), title?: string) => {
    if (e.shiftKey) return false;
    e.preventDefault();
    e.stopPropagation();
    // keyboard menu key / Shift+F10 reports 0,0: anchor to the element instead
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX || r.left + 16, y = e.clientY || r.bottom;
    openAt(x, y, typeof items === "function" ? items() : items, title);
    return true;
  }, [openAt]);

  useLayoutEffect(() => {
    if (!state || !ref.current) { setPos(null); return; }
    const h = ref.current.offsetHeight;
    const left = Math.min(Math.max(state.x, MARGIN), window.innerWidth - WIDTH - MARGIN);
    const top = state.y + h + MARGIN > window.innerHeight ? Math.max(MARGIN, state.y - h) : state.y;
    setPos({ top, left });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const outside = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", outside, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true); document.removeEventListener("contextmenu", outside, true);
      document.removeEventListener("keydown", esc); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close);
    };
  }, [state, close]);

  const node: ReactNode = state ? createPortal(
    <div ref={ref} role="menu" aria-label={state.title ?? "Actions"} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
      className={cn("fixed z-50 rounded-md border bg-card p-1 shadow-lg", !pos && "invisible")} onContextMenu={(e) => e.preventDefault()}>
      {state.title && <p className="truncate px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{state.title}</p>}
      {state.items.map((i) => (
        <button key={i.label} role="menuitem" disabled={i.disabled} onClick={() => { close(); i.onSelect(); }}
          className={cn("flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40", i.danger && "text-destructive")}>
          {i.icon}{i.label}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return { openAt, onContextMenu, close, node, openFor: state };
}

/**
 * Long-press on touch screens (500 ms, cancelled by moving more than ~10 px so scrolling still works).
 * Call once per component, then spread `bind(cb)` on each element (works inside lists). `onClickCapture` swallows the
 * click that follows a long-press so it doesn't also open the item underneath.
 */
export function useLongPress() {
  const t = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => { if (t.current) window.clearTimeout(t.current); t.current = null; };
  return (onLong: (x: number, y: number) => void) => ({
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType !== "touch") return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      t.current = window.setTimeout(() => { fired.current = true; onLong(start.current!.x, start.current!.y); }, 500);
    },
    onPointerMove: (e: RPointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: RMouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } },
  });
}
