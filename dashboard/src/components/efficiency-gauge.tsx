// =============================================================================
//  EfficiencyGauge — Consumo Especifico (W por no de velocidade)
//
//  A metrica que decide uma prova de eficiencia. Correlaciona a potencia
//  eletrica de entrada com a velocidade sobre a agua:
//
//      P_in = V_bat · I_mot        [W]
//      SEC  = P_in / v             [W/no]
//
//  Quanto MENOR, melhor: significa mais milha nautica por watt.
//
//  Se o SEC sobe DE REPENTE sem ganho de velocidade, a helice esta patinando
//  (cavitacao) ou o casco ganhou arrasto — algas na hélice, leme travado,
//  deriva. O detector em @/lib/math/hydrodynamics compara o valor instantaneo
//  com uma linha de base aprendida e dispara o aviso.
// =============================================================================

import { IconBolt, IconAlertTriangle } from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadialGauge } from "@/components/gauge";
import { useTelemetryStore } from "@/lib/telemetry/store";
import {
  usePower,
  useSpecificConsumption,
  useCavitationAlert,
  useSpeedKnots,
} from "@/lib/telemetry/selectors";
import {
  SEC_MAX_W_PER_KNOT,
  SEC_NOMINAL_W_PER_KNOT,
  type EfficiencyLevel,
} from "@/lib/math/hydrodynamics";

const LEVEL_COLOR: Record<EfficiencyLevel, string> = {
  otimo: "var(--ok)",
  nominal: "var(--cyan)",
  degradado: "var(--warn)",
  critico: "var(--alert)",
};

const LEVEL_LABEL: Record<EfficiencyLevel, string> = {
  otimo: "Otimo",
  nominal: "Nominal",
  degradado: "Degradado",
  critico: "Critico",
};

const LEVEL_BADGE: Record<EfficiencyLevel, "ok" | "warn" | "alert" | "muted"> = {
  otimo: "ok",
  nominal: "ok",
  degradado: "warn",
  critico: "alert",
};

export function EfficiencyGauge({ className }: { className?: string }) {
  const power = usePower();
  const sec = useSpecificConsumption();
  const cavitation = useCavitationAlert();
  const knots = useSpeedKnots();
  const level = useTelemetryStore((s) => s.efficiency);

  const color = level ? LEVEL_COLOR[level] : "var(--muted-foreground)";
  const moving = sec !== null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <IconBolt size={18} style={{ color }} />
            Eficiencia Hidrodinamica
          </span>
          {cavitation ? (
            <Badge variant="alert">
              <IconAlertTriangle className="size-3" />
              Anomalia
            </Badge>
          ) : level ? (
            <Badge variant={LEVEL_BADGE[level]}>{LEVEL_LABEL[level]}</Badge>
          ) : (
            <Badge variant="muted">Parado</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Consumo especifico: watts de entrada por no de velocidade
          (P<sub>in</sub> = V<sub>bat</sub> · I<sub>mot</sub>).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Aviso de cavitacao / arrasto excessivo */}
        {cavitation && (
          <div
            role="alert"
            className="animate-pulse-alert rounded-md border px-3 py-2"
            style={{
              borderColor: "var(--alert)",
              background: "color-mix(in oklab, var(--alert) 12%, transparent)",
            }}
          >
            <div
              className="font-tech text-xs font-bold uppercase tracking-wide"
              style={{ color: "var(--alert)" }}
            >
              Cavitacao ou arrasto excessivo
            </div>
            <div className="mt-0.5 text-xs text-foreground/80">
              O consumo especifico disparou sem ganho de velocidade. Verifique
              obstrucao na helice, angulo do leme e deriva do casco.
            </div>
          </div>
        )}

        <RadialGauge
          value={moving ? Math.min(sec, SEC_MAX_W_PER_KNOT) : 0}
          min={0}
          max={SEC_MAX_W_PER_KNOT}
          unit="W / no"
          label="consumo especifico"
          valueColor={color}
          decimals={0}
        />

        {!moving && (
          <p className="text-center text-xs text-muted-foreground">
            Abaixo de 0,8 no o consumo especifico nao tem significado fisico —
            a divisao por uma velocidade quase nula explodiria o indicador.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Potencia
            </div>
            <div className="font-tech text-base font-semibold tabular-nums">
              {power.toFixed(0)}
              <span className="ml-0.5 text-[10px] text-muted-foreground">W</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Velocidade
            </div>
            <div className="font-tech text-base font-semibold tabular-nums">
              {knots.toFixed(1)}
              <span className="ml-0.5 text-[10px] text-muted-foreground">
                kn
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Referencia
            </div>
            <div className="font-tech text-base font-semibold tabular-nums text-muted-foreground">
              {SEC_NOMINAL_W_PER_KNOT}
              <span className="ml-0.5 text-[10px]">W/kn</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
