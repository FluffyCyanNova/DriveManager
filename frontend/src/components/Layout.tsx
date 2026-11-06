import { AlertTriangle, Eye, EyeOff, LogOut, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { GlobalSearch, useSearchShortcut } from "@/components/GlobalSearch";
import { SIDEBAR_ICONS, SIDEBAR_MAX, SIDEBAR_MIN, SidebarNav, useSidebarWidth } from "@/components/SidebarNav";
import { Toaster } from "@/components/Toaster";
import { useAccounts, useHealth } from "@/hooks/queries";
import { useEvents } from "@/hooks/useEvents";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { api } from "@/services/api";
import { useAuth } from "@/stores/auth";
import { toast, useUI } from "@/stores/ui";
import { cn } from "@/utils/cn";
import { useMask, usePrivacy } from "@/utils/privacy";
import { UploadDialog } from "@/components/UploadForm";
import { UploadPanel } from "@/components/UploadPanel";


export default function Layout() {
  const m = useMask();
  const toggleHideEmails = usePrivacy((s) => s.toggleHideEmails);
  // Global search: a box above Sync now on desktop; on phones a search icon opens it under the header.
  const loc = useLocation();
  const searching = loc.pathname === "/files" && !!new URLSearchParams(loc.search).get("q");
  const [mobileSearch, setMobileSearch] = useState(false);
  const desktopSearch = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  // Desktop sidebar width: drag the right edge; far left snaps to icons only; double-click toggles. Saved in this browser.
  const sw = useSidebarWidth();
  const iconsOnly = sw.collapsed;
  const sbWidth = iconsOnly ? SIDEBAR_ICONS : sw.width;
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (ev.clientX < 130) sw.set({ collapsed: true });
      else sw.set({ collapsed: false, width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(ev.clientX))) });
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); document.body.style.cursor = ""; };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
  };
  const focusSearch = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      if (useSidebarWidth.getState().collapsed) { useSidebarWidth.getState().set({ collapsed: false }); setTimeout(() => desktopSearch.current?.focus(), 50); }
      else desktopSearch.current?.focus();
    }
    else { setMobileSearch(true); setTimeout(() => mobileSearchRef.current?.focus(), 0); }
  }, []);
  useSearchShortcut(focusSearch);
  const mobileOpen = mobileSearch || searching;
  const navigate = useNavigate();
  const closeMobileSearch = () => { setMobileSearch(false); if (searching) navigate("/files", { replace: true }); };
  const hideLabel = m.hide ? "Show emails" : "Hide emails";
  useEvents();
  const { dark, toggleDark } = useUI();
  const auth = useAuth();
  const accounts = useAccounts();
  const health = useHealth();
  const needAuth = (accounts.data ?? []).filter((a) => a.status === "NEEDS_REAUTH");
  // Sync now: queue a sync for every connected account. Progress then arrives through the event stream (`syncing`).
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const connected = (accounts.data ?? []).filter((a) => a.status === "ACTIVE");
  const syncingCount = connected.filter((a) => a.syncing).length;
  const busy = starting || syncingCount > 0;
  const syncLabel = connected.length === 0 ? "No connected accounts to sync" : busy ? `Syncing ${syncingCount || connected.length} of ${connected.length} account${connected.length === 1 ? "" : "s"}…` : `Sync all ${connected.length} connected account${connected.length === 1 ? "" : "s"} now`;
  const syncAll = async () => {
    const targets = connected.filter((a) => !a.syncing);
    if (!targets.length) return;
    setStarting(true);
    try {
      const results = await Promise.allSettled(targets.map((a) => api.post<{ queued: boolean }>(`/api/accounts/${a.id}/sync`)));
      const failed = targets.filter((_, i) => results[i].status === "rejected").map((a) => a.email);
      const started = results.filter((x) => x.status === "fulfilled" && x.value.queued).length;
      if (failed.length) toast.error(`Couldn't start a sync for ${failed.join(", ")}.`);
      if (started) toast.info(`Sync started for ${started} account${started === 1 ? "" : "s"}.`);
      else if (!failed.length) toast.info("A sync is already running for every account.");
    } finally {
      setStarting(false);
      qc.invalidateQueries({ queryKey: ["accounts"] });
    }
  };
  const logout = async () => { try { await api.post("/api/auth/logout"); } finally { auth.set({ status: "out" }); } };

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="shrink-0 border-b bg-card md:sticky md:top-0 md:h-screen md:w-[var(--sb)] md:border-b-0 md:border-r" style={{ "--sb": `${sbWidth}px` } as React.CSSProperties}>
        <div role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabIndex={0} aria-valuenow={sbWidth}
          title="Drag to resize, far left for icons only. Double-click to toggle."
          onPointerDown={startResize} onDoubleClick={() => sw.set({ collapsed: !iconsOnly })}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); if (sw.width - 16 < SIDEBAR_MIN) sw.set({ collapsed: true }); else sw.set({ width: sw.width - 16, collapsed: false }); }
            if (e.key === "ArrowRight") { e.preventDefault(); sw.set(iconsOnly ? { collapsed: false } : { width: Math.min(SIDEBAR_MAX, sw.width + 16) }); }
          }}
          className="absolute -right-1 top-0 z-30 hidden h-full w-2 cursor-col-resize touch-none outline-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 md:block" />
        <div className={cn("flex items-center gap-2.5 px-4 py-3.5 md:py-5", iconsOnly && "md:justify-center md:px-0")}>
          <a href="https://github.com/FluffyCyanNova/DriveManager" target="_blank" rel="noopener noreferrer" title="DriveManager on GitHub" aria-label="DriveManager on GitHub"
            className="shrink-0 rounded-md transition-opacity hover:opacity-80"><img src="/favicon.svg" alt="" className="h-9 w-9" /></a>
          <div className={cn("flex min-w-0 flex-col leading-tight", mobileOpen && "hidden md:flex", iconsOnly && "md:hidden")}>
            <a href="https://github.com/FluffyCyanNova/DriveManager" target="_blank" rel="noopener noreferrer" title="DriveManager on GitHub"
              className="w-fit text-lg font-semibold leading-tight tracking-tight hover:text-primary hover:underline">DriveManager</a>
            <a href="https://github.com/FluffyCyanNova" target="_blank" rel="noopener noreferrer" title="FluffyCyanNova on GitHub"
              className="w-fit text-[11px] text-muted-foreground hover:text-primary hover:underline">@FluffyCyanNova</a>
          </div>
          {/* Phones: the search replaces the title and buttons in the top bar instead of adding a full-width row. */}
          {mobileOpen && <>
            <GlobalSearch ref={mobileSearchRef} className="min-w-0 flex-1 md:hidden" onDone={() => setMobileSearch(false)} />
            <button onClick={closeMobileSearch} className="shrink-0 rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground md:hidden">Cancel</button>
          </>}
          <div className={cn("ml-auto flex gap-1 md:hidden", mobileOpen && "hidden")}>
            <button onClick={focusSearch} className="rounded p-1.5 hover:bg-accent" aria-label="Search everything"><Search className="h-4 w-4" /></button>
            <button onClick={syncAll} disabled={busy || connected.length === 0} className="rounded p-1.5 hover:bg-accent disabled:opacity-60" aria-label={syncLabel} title={syncLabel}><RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} /></button>
            <button onClick={toggleHideEmails} className="rounded p-1.5 hover:bg-accent" aria-label={hideLabel} aria-pressed={m.hide} title={hideLabel}>{m.hide ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            <button onClick={toggleDark} className="rounded p-1.5 hover:bg-accent" aria-label="Toggle dark mode">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
            <button onClick={logout} className="rounded p-1.5 hover:bg-accent" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <SidebarNav collapsed={iconsOnly} />
        {iconsOnly && (
          <div className="mt-auto hidden flex-col items-center gap-1.5 pb-4 pt-6 md:absolute md:bottom-0 md:flex md:w-[var(--sb)]">
            {([
              ["Search everything (Ctrl + K)", <Search key="s" className="h-4 w-4" />, focusSearch, false],
              [syncLabel, <RefreshCw key="r" className={cn("h-4 w-4", busy && "animate-spin")} />, syncAll, busy || connected.length === 0],
              [hideLabel, m.hide ? <EyeOff key="e" className="h-4 w-4" /> : <Eye key="e" className="h-4 w-4" />, toggleHideEmails, false],
              ["Toggle dark mode", dark ? <Sun key="d" className="h-4 w-4" /> : <Moon key="d" className="h-4 w-4" />, toggleDark, false],
              [`Sign out (${auth.username})`, <LogOut key="l" className="h-4 w-4" />, logout, false],
            ] as const).map(([label, icon, onClick, disabled]) => (
              <button key={label} onClick={onClick} disabled={disabled} aria-label={label} title={label}
                className={cn("flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60", label === hideLabel && m.hide && "border-primary/50 text-foreground")}>{icon}</button>
            ))}
          </div>)}
        <div className={cn("mt-auto hidden px-3 pb-4 pt-6 md:absolute md:bottom-0 md:w-[var(--sb)]", iconsOnly ? "md:hidden" : "md:block")}>
          <GlobalSearch ref={desktopSearch} className="mb-2" />
          <button onClick={syncAll} disabled={busy || connected.length === 0} title={syncLabel}
            className="mb-2 flex h-10 w-full items-center gap-2.5 rounded-md border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent">
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            <span className="flex-1 text-left">{busy ? "Syncing…" : "Sync now"}</span>
            {busy && connected.length > 1 && <span className="text-xs tabular-nums">{syncingCount}/{connected.length}</span>}
          </button>
          <button onClick={toggleHideEmails} role="switch" aria-checked={m.hide}
            title="Replaces every email address in the app with a stable alias (e.g. user-k3f9x2). Display only, for screenshots or screen sharing."
            className={cn("mb-2 flex h-10 w-full items-center gap-2.5 rounded-md border px-3 text-sm hover:bg-accent", m.hide ? "border-primary/50 text-foreground" : "text-muted-foreground")}>
            {m.hide ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="flex-1 text-left">Hide emails</span>
            <span className={cn("relative h-4 w-7 rounded-full transition-colors", m.hide ? "bg-primary" : "bg-muted-foreground/40")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all", m.hide ? "left-3.5" : "left-0.5")} />
            </span>
          </button>
          <div className="flex h-10 items-center justify-between rounded-md border pl-3 pr-2 text-sm">
            <span className="truncate text-muted-foreground">{auth.username}</span>
            <div className="flex gap-1">
              <button onClick={toggleDark} className="rounded p-1 hover:bg-accent" aria-label="Toggle dark mode">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <button onClick={logout} className="rounded p-1 hover:bg-accent" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {needAuth.length > 0 && (
          <Banner tone="danger" to="/accounts">{needAuth.map((a) => m.email(a.email)).join(", ")} {needAuth.length > 1 ? "need" : "needs"} to be reconnected to Google. Syncing and uploads for {needAuth.length > 1 ? "them are" : "it is"} paused.</Banner>
        )}
        {health.data && !health.data.worker.alive && health.data.worker.enabled && <Banner tone="warn">The background worker isn't responding. Uploads and sync are paused until it is back (run <code>docker compose logs worker</code>).</Banner>}
        {health.data && !health.data.encryption_key_ok && <Banner tone="danger">The encryption key doesn't match this database, so stored Google credentials can't be read. Restore the original APP_ENCRYPTION_KEY from your backup.</Banner>}
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8"><Outlet /></div>
      </main>
      <UploadDialog />
      <UploadPanel />
      <Toaster />
    </div>
  );
}

function Banner({ tone, children, to }: { tone: "danger" | "warn"; children: React.ReactNode; to?: string }) {
  const inner = (<><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></>);
  const cls = cn("flex items-start gap-2 px-4 py-2.5 text-sm md:px-8", tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-warning/12 text-warning");
  return to ? <NavLink to={to} className={cn(cls, "hover:underline")}>{inner}</NavLink> : <div className={cls}>{inner}</div>;
}
