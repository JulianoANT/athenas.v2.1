// =============================================================================
//  ABA 2 — Casa de Maquinas
//
//  O conjunto motriz sob observacao: velocimetro naval, eficiencia
//  hidrodinamica (W/no), gemeo digital termico, comparativo de arrasto
//  leme x corrente e saude da bateria.
//
//  Graficos de alta cadencia em CANVAS (uPlot). Ver components/charts.
// =============================================================================

import { useMemo } from "react";
import {
  IconAlertTriangle,
  IconBattery2,
  IconPropeller,
  IconBolt,
  IconGauge,
} from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { RadialGauge } from "@/components/gauge";
import { AlertBanner } from "@/components/alert-banner";
import { EfficiencyGauge } from "@/components/efficiency-gauge";
import { ThermalTwin } from "@/components/thermal/thermal-twin";
import { LiveChart, type ChartSeries } from "@/components/charts/live-chart";
import { useAuth } from "@/lib/auth";
import {
  useSpeedKnots,
  useAlgaeAlert,
  useVoltage,
  useBatteryPercent,
} from "@/lib/telemetry/selectors";
import {
  batteryLevel,
  BATTERY_GREEN_V,
  BATTERY_RED_V,
  BATTERY_YELLOW_HI_V,
  BATTERY_YELLOW_LO_V,
  TATICA_RUDDER_DEG,
  ALGAE_CURRENT_A,
  RUDDER_MAX_DEG,
} from "@/lib/telemetry/contract";

const KNOTS_MAX = 30;

const BATTERY_COLOR: Record<ReturnType<typeof batteryLevel>, string> = {
  green: "var(--ok)",
  yellow: "var(--warn)",
  red: "var(--alert)",
};

// -----------------------------------------------------------------------------
//  Grafico Comparativo de Arrasto (duplo eixo Y) — so tripulacao.
//
//  Correlaciona o angulo do leme com a corrente do motor. Guinadas bruscas
//  aumentam a resistencia hidrodinamica e geram picos de corrente; ver as duas
//  curvas sobrepostas e o que permite separar "arrasto por pilotagem" de
//  "arrasto por obstrucao".
// -----------------------------------------------------------------------------
function DragChart() {
  const series = useMemo<ChartSeries[]>(
    () => [
      {
        key: "rudder_deg",
        label: "Leme",
        color: "var(--chart-1)",
        unit: "°",
        axis: "left",
        range: [-RUDDER_MAX_DEG, RUDDER_MAX_DEG],
      },
      {
        key: "current_a",
        label: "Corrente",
        color: "var(--alert)",
        unit: "A",
        axis: "right",
        range: [0, 40],
      },
    ],
    [],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconPropeller size={18} className="text-[var(--cyan)]" />
          Comparativo de Arrasto
        </CardTitle>
        <CardDescription>
          Eixo esquerdo: angulo do leme. Eixo direito: corrente do motor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LiveChart series={series} height={260} windowPoints={900} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3 rounded-full"
            style={{ background: "var(--chart-1)" }}
          />
          Leme (°), limite tatico ±{TATICA_RUDDER_DEG}°
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3 rounded-full"
            style={{ background: "var(--alert)" }}
          />
          Corrente (A), alerta de algas &gt; {ALGAE_CURRENT_A} A
        </span>
      </CardFooter>
    </Card>
  );
}

