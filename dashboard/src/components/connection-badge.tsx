import {
  IconBroadcast,
  IconFlask,
  IconLoader2,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTelemetry } from "@/lib/telemetry/provider";
import type { ConnectionStatus } from "@/types/telemetry";

const META: Record<
  ConnectionStatus,
  { label: string; variant: "ok" | "warn" | "alert" | "muted"; Icon: typeof IconBroadcast; spin?: boolean }
> = {
  live: { label: "Ao vivo · 5 Hz", variant: "ok", Icon: IconBroadcast },
  mock: { label: "Simulação · 5 Hz", variant: "muted", Icon: IconFlask },
  connecting: {
    label: "Conectando…",
    variant: "warn",
    Icon: IconLoader2,
    spin: true,
  },
  disconnected: {
    label: "Sem sinal",
    variant: "alert",
    Icon: IconPlugConnectedX,
  },
};

// Indicador do estado da conexão de telemetria + chave Mock/Ao vivo.
export function ConnectionBadge() {
  const { status, mode, setMode } = useTelemetry();
  const m = META[status];
  const Icon = m.Icon;
  return (
    <div className="flex items-center gap-2">
      <Badge variant={m.variant}>
        <Icon className={`size-3.5 ${m.spin ? "animate-spin" : ""}`} />
        {m.label}
      </Badge>
      <Button
        variant="outline"
        size="sm"
        className="h-7 font-tech text-[11px] uppercase"
        onClick={() => setMode(mode === "mock" ? "live" : "mock")}
        title="Alternar entre simulação e telemetria ao vivo"
      >
        {mode === "mock" ? "→ Ao vivo" : "→ Simular"}
      </Button>
    </div>
  );
}
