import * as React from "react";
import { cn } from "@/lib/utils";

// Barra de progresso simples (sem dependência externa). `indicatorClassName`
// permite gatilhos de cor por faixa (verde/amarelo/vermelho da bateria).
export function Progress({
  value = 0,
  className,
  indicatorClassName,
  indicatorStyle,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
  indicatorClassName?: string;
  indicatorStyle?: React.CSSProperties;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative h-3 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          indicatorClassName,
        )}
        style={{ width: `${pct}%`, ...indicatorStyle }}
      />
    </div>
  );
}
