import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import type { Account } from "@/types";
import { accountColor } from "@/utils/accountColor";
import { bytes } from "@/utils/format";
import { useMask } from "@/utils/privacy";

/**
 * All accounts in one bar: used space (grey) followed by each account's remaining free space in its own colour.
 * Accounts stay separate quotas (a file is never split), so the largest single free space is shown too.
 */
export function StorageOverview({ accounts, trashCount }: { accounts: Account[]; trashCount?: number }) {
  const m = useMask();
  const rows = accounts
    .filter((a) => a.quota && a.quota.limit)
    .map((a) => {
      const limit = a.quota!.limit!;
      const used = a.quota!.usage;
      const free = Math.max(a.quota!.free ?? limit - used, 0);
      return { id: a.id, email: a.email, limit, used, free, trash: a.quota!.usage_in_trash, reauth: a.status === "NEEDS_REAUTH" };
    })
    .sort((a, b) => b.free - a.free);
  const unlimited = accounts.filter((a) => a.quota && !a.quota.limit).length;
  const unknown = accounts.filter((a) => !a.quota).length;
  if (rows.length === 0) return null;

  const capacity = rows.reduce((s, r) => s + r.limit, 0);
  const used = rows.reduce((s, r) => s + r.used, 0);
  const free = rows.reduce((s, r) => s + r.free, 0);
  const trash = rows.reduce((s, r) => s + r.trash, 0);
  const best = rows[0];
  const pct = (n: number) => `${capacity ? (n / capacity) * 100 : 0}%`;
  const freePct = capacity ? Math.round((free / capacity) * 100) : 0;

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="font-semibold">Available storage, all accounts</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="text-2xl font-semibold text-foreground">{bytes(free)}</span> free of {bytes(capacity)} ({freePct}%) · {bytes(used)} used
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>Largest single free space: <span className="font-medium text-foreground">{bytes(best.free)}</span></p>
            <p className="truncate" title={m.email(best.email)}>on {m.email(best.email)}</p>
          </div>
        </div>

        <div role="img" aria-label={`${bytes(free)} free of ${bytes(capacity)} across ${rows.length} accounts`}
          className="flex h-6 w-full gap-px overflow-hidden rounded-md bg-secondary">
          <div title={`Used: ${bytes(used)}`} style={{ width: pct(used), background: "hsl(var(--muted-foreground) / 0.45)" }} />
          {rows.map((r) => r.free > 0 && (
            <div key={r.id} title={`${m.email(r.email)}: ${bytes(r.free)} free`} style={{ width: pct(r.free), background: accountColor(r.id), opacity: r.reauth ? 0.4 : 1 }} />
          ))}
        </div>

        <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const share = r.free / r.limit;
            return (
              <li key={r.id} className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: accountColor(r.id) }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={m.email(r.email)}>{m.email(r.email)}</span>
                <span className={share < 0.1 ? "font-medium text-destructive" : share < 0.25 ? "font-medium text-warning" : "font-medium"}>{bytes(r.free)}</span>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>
            Each account is a separate limit; a file must fit in one account.
            {unlimited > 0 && ` ${unlimited} account${unlimited > 1 ? "s" : ""} without a reported limit not shown.`}
            {unknown > 0 && ` ${unknown} account${unknown > 1 ? "s" : ""} not read yet.`}
          </span>
          <Link to="/files?view=trash" className="flex items-center gap-1 text-primary hover:underline">
            <Trash2 className="h-3.5 w-3.5" />
            Trash{trashCount !== undefined ? `: ${trashCount.toLocaleString()} item${trashCount === 1 ? "" : "s"}` : ""}{trash > 0 ? ` · ${bytes(trash)}` : ""}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
