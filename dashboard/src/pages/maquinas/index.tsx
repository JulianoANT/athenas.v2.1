// Aba 2 — Casa de Máquinas (Athenas OS v2.0).
// Velocímetro náutico (todos), gráfico comparativo de arrasto leme x corrente
// (tripulação), alerta de bloqueio por algas (todos) e saúde da bateria por
// faixa de tensão (tripulação).
import * as React from "react";
import {
  IconAlertTriangle,
  IconBattery2,
  IconPropeller,
  IconBolt,
} from "@tabler/icons-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { RadialGauge } from "@/components/gauge";
import { AlertBanner } from "@/components/alert-banner";
import { useTelemetry } from "@/lib/telemetry/provider";
import { useAuth } from "@/lib/auth";
import {
  batteryLevel,
  batteryPercent,
  toKnots,
  BATTERY_GREEN_V,
  BATTERY_RED_V,
  BATTERY_YELLOW_HI_V,
  BATTERY_YELLOW_LO_V,
  TATICA_RUDDER_DEG,
  ALGAE_CURRENT_A,
} from "@/lib/telemetry/contract";

const DRAG_POINTS = 240; // ~48 s a 5 Hz
const KNOTS_MAX = 30;

function timeLabel(t: number) {
  return new Date(t).toLocaleTimeString([], {
    minute: "2-digit",
    second: "2-digit",
  });
}

// --- Cores de faixa da bateria (curva chumbo-ácido da Diretriz) ---
const BATTERY_COLOR: Record<ReturnType<typeof batteryLevel>, string> = {
  green: "var(--ok)",
  yellow: "var(--warn)",
  red: "var(--alert)",
};

// --- Gráfico Comparativo de Arrasto (duplo eixo Y) — só tripulação ---
const dragConfig = {
  rudder_deg: { label: "Leme", color: "var(--chart-1)" },
  current_a: { label: "Corrente", color: "var(--alert)" },
} satisfies ChartConfig;

function DragChart({
  data,
}: {
  data: { t: number; rudder_deg: number; current_a: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconPropeller size={18} className="text-[var(--cyan)]" />
          Comparativo de Arrasto
        </CardTitle>
        <CardDescription>
          Guinadas bruscas do leme aumentam a resistência hidrodinâmica e geram
          picos de corrente no motor (arrasto). Eixo esquerdo: ângulo do leme;
          eixo direito: corrente do motor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={dragConfig} className="h-[260px] w-full">
          <ComposedChart data={data} margin={{ left: 4, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={40}
              tickFormatter={timeLabel}
            />
            <YAxis
              yAxisId="leme"
              orientation="left"
              domain={[-45, 45]}
              width={42}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              unit="°"
              stroke="var(--chart-1)"
            />
            <YAxis
              yAxisId="corrente"
              orientation="right"
              domain={[0, 40]}
              width={42}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              unit="A"
              stroke="var(--alert)"
            />
            <ReferenceLine
              yAxisId="leme"
              y={0}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.4}
            />
            <ChartTooltip
              cursor={false}
              labelFormatter={(v) => timeLabel(Number(v))}
              content={<ChartTooltipContent />}
            />
            <Line
              yAxisId="leme"
              dataKey="rudder_deg"
              name="rudder_deg"
              type="monotone"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="corrente"
              dataKey="current_a"
              name="current_a"
              type="monotone"
              stroke="var(--alert)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3 rounded-full"
            style={{ background: "var(--chart-1)" }}
          />
          Leme (°), limite tático ±{TATICA_RUDDER_DEG}°
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3 rounded-full"
            style={{ background: "var(--alert)" }}
          />
          Corrente (A), alerta de algas &gt; {ALGAE_CURRENT_A}A
        </span>
      </CardFooter>
    </Card>
  );
}

// --- Saúde da Bateria (faixa de tensão) — só tripulação ---
function BatteryHealth({ voltage_v }: { voltage_v: number }) {
  const pct = batteryPercent(voltage_v);
  const level = batteryLevel(voltage_v);
  const color = BATTERY_COLOR[level];
  // Vermelho piscante quando abaixo de 10.5 V.
  const blink = level === "red";

  const badgeVariant =
    level === "green" ? "ok" : level === "yellow" ? "warn" : "alert";
  const levelLabel =
    level === "green" ? "Nominal" : level === "yellow" ? "Atenção" : "Crítica";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconBattery2 size={18} style={{ color }} />
          Saúde da Bateria
        </CardTitle>
        <CardDescription>
          Estimativa de carga pela tensão da bateria de chumbo-ácido 12 V.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between">
          <div className={blink ? "animate-blink" : undefined} style={{ color }}>
            <span className="font-tech text-3xl font-medium leading-none">
              {voltage_v.toFixed(2)}
            </span>
            <span className="ml-1 align-super text-sm text-muted-foreground">
              V
            </span>
          </div>
          <div
            className="font-tech text-2xl font-medium leading-none"
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
        <div className="flex items-center justify-between text-xs text-muted-foreground">
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

export default function Maquinas() {
  const { frame, history } = useTelemetry();
  const { isCrew } = useAuth();

  const knots = frame ? toKnots(frame.gps.speed_kmh) : 0;
  const algaeAlert = frame?.status.algae_alert ?? false;
  const voltage_v = frame?.sensors.voltage_v ?? 0;

  const dragData = React.useMemo(
    () =>
      history.slice(-DRAG_POINTS).map((s) => ({
        t: s.t,
        rudder_deg: Number(s.sensors.rudder_deg.toFixed(1)),
        current_a: Number(s.sensors.current_a.toFixed(2)),
      })),
    [history],
  );

  return (
    <div className="space-y-4">
      {/* Alerta de Algas — visível a todos */}
      {algaeAlert && (
        <AlertBanner
          variant="warn"
          icon={<IconAlertTriangle size={20} />}
          title="ANOMALIA DE ARRASTO: POSSÍVEL BLOQUEIO POR ALGAS - RECOMENDA-SE ACOPLAR MARCHA A RÉ"
          message="Corrente elevada e sustentada com velocidade baixa: provável obstrução na hélice/leme."
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Velocímetro de desempenho — visível a todos */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconBolt size={18} className="text-[var(--cyan)]" />
              Velocímetro de Desempenho
            </CardTitle>
            <CardDescription>
              Velocidade sobre o solo convertida para a unidade naval (nós).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadialGauge
              value={knots}
              min={0}
              max={KNOTS_MAX}
              unit="nós"
              label="velocidade"
              valueColor="var(--cyan)"
              decimals={1}
            />
          </CardContent>
        </Card>

        {/* Gráfico de Arrasto — só tripulação */}
        {isCrew && (
          <div className="lg:col-span-2">
            <DragChart data={dragData} />
          </div>
        )}
      </div>

      {/* Saúde da Bateria — só tripulação */}
      {isCrew && <BatteryHealth voltage_v={voltage_v} />}
    </div>
  );
}
