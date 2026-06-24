import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Cartão de métrica (KPI) padronizado do Athenas OS.
export function MetricCard({
  label,
  value,
  unit,
  icon,
  hint,
  valueColor,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  /** Cor do valor (ex.: var(--alert) para destaque crítico). */
  valueColor?: string;
  className?: string;
}) {
  return (
    <Card className={cn("gap-2", className)}>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="font-tech text-2xl font-medium leading-none"
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
          {unit && (
            <span className="ml-1 align-super text-sm text-muted-foreground">
              {unit}
            </span>
          )}
        </div>
        {hint && (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}
