// =============================================================================
//  Visao Geral — painel consolidado em tempo real (Athenas OS v2.1)
//
//  A primeira tela que a tripulacao ve. Prioriza densidade de informacao
//  acionavel: KPIs no topo, alertas logo abaixo, series temporais em canvas.
// =============================================================================

import { useMemo } from "react";
import {
  IconGauge,
  IconTemperature,
  IconBolt,
  IconBattery,
  IconCompass,
  IconFlame,
  IconAlertTriangle,
  IconRotate,
} from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { AlertBanner } from "@/components/alert-banner";
import { LiveChart, type ChartSeries } from "@/components/charts/live-chart";
import { CompassRose } from "@/components/nav/compass-rose";
import { ArtificialHorizon } from "@/components/nav/artificial-horizon-lazy";
import { SessionClock } from "@/components/session-clock";
import { useAuth } from "@/lib/auth";
import { useTelemetryStore } from "@/lib/telemetry/store";
import {
  useSpeedKnots,
  useCog,
  useMotorTemp,
  useCurrent,
  useVoltage,
  useBatteryPercent,
  useVirtualCoreTemp,
  useDistance,
  useAlgaeAlert,
  useCavitationAlert,
  useMotorTempFault,
} from "@/lib/telemetry/selectors";
import { OVERHEAT_C, TATICA_CURRENT_A } from "@/lib/telemetry/contract";
import { compassPoint } from "@/lib/math/hydrodynamics";

export default function Dashboard() {
  const { isCrew } = useAuth();

  const knots = useSpeedKnots();
  const cog = useCog();
  const temp = useMotorTemp();
  const virtual = useVirtualCoreTemp();
  const current = useCurrent();
  const voltage = useVoltage();
  const battery = useBatteryPercent();
  const distance_m = useDistance();

  const algae = useAlgaeAlert();
  const cavitation = useCavitationAlert();
  const tempFault = useMotorTempFault();
  const sec = useTelemetryStore((s) => s.sec_w_per_knot);

  // Configuracoes de grafico memoizadas: sem isso, cada render do Dashboard
  // mudaria a identidade do array e reconstruiria o uPlot do zero.
  const speedSeries = useMemo<ChartSeries[]>(
    () => [
      {
        key: "knots",
        label: "Velocidade",
        color: "var(--chart-1)",
        unit: "kn",
      },
    ],
    [],
  );

  const thermalSeries = useMemo<ChartSeries[]>(
    () => [
      {
        key: "temp_c",
        label: "Sensor fisico",
        color: "var(--foreground)",
        unit: "°C",
        width: 1.6,
      },
      {
        key: "virtual_c",
        label: "Nucleo virtual",
        color: "#ff9e2c",
        unit: "°C",
        width: 2.2,
      },
    ],
    [],
  );

  const currentSeries = useMemo<ChartSeries[]>(
    () => [
      { key: "current_a", label: "Corrente", color: "var(--chart-3)", unit: "A" },
    ],
    [],
  );

  const efficiencySeries = useMemo<ChartSeries[]>(
    () => [
      { key: "sec", label: "Consumo esp.", color: "var(--chart-4)", unit: "W/kn" },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      {/* --- Alertas de topo --- */}
      {algae && (
        <AlertBanner
          variant="warn"
          icon={<IconAlertTriangle size={20} />}
          title="Anomalia de arrasto: possivel bloqueio por algas"
          message="Corrente elevada e sustentada com velocidade baixa."
        />
      )}
      {cavitation && (
        <AlertBanner
          variant="alert"
          icon={<IconAlertTriangle size={20} />}
          title="Cavitacao ou arrasto excessivo"
          message="O consumo especifico disparou sem ganho de velocidade."
        />
      )}

      {/* --- KPIs ---
          2 colunas no celular, 3 no tablet, 6 no desktop. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Velocidade"
          value={knots.toFixed(1)}
          unit="nos"
          icon={<IconGauge className="size-4" />}
          valueColor="var(--cyan)"
        />
        <MetricCard
          label="Rumo (COG)"
          value={cog.toFixed(0)}
          unit="°"
          icon={<IconCompass className="size-4" />}
          hint={compassPoint(cog)}
        />
        <MetricCard
          label="Estator"
          value={tempFault ? "--" : temp.toFixed(1)}
          unit="°C"
          icon={<IconTemperature className="size-4" />}
          valueColor={temp >= OVERHEAT_C ? "var(--alert)" : undefined}
          hint={
            Number.isFinite(virtual)
              ? `virtual ${virtual.toFixed(1)} °C`
              : undefined
          }
        />
        <MetricCard
          label="Nucleo virtual"
          value={Number.isFinite(virtual) ? virtual.toFixed(1) : "--"}
          unit="°C"
          icon={<IconFlame className="size-4" />}
          valueColor="#ff9e2c"
          hint="preditivo"
        />
        {isCrew ? (
          <MetricCard
            label="Corrente"
            value={current.toFixed(1)}
            unit="A"
            icon={<IconBolt className="size-4" />}
            valueColor={current > TATICA_CURRENT_A ? "var(--warn)" : undefined}
            hint={`${(voltage * current).toFixed(0)} W`}
          />
        ) : (
          <MetricCard
            label="Consumo esp."
            value={sec === null ? "--" : sec.toFixed(0)}
            unit="W/kn"
            icon={<IconBolt className="size-4" />}
          />
        )}
        {isCrew ? (
          <MetricCard
            label="Bateria"
            value={battery.toFixed(0)}
            unit="%"
            icon={<IconBattery className="size-4" />}
            hint={`${voltage.toFixed(2)} V`}
          />
        ) : (
          <SessionClock
            hint={
              distance_m != null
                ? `${distance_m.toFixed(0)} m da estacao`
                : "estacao nao definida"
            }
          />
        )}
      </div>

      {/* --- Instrumentos de navegacao ---
          No celular a bussola vem primeiro (mais util em campo). */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-2">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <IconCompass className="size-4" />
              Rumo
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center pt-1">
            <CompassRose size={200} />
          </CardContent>
        </Card>

        <Card className="gap-2 lg:col-span-2">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <IconRotate className="size-4" />
              Atitude do Casco
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] sm:h-[260px]">
              <ArtificialHorizon interactive={false} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- Series temporais (Canvas / uPlot) --- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Velocidade</CardTitle>
            <CardDescription>Nos ao longo da sessao</CardDescription>
          </CardHeader>
          <CardContent>
            <LiveChart series={speedSeries} height={200} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Termica do Estator</CardTitle>
            <CardDescription>
              Sensor fisico (branco) x nucleo virtual preditivo (laranja)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LiveChart series={thermalSeries} height={200} />
          </CardContent>
        </Card>

        {isCrew && (
          <Card>
            <CardHeader>
              <CardTitle>Corrente do Motor</CardTitle>
              <CardDescription>Amperes (ACS758, oversampling + EMA)</CardDescription>
            </CardHeader>
            <CardContent>
              <LiveChart series={currentSeries} height={200} />
            </CardContent>
          </Card>
        )}

        {isCrew && (
          <Card>
            <CardHeader>
              <CardTitle>Consumo Especifico</CardTitle>
              <CardDescription>
                Watts por no. Lacunas indicam o barco parado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LiveChart series={efficiencySeries} height={200} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
