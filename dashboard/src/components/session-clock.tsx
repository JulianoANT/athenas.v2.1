// =============================================================================
//  SessionClock — tempo decorrido da sessao.
//
//  Isolado num componente proprio de proposito: o relogio precisa de um tick
//  de 1 Hz, e se ele morasse dentro da pagina inteira o `setState` do tick
//  re-renderizaria todos os cartoes e graficos a cada segundo.
// =============================================================================

import * as React from "react";
import { IconRoute } from "@tabler/icons-react";

import { MetricCard } from "@/components/metric-card";
import { useTelemetryStore } from "@/lib/telemetry/store";

function format(elapsedSeconds: number): string {
  const total = Math.max(0, Math.floor(elapsedSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function SessionClock({ hint }: { hint?: React.ReactNode }) {
  const sessionStart = useTelemetryStore((s) => s.sessionStart);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <MetricCard
      label="Sessao"
      value={format((now - sessionStart) / 1000)}
      icon={<IconRoute className="size-4" />}
      hint={hint}
    />
  );
}