// -----------------------------------------------------------------------------
//  Curva termica: sensor fisico x nucleo virtual, sobrepostos.
// -----------------------------------------------------------------------------
function ThermalChart() {
  const series = useMemo<ChartSeries[]>(
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
      {
        key: "ambient_c",
        label: "Ambiente",
        color: "var(--muted-foreground)",
        unit: "°C",
        width: 1.2,
        dash: [6, 4],
      },
    ],
    [],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconGauge size={18} style={{ color: "#ff9e2c" }} />
          Curva Termica do Estator
        </CardTitle>
        <CardDescription>
          A distancia entre a curva laranja e a branca e a inercia termica do
          sensor — e a margem de antecipacao que o modelo compra.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LiveChart series={series} height={240} windowPoints={1800} />
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
//  Saude da bateria — so tripulacao.
// -----------------------------------------------------------------------------
function BatteryHealth() {
  const voltage_v = useVoltage();
  const pct = useBatteryPercent();
  const level = batteryLevel(voltage_v);
  const color = BATTERY_COLOR[level];
  const blink = level === "red";

  const badgeVariant =
    level === "green" ? "ok" : level === "yellow" ? "warn" : "alert";
  const levelLabel =
    level === "green" ? "Nominal" : level === "yellow" ? "Atencao" : "Critica";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconBattery2 size={18} style={{ color }} />
          Saude da Bateria
        </CardTitle>
        <CardDescription>
          Estimativa de carga pela tensao da bateria de chumbo-acido 12 V.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className={blink ? "animate-blink" : undefined} style={{ color }}>
            <span className="font-tech text-2xl font-medium leading-none sm:text-3xl">
              {voltage_v.toFixed(2)}
            </span>
            <span className="ml-1 align-super text-sm text-muted-foreground">
              V
            </span>
          </div>
          <div
            className="font-tech text-xl font-medium leading-none sm:text-2xl"
            style={{ color }}
          >
            {pct.toFixed(0)}
            <span className="ml-0.5 align-super text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <Progress
          value={pct}
          indicatorClassName={blink ? "animate-blink" : undefined}
          indicatorStyle={{ background: color }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <Badge variant={badgeVariant}>{levelLabel}</Badge>
          <span>
            Verde &ge; {BATTERY_GREEN_V} V · Amarelo {BATTERY_YELLOW_LO_V}–
            {BATTERY_YELLOW_HI_V} V · Vermelho &lt; {BATTERY_RED_V} V
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
//  Descarga da bateria e potencia — so tripulacao.
// -----------------------------------------------------------------------------
function PowerChart() {
  const series = useMemo<ChartSeries[]>(
    () => [
      {
        key: "power_w",
        label: "Potencia",
        color: "var(--chart-3)",
        unit: "W",
        axis: "left",
      },
      {
        key: "voltage_v",
        label: "Tensao",
        color: "var(--chart-4)",
        unit: "V",
        axis: "right",
        range: [9.5, 13.5],
      },
    ],
    [],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconBolt size={18} className="text-[var(--cyan)]" />
          Potencia e Descarga
        </CardTitle>
        <CardDescription>
          Potencia de entrada (V·I) e queda de tensao da bateria ao longo da
          sessao.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LiveChart series={series} height={240} windowPoints={1800} />
      </CardContent>
    </Card>
  );
}

export default function Maquinas() {
  const { isCrew } = useAuth();
  const knots = useSpeedKnots();
  const algaeAlert = useAlgaeAlert();

  return (
    <div className="space-y-4">
      {/* Alerta de Algas — visivel a todos */}
      {algaeAlert && (
        <AlertBanner
          variant="warn"
          icon={<IconAlertTriangle size={20} />}
          title="Anomalia de arrasto: possivel bloqueio por algas — recomenda-se acoplar marcha a re"
          message="Corrente elevada e sustentada com velocidade baixa: provavel obstrucao na helice ou no leme."
        />
      )}

      {/* Linha 1: velocimetro + eficiencia + gemeo termico.
          Mobile: coluna. Tablet: 2 colunas. Desktop: 3 colunas. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconGauge size={18} className="text-[var(--cyan)]" />
              Velocimetro de Desempenho
            </CardTitle>
            <CardDescription>
              Velocidade sobre o solo na unidade naval (nos).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadialGauge
              value={knots}
              min={0}
              max={KNOTS_MAX}
              unit="nos"
              label="velocidade"
              valueColor="var(--cyan)"
              decimals={1}
            />
          </CardContent>
        </Card>

        <EfficiencyGauge />

        {/* O gemeo termico e informacao de seguranca operacional, entao fica
            visivel tambem para o publico/avaliador. */}
        <ThermalTwin compact className="md:col-span-2 xl:col-span-1" />
      </div>

      {/* Linha 2: analitica pesada — so tripulacao */}
      {isCrew && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <DragChart />
            <ThermalChart />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <PowerChart />
            <BatteryHealth />
          </div>
        </>
      )}
    </div>
  );
}
