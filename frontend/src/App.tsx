import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "@/components/Common";
import Layout from "@/components/Layout";
import { api } from "@/services/api";
import { useAuth } from "@/stores/auth";
import Accounts from "@/pages/Accounts";
import Activity from "@/pages/Activity";
import Dashboard from "@/pages/Dashboard";
import Files from "@/pages/Files";
import Login from "@/pages/Login";
import SettingsPage from "@/pages/Settings";
import Uploads from "@/pages/Uploads";

/**
 * Loads a page's code on demand. After an update (scripts\update.ps1) a tab that was already open still has the old
 * file names, which no longer exist on the server, so loading fails. Reload once to pick up the new version; if that
 * already happened in the last 30 seconds, show a message instead of reloading in a loop.
 */
const RELOADED = "dm-chunk-reload";
function lazyPage(load: () => Promise<{ default: React.ComponentType }>) {
  return lazy(() => load().catch(() => {
    let recent = false;
    try { recent = Date.now() - Number(sessionStorage.getItem(RELOADED) ?? 0) < 30_000; sessionStorage.setItem(RELOADED, String(Date.now())); } catch { /* storage unavailable */ }
    if (!recent) { window.location.reload(); return new Promise<never>(() => {}); }   // keeps the spinner up until the reload happens
    return { default: () => (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
        <p>This page couldn't be loaded. DriveManager may have just been updated, or the server isn't reachable.</p>
        <button className="rounded-md border px-3 py-1.5 text-foreground hover:bg-accent" onClick={() => window.location.reload()}>Reload</button>
      </div>) };
  }));
}

const Analytics = lazyPage(() => import("@/pages/Analytics"));

export default function App() {
  const { status, set } = useAuth();
  useEffect(() => {
    api.get<{ authenticated: boolean; username?: string; csrf_token?: string }>("/api/auth/session")
      .then((s) => set(s.authenticated ? { status: "in", username: s.username, csrf: s.csrf_token } : { status: "out" }))
      .catch(() => set({ status: "out" }));
  }, [set]);

  if (status === "loading") return <Spinner label="Starting" />;
  if (status === "out") return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="files" element={<Files />} />
        <Route path="uploads" element={<Uploads />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="activity" element={<Activity />} />
        <Route path="analytics" element={<Suspense fallback={<Spinner />}><Analytics /></Suspense>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
