import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium font-tech uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary",
        ok: "border-transparent bg-[var(--ok)]/15 text-[var(--ok)]",
        warn: "border-transparent bg-[var(--warn)]/15 text-[var(--warn)]",
        alert: "border-transparent bg-[var(--alert)]/15 text-[var(--alert)]",
        outline: "border-border text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
