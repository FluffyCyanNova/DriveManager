import { MoreVertical } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean; disabled?: boolean }

const WIDTH = 224; // w-56
const GAP = 4;
const MARGIN = 8;  // keep this far from the window edges

/**
 * A "⋮" button with a dropdown menu. The menu is rendered in a portal with fixed positioning, so it floats above
 * everything instead of stretching or scrolling the table/card it sits in. It opens below the button, or above it when
 * there isn't room, and closes on outside click, Escape, scroll or resize.
 */
export function RowMenu({ items, label = "Actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !button.current) { setPos(null); return; }
    const b = button.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? 0;
    const below = b.bottom + GAP;
    const top = below + h + MARGIN > window.innerHeight && b.top - GAP - h >= MARGIN ? b.top - GAP - h : below;
    const left = Math.min(Math.max(b.right - WIDTH, MARGIN), window.innerWidth - WIDTH - MARGIN);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); button.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);   // any scroll (page or table) would detach the menu from its row
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <>
      <button ref={button} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        className={cn("rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground", open && "bg-accent text-foreground")}>
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" aria-label={label} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
          className={cn("fixed z-50 rounded-md border bg-card p-1 shadow-lg", !pos && "invisible")}>
          {visible.map((i) => (
            <button key={i.label} role="menuitem" disabled={i.disabled} onClick={() => { setOpen(false); i.onSelect(); }}
              className={cn("flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40", i.danger && "text-destructive")}>
              {i.icon}{i.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
