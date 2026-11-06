import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ApiError } from "@/services/api";
import { toast } from "@/stores/ui";
import { accountColor } from "@/utils/accountColor";
import { useMask } from "@/utils/privacy";

export const Spinner = ({ label = "Loading" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />{label}…</div>
);

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function AccountChip({ id, email }: { id: string; email: string | null | undefined }) {
  const m = useMask();
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground" title={m.email(email) ?? undefined}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accountColor(id) }} />
      <span className="truncate">{m.email(email) ?? "Removed account"}</span>
    </span>
  );
}

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");
export const onError = (e: unknown) => toast.error(errText(e));

export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, danger, onConfirm, busy, extra }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; busy?: boolean;
  /** Optional middle button, e.g. a safer alternative to the confirm action. */
  extra?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={children}>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        {extra}
        <Button variant={danger ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

export function PromptDialog({ open, onOpenChange, title, label, initial = "", confirmLabel, onSubmit, busy }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; label: string; initial?: string; confirmLabel: string; onSubmit: (v: string) => void; busy?: boolean;
}) {
  const [v, setV] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) onSubmit(v.trim()); }}>
        <Label htmlFor="prompt-input">{label}</Label>
        <Input id="prompt-input" className="mt-2" autoFocus value={v} onChange={(e) => setV(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!v.trim() || busy} onClick={() => onSubmit(v.trim())}>{confirmLabel}</Button>
        </div>
      </div>
    </Dialog>
  );
}

export interface DoomedItem { name: string; size?: number | null; isFolder?: boolean }

/**
 * Two-step confirmation for permanent deletes. Step 1 explains what will happen ("confirmLabel"); step 2 lists every
 * item that will be deleted and only enables the final button after a 3-second countdown. `items` may be a loader for
 * lists that have to be fetched first (e.g. everything in the trash).
 */
export function DoubleConfirm({ open, onOpenChange, title, children, confirmLabel, finalLabel = "Permanently delete", items, onConfirm, busy, alternative }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; confirmLabel: string; finalLabel?: string;
  items: DoomedItem[] | (() => Promise<DoomedItem[]>); onConfirm: () => void; busy?: boolean;
  /** Safer option shown between Cancel and the confirm button on step 1 (e.g. "Move to trash instead"). */
  alternative?: { label: string; onSelect: () => void };
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [list, setList] = useState<DoomedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [left, setLeft] = useState(3);
  useEffect(() => { if (!open) { setStep(1); setList(null); setLoadError(null); setLeft(3); } }, [open]);
  useEffect(() => {
    if (step !== 2 || list === null || left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [step, list, left]);
  const next = async () => {
    setStep(2); setLeft(3);
    if (Array.isArray(items)) { setList(items); return; }
    try { setList(await items()); } catch (e) { setLoadError(errText(e)); setList([]); }
  };
  const total = (list ?? []).reduce((a, i) => a + (i.size ?? 0), 0);
  const folders = (list ?? []).filter((i) => i.isFolder).length;

  if (step === 1) return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title={title} confirmLabel={confirmLabel} danger onConfirm={next}
      extra={alternative && <Button variant="outline" onClick={alternative.onSelect}>{alternative.label}</Button>}>{children}</ConfirmDialog>);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Are you sure?"
      description={list === null ? "Getting the list of items…" : <>
        {list.length === 0 && !loadError ? "There's nothing to delete." : <>
          <b className="text-destructive">{list.length.toLocaleString()} item{list.length === 1 ? "" : "s"}</b>{total ? ` (${fmtBytes(total)})` : ""} will be permanently deleted from Google Drive.
          {folders ? ` That includes everything you own inside ${folders} folder${folders === 1 ? "" : "s"}.` : ""} This can't be undone.</>}
        {loadError && <span className="mt-1 block text-destructive">Couldn't load the full list: {loadError}</span>}
      </>}>
      <div className="space-y-4">
        {list === null ? <Spinner /> : list.length > 0 && (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-sm" aria-label="Items that will be deleted">
            {list.map((i, k) => (
              <li key={`${i.name}-${k}`} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate" title={i.name}>{i.isFolder ? "📁 " : ""}{i.name}</span>
                {i.size != null && <span className="shrink-0 text-xs text-muted-foreground">{fmtBytes(i.size)}</span>}
              </li>))}
          </ul>)}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
          <Button variant="destructive" disabled={busy || list === null || list.length === 0 || left > 0} onClick={onConfirm}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{left > 0 && list !== null && list.length > 0 ? `${finalLabel} (${left})` : finalLabel}</Button>
        </div>
      </div>
    </Dialog>
  );
}

const fmtBytes = (n: number) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return `${v.toFixed(i ? 1 : 0)} ${u[i]}`; };

/** Thin, light divider between page sections (instead of a plain gap). */
export const Separator = ({ className }: { className?: string }) => <hr className={`my-3 border-0 border-t border-border/50 ${className ?? ""}`} />;
