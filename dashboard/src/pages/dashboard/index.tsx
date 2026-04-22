// Dashboard.tsx
import {
  batteryChartConfig,
  dashboardData,
  speedChartConfig,
  temperatureChartConfig,
} from "@/mocks/dashboard";

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
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { IconTrendingUp } from "@tabler/icons-react";

function KPI({ title, value, unit }: any) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {value} {unit}
        </div>
      </CardContent>
    </Card>
  );
}

function ChartAreaGradient({
  title,
  subtitle,
  config,
  data,
  seriesKey,
  yKey,
  yTitle,
  className,
}: {
  config: ChartConfig;
  data: any[];
  seriesKey: string;
  title: string;
  subtitle: string;
  className?: string;
  yKey?: string;
  yTitle?: string;
}) {
  const gradientId = `fill-${seriesKey}`;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config}>
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <CartesianGrid strokeDasharray={"3 3"} />

            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) =>
                typeof value === "number"
                  ? new Date(value).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : String(value)
              }
            />

            <YAxis
              label={{
                value: yTitle,
                position: "insideTopLeft",
                offset: 5,
                style: { textAnchor: "middle", fontSize: 12 },
              }}
              dataKey={yKey}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />

            <ChartTooltip
              cursor={false}
              labelFormatter={(value) =>
                typeof value === "number"
                  ? new Date(value).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : String(value)
              }
              content={<ChartTooltipContent />}
            />
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={`var(--color-${seriesKey})`}
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${seriesKey})`}
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <Area
              dataKey={seriesKey}
              type="natural"
              fill={`url(#${gradientId})`}
              fillOpacity={0.4}
              stroke={`var(--color-${seriesKey})`}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { kpis, charts } = dashboardData;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-5">
        <KPI title="Velocidade" value={kpis.speed} unit="km/h" />
        <KPI title="Velocidade Máx" value={kpis.maxSpeed} unit="km/h" />
        <KPI title="Bateria" value={kpis.battery} unit="%" />
        <KPI title="Temperatura" value={kpis.temperature} unit="°C" />
        <KPI title="Sinal" value={kpis.signal} unit="dBm" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <ChartAreaGradient
          title="Velocidade"
          subtitle="Variação da velocidade ao longo do tempo"
          config={speedChartConfig}
          data={charts.telemetry}
          seriesKey="speed"
          className=" md:col-span-3"
          yTitle="km/h"
        />

        <ChartAreaGradient
          title="Temperatura"
          subtitle="Variação da temperatura ao longo do tempo"
          config={temperatureChartConfig}
          data={charts.telemetry}
          seriesKey="temperature"
          className="md:col-span-3"
          yTitle="°C"
        />

        <ChartAreaGradient
          title="Bateria"
          subtitle="Variação do nível da bateria ao longo do tempo"
          config={batteryChartConfig}
          data={charts.telemetry}
          seriesKey="battery"
          className="md:col-span-6"
          yTitle="V"
        />
      </div>
    </div>
  );
}
