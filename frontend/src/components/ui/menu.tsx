import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean; disabled?: boolean }

export function RowMenu({ items, label = "Actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-md border bg-card p-1 shadow-lg">
          {visible.map((i) => (
            <button key={i.label} role="menuitem" disabled={i.disabled} onClick={() => { setOpen(false); i.onSelect(); }}
              className={cn("flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40", i.danger && "text-destructive")}>
              {i.icon}{i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
