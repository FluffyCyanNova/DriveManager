import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

const v = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: { tone: {
    neutral: "bg-secondary text-secondary-foreground border-transparent",
    success: "bg-success/12 text-success border-success/25",
    warning: "bg-warning/12 text-warning border-warning/30",
    danger: "bg-destructive/10 text-destructive border-destructive/30",
    info: "bg-accent text-accent-foreground border-transparent",
  } },
  defaultVariants: { tone: "neutral" },
});
export const Badge = ({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof v>) => <span className={cn(v({ tone }), className)} {...p} />;
