import * as React from "react";
import { cn } from "@/lib/utils";

// Banner de alerta crítico (arrasto/algas, superaquecimento, bateria).
export function AlertBanner({
  variant = "warn",
  title,
  message,
  icon,
  className,
}: {
  variant?: "warn" | "alert";
  title: string;
  message?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const color = variant === "alert" ? "var(--alert)" : "var(--warn)";
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        variant === "alert" && "animate-pulse-alert",
        className,
      )}
      style={{
        borderColor: color,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        color,
      }}
    >
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        <div className="font-tech text-sm font-medium uppercase tracking-wide">
          {title}
        </div>
        {message && (
          <div className="text-sm text-foreground/80">{message}</div>
        )}
      </div>
    </div>
  );
}
