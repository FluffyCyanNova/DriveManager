import { Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
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

export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, danger, onConfirm, busy }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={children}>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
