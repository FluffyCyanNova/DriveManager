import { Search, X } from "lucide-react";
import { forwardRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";

/**
 * Sidebar search: typing jumps straight to Files and shows matching files and folders from every account and location
 * (except Trash), live. The text lives in the URL (/files?q=…), so it stays in sync with the search box on the Files page.
 */
export const GlobalSearch = forwardRef<HTMLInputElement, { className?: string; onDone?: () => void }>(({ className, onDone }, ref) => {
  const loc = useLocation();
  const navigate = useNavigate();
  const value = loc.pathname === "/files" ? new URLSearchParams(loc.search).get("q") ?? "" : "";
  const set = (v: string) => {
    const onFiles = loc.pathname === "/files";
    navigate(v ? `/files?q=${encodeURIComponent(v)}` : "/files", { replace: onFiles });
  };
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <input ref={ref} type="search" value={value} aria-label="Search all files and folders" placeholder="Search…"
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); set(""); (e.target as HTMLInputElement).blur(); onDone?.(); } }}
        className="h-9 w-full rounded-md border bg-card pl-8 pr-14 text-sm placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden" />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => { set(""); onDone?.(); }}
          className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      ) : <kbd className="pointer-events-none absolute right-2 top-2 hidden rounded border px-1.5 text-[10px] text-muted-foreground md:block">Ctrl K</kbd>}
    </div>
  );
});
GlobalSearch.displayName = "GlobalSearch";

/** Ctrl+K anywhere, or "/" when not typing in a field, calls `focus`. */
export function useSearchShortcut(focus: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); focus(); }
      else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);
}
