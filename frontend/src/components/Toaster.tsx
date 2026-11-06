import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useUI } from "@/stores/ui";
import { cn } from "@/utils/cn";
import { useMask } from "@/utils/privacy";

export function Toaster() {
  const m = useMask();
  const { toasts, dismiss } = useUI();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(24rem,92vw)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-md border bg-card p-3 text-sm shadow-lg", t.kind === "error" && "border-destructive/50")}>
          {t.kind === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          <span className="flex-1">{m.text(t.text)}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
