import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/utils/cn";

export interface ColumnSpec { width: number; min: number; max?: number }
type Widths<K extends string> = Record<K, number>;

const clamp = (v: number, s: ColumnSpec) => Math.round(Math.min(s.max ?? 1600, Math.max(s.min, v)));

/** Column widths that the user can drag, saved per table in localStorage. */
export function useColumnWidths<K extends string>(storageKey: string, specs: Record<K, ColumnSpec>) {
  const keys = Object.keys(specs) as K[];
  const defaults = () => Object.fromEntries(keys.map((k) => [k, specs[k].width])) as Widths<K>;
  const [widths, setWidths] = useState<Widths<K>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Widths<K>>;
      return Object.fromEntries(keys.map((k) => [k, typeof saved[k] === "number" ? clamp(saved[k]!, specs[k]) : specs[k].width])) as Widths<K>;
    } catch { return defaults(); }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* storage unavailable */ }
  }, [storageKey, widths]);
  const setWidth = useCallback((k: K, w: number) => setWidths((p) => ({ ...p, [k]: clamp(w, specs[k]) })), [specs]);
  const reset = useCallback(() => { setWidths(defaults()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { widths, setWidth, reset };
}

/** Tracks a Tailwind breakpoint so hidden columns don't count toward the table width. */
export function useMinWidth(px: number) {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return ok;
}

/** Natural (untruncated) width of a cell's content, following flex rows down to their text. */
function naturalWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  if (cs.display.includes("flex") && el.children.length) {
    const kids = Array.from(el.children) as HTMLElement[];
    const gap = parseFloat(cs.columnGap) || 0;
    return kids.reduce((s, c) => s + naturalWidth(c), 0) + gap * (kids.length - 1) + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  }
  if (el instanceof SVGElement || el.tagName === "IMG") return el.getBoundingClientRect().width;
  // Measure the text itself: scrollWidth never reports less than the current box width.
  const range = document.createRange();
  range.selectNodeContents(el);
  const text = range.getBoundingClientRect().width;
  range.detach();
  return text + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
}

export function fitColumn(table: HTMLTableElement | null, col: string) {
  if (!table) return null;
  let max = 0;
  table.querySelectorAll<HTMLElement>(`[data-col="${col}"]`).forEach((cell) => {
    const cs = getComputedStyle(cell);
    const inner = Array.from(cell.children).reduce((s, c) => Math.max(s, naturalWidth(c as HTMLElement)), 0);
    max = Math.max(max, inner + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + 4);
  });
  return max || null;
}

interface HeadProps {
  label: string;
  width: number;
  onResize: (w: number) => void;
  onFit: () => void;
  className?: string;
  children?: ReactNode;
  /** When set, the label becomes a button that sorts by this column. `sorted` is the current direction if it's the active sort. */
  onSort?: () => void;
  sorted?: "asc" | "desc" | null;
}

/** A header cell with a drag handle on its right edge (double-click to fit, arrow keys to nudge). */
export function ResizableTh({ label, width, onResize, onFit, className, children, onSort, sorted }: HeadProps) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <th className={cn("relative select-none px-2 py-2.5", className)} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
      {onSort ? (
        <button type="button" onClick={onSort} title={`Sort by ${label}`}
          className={cn("inline-flex max-w-full items-center gap-1 rounded uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            sorted && "text-foreground")}>
          <span className="truncate">{children ?? label}</span>
          {sorted === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : sorted === "desc" ? <ArrowDown className="h-3 w-3 shrink-0" /> : null}
        </button>
      ) : <span className="block truncate">{children ?? label}</span>}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize, double-click to fit"
        className={cn(
          "group absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none justify-center outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
        )}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, w: width };
          setDragging(true);
        }}
        onPointerMove={(e) => { if (start.current) onResize(start.current.w + e.clientX - start.current.x); }}
        onPointerUp={() => { start.current = null; setDragging(false); }}
        onPointerCancel={() => { start.current = null; setDragging(false); }}
        onDoubleClick={onFit}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onResize(width + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 64 : 16)); }
          if (e.key === "Enter") { e.preventDefault(); onFit(); }
        }}
      >
        <span className={cn("h-full w-px bg-border transition-colors group-hover:bg-primary", dragging && "bg-primary")} />
      </span>
    </th>
  );
}
