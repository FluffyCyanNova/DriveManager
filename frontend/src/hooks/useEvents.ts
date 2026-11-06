import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/stores/auth";
import { toast } from "@/stores/ui";

/** Live updates: the server pushes events; we just refresh the affected queries. */
export function useEvents() {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);
  useEffect(() => {
    if (status !== "in") return;
    let ws: WebSocket | null = null, closed = false, retry = 1000, timer: number | undefined;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/events`);
      ws.onopen = () => { retry = 1000; };
      ws.onmessage = (m) => {
        const ev = JSON.parse(m.data) as { type: string; payload: Record<string, unknown> };
        const t = ev.type;
        if (t === "ping") return;
        if (t.startsWith("upload.")) { qc.invalidateQueries({ queryKey: ["uploads"] }); if (t === "upload.completed" || t === "upload.failed") { qc.invalidateQueries({ queryKey: ["activity"] }); } }
        if (t === "upload.failed") toast.error("An upload failed. Open Uploads to see why.");
        if (t === "storage.updated") { qc.invalidateQueries({ queryKey: ["storage"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); }
        if (t === "files.changed") { qc.invalidateQueries({ queryKey: ["files"] }); qc.invalidateQueries({ queryKey: ["virtual-items"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); }
        if (t.startsWith("account.") || t.startsWith("sync.")) { qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["storage"] }); qc.invalidateQueries({ queryKey: ["drives"] }); }
        if (t === "account.status_changed" && ev.payload.status === "NEEDS_REAUTH") toast.error("An account needs to be reconnected. Open Accounts.");
      };
      ws.onclose = () => { if (!closed) timer = window.setTimeout(connect, (retry = Math.min(retry * 2, 15000))); };
    };
    connect();
    return () => { closed = true; window.clearTimeout(timer); ws?.close(); };
  }, [status, qc]);
}
