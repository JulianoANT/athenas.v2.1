// Visão Geral — painel consolidado em tempo real (Athenas OS v2.0).
import * as React from "react";
import {
  IconGauge,
  IconTemperature,
  IconBolt,
  IconBattery,
  IconRoute,
  IconCompass,
} from "@tabler/icons-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { MetricCard } from "@/components/metric-card";
import { useTelemetry } from "@/lib/telemetry/provider";
import { useAuth } from "@/lib/auth";
import { batteryPercent, toKnots } from "@/lib/telemetry/contract";

const VIEW_POINTS = 240; // ~48 s a 5 Hz

function timeLabel(t: number) {
  return new Date(t).toLocaleTimeString([], {
    minute: "2-digit",
    second: "2-digit",
  });
}

function LiveArea({
  title,
  subtitle,
  data,
  dataKey,
  unit,
  color,
}: {
  title: string;
  subtitle: string;
  data: { t: number; [k: string]: number }[];
  dataKey: string;
  unit: string;
  color: string;
}) {
  const config = {
    [dataKey]: { label: title, color },
  } satisfies ChartConfig;
  const gid = `fill-${dataKey}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-[200px] w-full">
          <AreaChart data={data} margin={{ left: 4, right: 12 }}>
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
              width={40}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              unit={unit}
            />
            <ChartTooltip
              cursor={false}
              labelFormatter={(v) => timeLabel(Number(v))}
              content={<ChartTooltipContent />}
            />
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.7} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              dataKey={dataKey}
              type="monotone"
              stroke={color}
              fill={`url(#${gid})`}
              isAnimationActive={false}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { frame, history, distance_m, sessionStart } = useTelemetry();
  const { isCrew } = useAuth();

  const points = React.useMemo(
    () =>
      history.slice(-VIEW_POINTS).map((s) => ({
        t: s.t,
        knots: Number(toKnots(s.gps.speed_kmh).toFixed(2)),
        temp: s.sensors.temp_c,
        current: s.sensors.current_a,
        voltage: s.sensors.voltage_v,
      })),
    [history],
  );

  const f = frame;
  const knots = f ? toKnots(f.gps.speed_kmh) : 0;
  const battery = f ? batteryPercent(f.sensors.voltage_v) : 0;
  const elapsed = Math.max(0, Math.floor((Date.now() - sessionStart) / 1000));
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60,
  ).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Velocidade"
          value={knots.toFixed(1)}
          unit="nós"
          icon={<IconGauge className="size-4" />}
        />
        <MetricCard
          label="Rumo (COG)"
          value={f ? f.gps.cog.toFixed(0) : "--"}
          unit="°"
          icon={<IconCompass className="size-4" />}
        />
        <MetricCard
          label="Temperatura"
          value={f ? f.sensors.temp_c.toFixed(1) : "--"}
          unit="°C"
          icon={<IconTemperature className="size-4" />}
          valueColor={f && f.sensors.temp_c >= 70 ? "var(--alert)" : undefined}
        />
        {isCrew && (
          <MetricCard
            label="Corrente"
            value={f ? f.sensors.current_a.toFixed(1) : "--"}
            unit="A"
            icon={<IconBolt className="size-4" />}
            valueColor={
              f && f.sensors.current_a > 18 ? "var(--warn)" : undefined
            }
          />
        )}
        {isCrew && (
          <MetricCard
            label="Bateria"
            value={battery.toFixed(0)}
            unit="%"
            icon={<IconBattery className="size-4" />}
            hint={f ? `${f.sensors.voltage_v.toFixed(2)} V` : undefined}
          />
        )}
        <MetricCard
          label="Sessão"
          value={mmss}
          icon={<IconRoute className="size-4" />}
          hint={
            distance_m != null
              ? `${distance_m.toFixed(0)} m da estação`
              : "estação não definida"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LiveArea
          title="Velocidade"
          subtitle="Nós ao longo da sessão"
          data={points}
          dataKey="knots"
          unit=" kn"
          color="var(--chart-1)"
        />
        <LiveArea
          title="Temperatura do estator"
          subtitle="°C ao longo da sessão"
          data={points}
          dataKey="temp"
          unit="°"
          color="var(--chart-2)"
        />
        {isCrew && (
          <LiveArea
            title="Corrente do motor"
            subtitle="Ampéres (ACS758)"
            data={points}
            dataKey="current"
            unit="A"
            color="var(--chart-3)"
          />
        )}
        {isCrew && (
          <LiveArea
            title="Tensão da bateria"
            subtitle="Volts (chumbo-ácido)"
            data={points}
            dataKey="voltage"
            unit="V"
            color="var(--chart-4)"
          />
        )}
      </div>
    </div>
  );
}
