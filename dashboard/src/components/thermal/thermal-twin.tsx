// =============================================================================
//  ThermalTwin — Gemeo Digital Termico do estator
//
//  Mostra DUAS temperaturas lado a lado:
//
//    BRANCO  — o que o DS18B20 esta medindo AGORA. E a verdade fisica, mas
//              chega atrasada: o sensor esta na carcaca, nao no enrolamento.
//
//    LARANJA NEON — a temperatura VIRTUAL do nucleo, integrada no navegador
//              pela equacao diferencial de Joule-Newton a partir da corrente
//              instantanea. Ela salta quase junto com a manete.
//
//  O valor da barra laranja e antecipar o dano: quando o piloto acelera
//  bruscamente, a tripulacao no no mestre ve o nucleo virtual disparar DEZENAS
//  DE SEGUNDOS antes de o sensor fisico registrar qualquer coisa, e da tempo de
//  chamar no radio.
//
//  O delta entre as duas curvas e, por si so, um diagnostico: um delta grande e
//  persistente indica que o motor esta acumulando calor mais rapido do que
//  dissipa.
// =============================================================================

import {
  IconTemperature,
  IconFlame,
  IconAlertTriangle,
  IconWind,
} from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useTelemetryStore, MELTDOWN_HORIZON_S } from "@/lib/telemetry/store";
import {
  useMotorTemp,
  useVirtualCoreTemp,
  useAmbientTemp,
  useMotorTempFault,
  useAmbientFault,
  useSecondsToMeltdown,
  useMeltdownImminent,
} from "@/lib/telemetry/selectors";
import { OVERHEAT_C, MELTDOWN_C } from "@/lib/telemetry/contract";
import { cn } from "@/lib/utils";

/** Laranja neon da temperatura virtual (identidade do gemeo digital). */
const VIRTUAL_COLOR = "#ff9e2c";

/** Escala das barras, em °C. */
const T_MIN = 0;
const T_MAX = 110;

function pct(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(100, ((t - T_MIN) / (T_MAX - T_MIN)) * 100));
}

function TempBar({
  value,
  color,
  faded,
}: {
  value: number;
  color: string;
  faded?: boolean;
}) {
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full transition-[width] duration-200"
        style={{
          width: `${pct(value)}%`,
          background: color,
          opacity: faded ? 0.45 : 1,
          boxShadow: faded ? undefined : `0 0 8px ${color}`,
        }}
      />
      {/* Marca do limiar de superaquecimento (70 °C) */}
      <div
        className="absolute top-0 h-full w-px"
        style={{ left: `${pct(OVERHEAT_C)}%`, background: "var(--alert)" }}
      />
    </div>
  );
}

export interface ThermalTwinProps {
  /** Versao compacta, para caber no grid da Casa de Maquinas. */
  compact?: boolean;
  className?: string;
}

