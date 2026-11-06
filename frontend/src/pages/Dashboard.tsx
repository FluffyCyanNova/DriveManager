import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Plus, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import { AccountChip, EmptyState, PageHeader, Separator, Spinner } from "@/components/Common";
import { StorageBar } from "@/components/StorageBar";
import { StorageOverview } from "@/components/StorageOverview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAccounts } from "@/hooks/queries";
import { api } from "@/services/api";
import type { ActivityItem, FilePage, UploadJob } from "@/types";
import { accountColor } from "@/utils/accountColor";
import { ago, bytes } from "@/utils/format";
import { describe } from "./Activity";
import { useMask } from "@/utils/privacy";

export default function Dashboard() {
  const m = useMask();
  const accounts = useAccounts();
  const uploads = useQuery({ queryKey: ["uploads", "active"], queryFn: () => api.get<UploadJob[]>("/api/uploads?state=QUEUED,VALIDATING,ALLOCATING,UPLOADING,FINALIZING,FAILED&limit=20"), refetchInterval: 10_000 });
  const activity = useQuery({ queryKey: ["activity", "recent"], queryFn: () => api.get<{ items: ActivityItem[] }>("/api/activity?limit=8") });
  const trash = useQuery({ queryKey: ["files", "trash-count"], queryFn: () => api.get<FilePage>("/api/files?trashed=true&page_size=1") });

  if (accounts.isLoading) return <Spinner />;
  const list = accounts.data ?? [];
  if (list.length === 0) {
    return (<><PageHeader title="Dashboard" /><Card><EmptyState icon={<UploadCloud className="h-9 w-9" />} title="Connect your first Google account"
      action={<Button asChild><Link to="/accounts"><Plus className="h-4 w-4" />Connect an account</Link></Button>}>
      Each account keeps its own storage quota. DriveManager shows them side by side and helps you decide where files go.</EmptyState></Card></>);
  }
  const used = list.reduce((s, a) => s + (a.quota?.usage ?? 0), 0);
  const active = (uploads.data ?? []).filter((j) => j.state !== "FAILED");
  const failed = (uploads.data ?? []).filter((j) => j.state === "FAILED");

  return (
    <>
      <PageHeader title="Dashboard" description={<>{list.length} account{list.length > 1 ? "s" : ""} connected · {bytes(used)} stored in total. Each account has its own separate limit.</>}
         />
      <StorageOverview accounts={list} trashCount={trash.data?.total} />
      <Separator />
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((a) => (
          <Card key={a.id} className="overflow-hidden">
            <div className="h-1" style={{ background: accountColor(a.id) }} />
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-medium">{m.email(a.email)}</p><p className="text-xs text-muted-foreground">{a.files_indexed.toLocaleString()} files · synced {ago(a.last_sync_at)}</p></div>
                {a.status === "NEEDS_REAUTH" ? <Badge tone="danger"><AlertTriangle className="h-3 w-3" />Reconnect</Badge> : a.syncing ? <Badge tone="info">Syncing</Badge> : <Badge tone="success">Connected</Badge>}
              </div>
              <StorageBar accountId={a.id} quota={a.quota} tall />
              <p className="text-xs text-muted-foreground">Drive {bytes(a.quota?.usage_in_drive)} · Trash {bytes(a.quota?.usage_in_trash)} · Other Google services {bytes(Math.max((a.quota?.usage ?? 0) - (a.quota?.usage_in_drive ?? 0) - (a.quota?.usage_in_trash ?? 0), 0))}</p>
            </CardContent>
          </Card>
        ))}
        {/* Odd number of accounts: fill the empty spot in the two-column grid (desktop only) instead of leaving a blank gap. */}
        {list.length % 2 === 1 && (
          <Link to="/accounts" aria-label="Connect another account"
            className="group hidden items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground md:flex"
            style={{ backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / 0.10) 0 1px, transparent 1px 12px)" }}>
            <span className="flex items-center gap-2 rounded-md bg-background/80 px-3 py-1.5"><Plus className="h-4 w-4" />Connect another account</span>
          </Link>)}
      </div>

      <Separator />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Uploads</h2><Link to="/uploads" className="flex items-center gap-1 text-sm text-primary hover:underline">Open <ArrowRight className="h-3.5 w-3.5" /></Link></div>
            {active.length === 0 && failed.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing uploading right now.</p> : (
              <ul className="space-y-3">
                {[...active, ...failed].slice(0, 5).map((j) => (
                  <li key={j.id} className="text-sm">
                    <div className="flex justify-between gap-2"><span className="truncate">{m.file(j.filename)}</span>{j.state === "FAILED" ? <Badge tone="danger">Failed</Badge> : <span className="text-muted-foreground">{Math.round(j.progress)}%</span>}</div>
                    {j.state === "FAILED" ? <p className="text-xs text-destructive">{m.text(j.error_message)}</p> : <Progress className="mt-1.5" value={j.progress} />}
                  </li>))}
              </ul>)}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent activity</h2><Link to="/activity" className="flex items-center gap-1 text-sm text-primary hover:underline">All <ArrowRight className="h-3.5 w-3.5" /></Link></div>
            {(activity.data?.items ?? []).length === 0 ? <p className="py-4 text-sm text-muted-foreground">No activity yet.</p> : (
              <ul className="space-y-2.5">{activity.data!.items.map((e) => (
                <li key={e.id} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate">{m.text(describe(e, m.file))}</span><span className="shrink-0 text-xs text-muted-foreground">{ago(e.created_at)}</span></div>
                  {e.account_id && <AccountChip id={e.account_id} email={e.account_email} />}</li>))}</ul>)}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
