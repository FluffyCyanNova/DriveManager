import { Activity, AlertTriangle, BarChart3, Eye, EyeOff, FolderTree, LayoutDashboard, Link2, LogOut, Moon, Settings, Sun, Trash2, UploadCloud, Users } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Toaster } from "@/components/Toaster";
import { useAccounts, useHealth } from "@/hooks/queries";
import { useEvents } from "@/hooks/useEvents";
import { api } from "@/services/api";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { cn } from "@/utils/cn";
import { useMask, usePrivacy } from "@/utils/privacy";

// Files has sub-entries that open the Files page on a specific view (?view=…); `view` decides which one is highlighted.
const NAV: { to: string; label: string; icon: typeof FolderTree; end?: boolean; view?: string | null; sub?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/files", label: "Files", icon: FolderTree, view: null },
  { to: "/files?view=trash", label: "Trash", icon: Trash2, view: "trash", sub: true },
  { to: "/files?view=virtual", label: "Virtual folders", icon: Link2, view: "virtual", sub: true },
  { to: "/uploads", label: "Uploads", icon: UploadCloud },
  { to: "/accounts", label: "Accounts", icon: Users },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

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
  const location = useLocation();
  const currentView = location.pathname === "/files" ? new URLSearchParams(location.search).get("view") : undefined;
  const itemCls = (active: boolean, sub?: boolean) => cn("flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
    sub && "md:ml-4 md:py-1.5", active && "bg-accent text-accent-foreground");
  const logout = async () => { try { await api.post("/api/auth/logout"); } finally { auth.set({ status: "out" }); } };

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="shrink-0 border-b bg-card md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-4 py-3.5 md:py-5">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight">DriveManager</span>
          <div className="ml-auto flex gap-1 md:hidden">
            <button onClick={toggleHideEmails} className="rounded p-1.5 hover:bg-accent" aria-label={hideLabel} aria-pressed={m.hide} title={hideLabel}>{m.hide ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            <button onClick={toggleDark} className="rounded p-1.5 hover:bg-accent" aria-label="Toggle dark mode">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
            <button onClick={logout} className="rounded p-1.5 hover:bg-accent" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0">
          {NAV.map(({ to, label, icon: Icon, end, view, sub }) => view !== undefined ? (
            <Link key={to} to={to} aria-current={currentView !== undefined && (currentView ?? null) === view ? "page" : undefined}
              className={itemCls(currentView !== undefined && (currentView ?? null) === view, sub)}>
              <Icon className="h-4 w-4" />{label}
            </Link>
          ) : (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => itemCls(isActive)}>
              <Icon className="h-4 w-4" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden px-3 pb-4 pt-6 md:absolute md:bottom-0 md:block md:w-56">
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
