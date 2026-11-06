import { bytes } from "@/utils/format";
import { accountColor } from "@/utils/accountColor";
import type { Quota } from "@/types";

/** One account's storage: Drive files (account colour), Drive trash (hatched), other Google services (grey). */
export function StorageBar({ accountId, quota, tall }: { accountId: string; quota: Quota | null; tall?: boolean }) {
  if (!quota) return <div className="text-sm text-muted-foreground">Quota not read yet.</div>;
  const limit = quota.limit;
  const total = limit ?? Math.max(quota.usage * 1.15, 1);
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  const other = Math.max(quota.usage - quota.usage_in_drive - quota.usage_in_trash, 0);
  const frac = limit ? quota.usage / limit : 0;
  const color = accountColor(accountId);
  const label = limit
    ? `${bytes(quota.usage)} used of ${bytes(limit)}, ${bytes(quota.free)} free`
    : `${bytes(quota.usage)} used, no storage limit reported`;
  return (
    <div>
      <div role="img" aria-label={label} className={`flex w-full overflow-hidden rounded-full bg-secondary ${tall ? "h-4" : "h-2.5"}`}>
        <div style={{ width: pct(quota.usage_in_drive), background: color }} />
        <div className="hatch" style={{ width: pct(quota.usage_in_trash), background: color, opacity: 0.55 }} />
        <div style={{ width: pct(other), background: "hsl(var(--muted-foreground) / 0.45)" }} />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span><span className="font-semibold">{bytes(quota.usage)}</span> <span className="text-muted-foreground">{limit ? `of ${bytes(limit)}` : "used"}</span></span>
        <span className={frac > 0.9 ? "font-medium text-destructive" : frac > 0.75 ? "font-medium text-warning" : "text-muted-foreground"}>
          {limit ? `${bytes(quota.free)} free` : "Unlimited"}
        </span>
      </div>
    </div>
  );
}
