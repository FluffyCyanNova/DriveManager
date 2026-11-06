import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccountChip, EmptyState, PageHeader, Spinner } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { api } from "@/services/api";
import type { ActivityItem } from "@/types";
import { when } from "@/utils/format";

const LABELS: Record<string, string> = {
  upload: "Uploaded", upload_failed: "Upload failed", upload_cancelled: "Upload cancelled", rename: "Renamed", move: "Moved", trash: "Moved to trash",
  restore: "Restored", delete_permanent: "Deleted permanently", empty_trash: "Emptied trash", create_folder: "Created folder", download: "Downloaded",
  account_connected: "Account connected", account_reconnected: "Account reconnected", account_removed: "Account removed", account_needs_reauth: "Account needs reconnecting",
};
export function describe(e: ActivityItem): string {
  const base = LABELS[e.type] ?? e.type;
  const d = e.details as Record<string, string> | null;
  if (e.type === "rename" && d?.from) return `${base}: ${d.from} → ${d.to}`;
  if (e.type === "empty_trash") return `${base} (${Number(d?.count ?? 0)} item${Number(d?.count) === 1 ? "" : "s"})`;
  if (e.type === "upload_failed" && d?.message) return `${base}: ${e.file_name ?? ""} (${d.message})`;
  return e.file_name ? `${base}: ${e.file_name}` : base;
}

export default function Activity() {
  const [type, setType] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["activity", "list", type], initialPageParam: 0 as number,
    queryFn: ({ pageParam }) => api.get<{ items: ActivityItem[]; next_before_id: number | null }>(`/api/activity?limit=50${type ? `&type=${type}` : ""}${pageParam ? `&before_id=${pageParam}` : ""}`),
    getNextPageParam: (l) => l.next_before_id ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Activity" description="Everything DriveManager did for you: uploads, file changes, and account events."
        actions={<Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} className="w-52">
          <option value="">All activity</option><option value="upload,upload_failed,upload_cancelled">Uploads</option><option value="rename,move,trash,restore,delete_permanent,empty_trash,create_folder">File changes</option>
          <option value="download">Downloads</option><option value="account_connected,account_reconnected,account_removed,account_needs_reauth">Accounts</option></Select>} />
      <Card>
        {q.isLoading ? <Spinner /> : items.length === 0 ? <EmptyState title="Nothing here yet">Uploads, renames, moves and account changes will be listed here.</EmptyState> : (
          <ul className="divide-y">{items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0"><p className="truncate">{describe(e)}</p>{e.account_id !== undefined && <AccountChip id={e.account_id ?? "x"} email={e.account_email} />}</div>
              <time className="text-xs text-muted-foreground" dateTime={e.created_at}>{when(e.created_at)}</time>
            </li>))}</ul>)}
        {q.hasNextPage && <div className="border-t p-3 text-center"><Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Load older</Button></div>}
      </Card>
    </>
  );
}