export function ThermalTwin({ compact = false, className }: ThermalTwinProps) {
  const physical = useMotorTemp();
  const virtual = useVirtualCoreTemp();
  const ambient = useAmbientTemp();
  const physicalFault = useMotorTempFault();
  const ambientFault = useAmbientFault();
  const secondsToMeltdown = useSecondsToMeltdown();
  const meltdownImminent = useMeltdownImminent();
  const projected = useTelemetryStore((s) => s.projectedCoreTemp);

  const hasVirtual = Number.isFinite(virtual);
  const delta = hasVirtual ? virtual - physical : NaN;

  const physicalOver = physical >= OVERHEAT_C;
  const virtualOver = hasVirtual && virtual >= OVERHEAT_C;

  return (
    <Card
      className={cn(className, meltdownImminent && "animate-pulse-alert")}
      style={
        meltdownImminent
          ? {
              borderColor: "var(--alert)",
              background: "color-mix(in oklab, var(--alert) 8%, var(--card))",
            }
          : undefined
      }
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <IconFlame
              className="size-4"
              style={{ color: virtualOver ? "var(--alert)" : VIRTUAL_COLOR }}
            />
            Gemeo Digital Termico
          </span>
          {meltdownImminent ? (
            <Badge variant="alert">
              <IconAlertTriangle className="size-3" />
              Fusao iminente
            </Badge>
          ) : virtualOver ? (
            <Badge variant="warn">Nucleo acima de {OVERHEAT_C} °C</Badge>
          ) : (
            <Badge variant="ok">Nominal</Badge>
          )}
        </CardTitle>
        {!compact && (
          <CardDescription>
            Modelo diferencial dT/dt = α·I² − β·(T − T_amb) integrado por Euler
            no navegador, a 5 Hz.
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---------- Sensor fisico (BRANCO) ---------- */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <IconTemperature className="size-3.5" />
              Sensor fisico (DS18B20)
            </span>
            {physicalFault && (
              <Badge variant="alert" className="text-[9px]">
                falha
              </Badge>
            )}
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className="font-tech text-3xl font-bold leading-none tabular-nums sm:text-4xl"
              style={{
                // Branco puro: e a leitura de referencia, a verdade medida.
                color: physicalOver ? "var(--alert)" : "var(--foreground)",
                opacity: physicalFault ? 0.5 : 1,
              }}
            >
              {physicalFault ? "--" : physical.toFixed(1)}
            </span>
            <span className="text-sm text-muted-foreground">°C</span>
          </div>
          <TempBar
            value={physical}
            color={physicalOver ? "var(--alert)" : "var(--foreground)"}
            faded={physicalFault}
          />
        </div>

        {/* ---------- Nucleo virtual (LARANJA NEON) ---------- */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <IconFlame className="size-3.5" />
              Nucleo virtual (preditivo)
            </span>
            {Number.isFinite(delta) && (
              <span
                className="font-tech text-[11px] tabular-nums"
                style={{ color: delta > 5 ? VIRTUAL_COLOR : undefined }}
              >
                Δ {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)} °C
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className="font-tech text-3xl font-bold leading-none tabular-nums sm:text-4xl"
              style={{
                color: virtualOver ? "var(--alert)" : VIRTUAL_COLOR,
                textShadow: `0 0 14px ${
                  virtualOver ? "var(--alert)" : VIRTUAL_COLOR
                }55`,
              }}
            >
              {hasVirtual ? virtual.toFixed(1) : "--"}
            </span>
            <span className="text-sm text-muted-foreground">°C</span>
          </div>
          <TempBar
            value={virtual}
            color={virtualOver ? "var(--alert)" : VIRTUAL_COLOR}
          />
        </div>

        <Separator />

        {/* ---------- Projecao e ambiente ---------- */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Projecao {MELTDOWN_HORIZON_S}s
            </div>
            <div
              className="font-tech text-lg font-semibold tabular-nums"
              style={{
                color:
                  Number.isFinite(projected) && projected >= MELTDOWN_C
                    ? "var(--alert)"
                    : VIRTUAL_COLOR,
              }}
            >
              {Number.isFinite(projected) ? projected.toFixed(1) : "--"}
              <span className="ml-0.5 text-xs text-muted-foreground">°C</span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <IconWind className="size-3" />
              Ambiente (DHT22)
            </div>
            <div
              className="font-tech text-lg font-semibold tabular-nums"
              style={{ opacity: ambientFault ? 0.5 : 1 }}
            >
              {ambientFault ? "--" : ambient.toFixed(1)}
              <span className="ml-0.5 text-xs text-muted-foreground">°C</span>
            </div>
          </div>
        </div>

        {/* Tempo ate a fusao — a informacao acionavel do painel */}
        <div
          className="rounded-md px-3 py-2 text-xs"
          style={{
            background: meltdownImminent
              ? "color-mix(in oklab, var(--alert) 14%, transparent)"
              : "var(--muted)",
            color: meltdownImminent ? "var(--alert)" : "var(--muted-foreground)",
          }}
        >
          {secondsToMeltdown === null ? (
            <>
              Com a corrente atual o nucleo estabiliza abaixo de {MELTDOWN_C}{" "}
              °C. Sem risco de fusao.
            </>
          ) : (
            <>
              <strong className="font-tech">
                {secondsToMeltdown < 1 ? "AGORA" : `${Math.round(secondsToMeltdown)} s`}
              </strong>{" "}
              ate o nucleo atingir {MELTDOWN_C} °C se a aceleracao for mantida.
            </>
          )}
        </div>

        {ambientFault && !compact && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            O DHT22 nao respondeu. Sem T_amb confiavel, o modelo usa a propria
            temperatura do estator como referencia — o que zera o termo de
            resfriamento e torna a previsao CONSERVADORA (mais quente que a
            realidade).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
