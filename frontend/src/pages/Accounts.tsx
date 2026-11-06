import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog, onError, PageHeader, Spinner } from "@/components/Common";
import { StorageBar } from "@/components/StorageBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAccounts, useRuntime } from "@/hooks/queries";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { Account } from "@/types";
import { accountColor } from "@/utils/accountColor";
import { ago, when } from "@/utils/format";
import { useMask } from "@/utils/privacy";

export default function Accounts() {
  const m = useMask();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts();
  const runtime = useRuntime();
  const [removing, setRemoving] = useState<Account | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Result of the Google redirect (?connected=… or ?error=…)
  useEffect(() => {
    const c = params.get("connected"), e = params.get("error");
    if (c) toast.success(params.get("new") === "1" ? `Connected ${c}. Indexing its files now.` : `Reconnected ${c}.`);
    if (e) toast.error(e);
    if (c || e) { setParams({}, { replace: true }); qc.invalidateQueries({ queryKey: ["accounts"] }); }
  }, [params, setParams, qc]);

  const connect = useMutation({
    mutationFn: (reconnect?: string) => api.post<{ authorization_url: string }>("/api/accounts/oauth/start", { reconnect_account_id: reconnect ?? null }),
    onSuccess: (r) => { window.location.href = r.authorization_url; }, onError,
  });
  const sync = useMutation({ mutationFn: (id: string) => api.post<{ message: string }>(`/api/accounts/${id}/sync`), onSuccess: (r) => { toast.info(r.message); qc.invalidateQueries({ queryKey: ["accounts"] }); }, onError });
  const refresh = useMutation({ mutationFn: (id: string) => api.post(`/api/accounts/${id}/quota/refresh`), onSuccess: () => { toast.success("Storage numbers refreshed."); qc.invalidateQueries({ queryKey: ["accounts"] }); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/accounts/${id}`), onSuccess: () => { toast.success("Account removed from DriveManager."); setRemoving(null); qc.invalidateQueries(); }, onError });

  const configured = runtime.data?.google_configured ?? true;
  return (
    <>
      <PageHeader title="Accounts" description="Connect Google accounts. DriveManager asks Google for access to Drive only, and you can revoke it any time."
        actions={<Button onClick={() => connect.mutate(undefined)} disabled={connect.isPending || !configured}><Plus className="h-4 w-4" />Connect account</Button>} />
      {!configured && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div><p className="font-medium">Google credentials are not set up yet.</p>
            <p className="mt-1 text-muted-foreground">Follow <code>docs/GOOGLE_OAUTH.md</code>, put the client ID and secret in <code>.env</code>, and restart with <code>docker compose up -d</code>. The redirect URI to register is <code className="break-all">{runtime.data?.redirect_uri}</code>.</p></div>
        </div>)}
      {accounts.isLoading ? <Spinner /> : (accounts.data ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No accounts yet. Use “Connect account” to sign in with Google.</CardContent></Card>
      ) : (
        <div className="space-y-4">{accounts.data!.map((a) => (
          <Card key={a.id} className="overflow-hidden">
            <div className="h-1" style={{ background: accountColor(a.id) }} />
            <CardContent className="space-y-4 pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-base font-semibold">{m.email(a.email)}</p><p className="text-sm text-muted-foreground">{m.name(a.display_name)}</p></div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.status === "NEEDS_REAUTH" ? <Badge tone="danger">Needs reconnecting</Badge> : <Badge tone="success">Connected</Badge>}
                  {a.syncing && <Badge tone="info">Syncing</Badge>}
                  {!a.initial_scan_complete && a.status === "ACTIVE" && <Badge tone="warning">First scan in progress</Badge>}
                </div>
              </div>
              {a.status === "NEEDS_REAUTH" && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{m.text(a.status_detail) ?? "Google access expired."} Your files in Drive are safe; reconnecting restores syncing and uploads.</p>}
              <StorageBar accountId={a.id} quota={a.quota} />
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>{a.files_indexed.toLocaleString()} files indexed · last sync {ago(a.last_sync_at)}</span>
                <div className="flex flex-wrap gap-2">
                  {a.status === "NEEDS_REAUTH" ? <Button size="sm" onClick={() => connect.mutate(a.id)} disabled={connect.isPending}><Unplug className="h-3.5 w-3.5" />Reconnect</Button> : (<>
                    <Button size="sm" variant="outline" onClick={() => sync.mutate(a.id)} disabled={a.syncing}><RefreshCw className="h-3.5 w-3.5" />Sync now</Button>
                    <Button size="sm" variant="outline" onClick={() => refresh.mutate(a.id)}>Refresh storage</Button></>)}
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? "Hide details" : "Details"}</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoving(a)}><Trash2 className="h-3.5 w-3.5" />Remove</Button>
                </div>
              </div>
              {openId === a.id && <Details id={a.id} />}
            </CardContent>
          </Card>))}
        </div>)}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${m.email(removing?.email)}?`} confirmLabel="Remove account" danger busy={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)}>
        This only disconnects the account from DriveManager and deletes its local index, quota history and virtual-folder links. Nothing is deleted from Google Drive. You can reconnect it later.
      </ConfirmDialog>
    </>
  );
}

function Details({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["accounts", id], queryFn: () => api.get<Account>(`/api/accounts/${id}`) });
  if (q.isLoading) return <Spinner />;
  const a = q.data!;
  return (
    <div className="grid gap-4 rounded-md bg-muted/60 p-4 text-sm md:grid-cols-2">
      <div><p className="mb-1 font-medium">Last sync</p>{a.last_sync_job ? <p className="text-muted-foreground">{a.last_sync_job.state.toLowerCase()} ({a.last_sync_job.kind.toLowerCase()}), {a.last_sync_job.files_processed.toLocaleString()} items, {when(a.last_sync_job.finished_at)}{a.last_sync_job.error && <span className="block text-destructive">{a.last_sync_job.error}</span>}</p> : <p className="text-muted-foreground">Not synced yet.</p>}
        <p className="mb-1 mt-3 font-medium">Connected</p><p className="text-muted-foreground">{when(a.created_at)}</p></div>
      <div><p className="mb-1 font-medium">Shared drives</p>{(a.shared_drives ?? []).length === 0 ? <p className="text-muted-foreground">None visible to this account.</p> : <ul className="space-y-0.5 text-muted-foreground">{a.shared_drives!.map((d) => <li key={d.id}>{d.name}</li>)}</ul>}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-primary hover:underline">Google permissions page <ExternalLink className="h-3 w-3" /></a></div>
    </div>
  );
}
