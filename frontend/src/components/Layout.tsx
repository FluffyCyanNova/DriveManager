import { AlertTriangle, Eye, EyeOff, LogOut, Moon, RefreshCw, Sun } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { SidebarNav } from "@/components/SidebarNav";
import { Toaster } from "@/components/Toaster";
import { useAccounts, useHealth } from "@/hooks/queries";
import { useEvents } from "@/hooks/useEvents";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/services/api";
import { useAuth } from "@/stores/auth";
import { toast, useUI } from "@/stores/ui";
import { cn } from "@/utils/cn";
import { useMask, usePrivacy } from "@/utils/privacy";


export default function Layout() {
  const m = useMask();
  const toggleHideEmails = usePrivacy((s) => s.toggleHideEmails);
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
      <aside className="shrink-0 border-b bg-card md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-4 py-3.5 md:py-5">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div className="flex min-w-0 flex-col leading-tight">
            <a href="https://github.com/FluffyCyanNova/DriveManager" target="_blank" rel="noopener noreferrer" title="DriveManager on GitHub"
              className="w-fit text-[15px] font-semibold tracking-tight hover:text-primary hover:underline">DriveManager</a>
            <a href="https://github.com/FluffyCyanNova" target="_blank" rel="noopener noreferrer" title="FluffyCyanNova on GitHub"
              className="w-fit text-xs text-muted-foreground hover:text-primary hover:underline">@FluffyCyanNova</a>
          </div>
          <div className="ml-auto flex gap-1 md:hidden">
            <button onClick={syncAll} disabled={busy || connected.length === 0} className="rounded p-1.5 hover:bg-accent disabled:opacity-60" aria-label={syncLabel} title={syncLabel}><RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} /></button>
            <button onClick={toggleHideEmails} className="rounded p-1.5 hover:bg-accent" aria-label={hideLabel} aria-pressed={m.hide} title={hideLabel}>{m.hide ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            <button onClick={toggleDark} className="rounded p-1.5 hover:bg-accent" aria-label="Toggle dark mode">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
            <button onClick={logout} className="rounded p-1.5 hover:bg-accent" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <SidebarNav />
        <div className="mt-auto hidden px-3 pb-4 pt-6 md:absolute md:bottom-0 md:block md:w-56">
          <button onClick={syncAll} disabled={busy || connected.length === 0} title={syncLabel}
            className="mb-2 flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent">
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            <span className="flex-1 text-left">{busy ? "Syncing…" : "Sync now"}</span>
            {busy && connected.length > 1 && <span className="text-xs tabular-nums">{syncingCount}/{connected.length}</span>}
          </button>
          <button onClick={toggleHideEmails} role="switch" aria-checked={m.hide}
            title="Replaces every email address in the app with a stable alias (e.g. user-k3f9x2). Display only, for screenshots or screen sharing."
            className={cn("mb-2 flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-sm hover:bg-accent", m.hide ? "border-primary/50 text-foreground" : "text-muted-foreground")}>
            {m.hide ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="flex-1 text-left">Hide emails</span>
            <span className={cn("relative h-4 w-7 rounded-full transition-colors", m.hide ? "bg-primary" : "bg-muted-foreground/40")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all", m.hide ? "left-3.5" : "left-0.5")} />
            </span>
          </button>
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
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
      <Toaster />
    </div>
  );
}

function Banner({ tone, children, to }: { tone: "danger" | "warn"; children: React.ReactNode; to?: string }) {
  const inner = (<><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></>);
  const cls = cn("flex items-start gap-2 px-4 py-2.5 text-sm md:px-8", tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-warning/12 text-warning");
  return to ? <NavLink to={to} className={cn(cls, "hover:underline")}>{inner}</NavLink> : <div className={cls}>{inner}</div>;
}
