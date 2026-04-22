import type { ChartConfig } from "@/components/ui/chart";

export type TelemetryPoint = {
  timestamp: number;
  speed: number;
  temperature: number;
  battery: number;
};

const BASE_TIMESTAMP = Date.UTC(2026, 3, 22, 12, 0, 0);
const MINUTE = 60_000;

export const telemetry: TelemetryPoint[] = [
  { timestamp: BASE_TIMESTAMP + 0 * 5 * MINUTE, speed: 18.2, temperature: 56.1, battery: 100 },
  { timestamp: BASE_TIMESTAMP + 1 * 5 * MINUTE, speed: 19.7, temperature: 56.8, battery: 99 },
  { timestamp: BASE_TIMESTAMP + 2 * 5 * MINUTE, speed: 27.4, temperature: 57.6, battery: 98 },
  { timestamp: BASE_TIMESTAMP + 3 * 5 * MINUTE, speed: 32.5, temperature: 58.4, battery: 97 },
  { timestamp: BASE_TIMESTAMP + 4 * 5 * MINUTE, speed: 35.9, temperature: 59.2, battery: 96 },
  { timestamp: BASE_TIMESTAMP + 5 * 5 * MINUTE, speed: 41.1, temperature: 60.3, battery: 90 },
  { timestamp: BASE_TIMESTAMP + 6 * 5 * MINUTE, speed: 45.2, temperature: 61.7, battery: 88 },
  { timestamp: BASE_TIMESTAMP + 7 * 5 * MINUTE, speed: 48.6, temperature: 63.9, battery: 87 },
  { timestamp: BASE_TIMESTAMP + 8 * 5 * MINUTE, speed: 37.0, temperature: 66.2, battery: 86 },
  { timestamp: BASE_TIMESTAMP + 9 * 5 * MINUTE, speed: 46.1, temperature: 68.0, battery: 82 },
  { timestamp: BASE_TIMESTAMP + 10 * 5 * MINUTE, speed: 38.3, temperature: 67.4, battery: 81 },
  { timestamp: BASE_TIMESTAMP + 11 * 5 * MINUTE, speed: 24.9, temperature: 66.6, battery: 79 },
];

export const speedChartConfig = {
  speed: {
    label: "Velocidade",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export const temperatureChartConfig = {
  temperature: {
    label: "Temperatura",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export const batteryChartConfig = {
  battery: {
    label: "Bateria",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

const last = telemetry[telemetry.length - 1];
const maxSpeed = telemetry.reduce((acc, p) => Math.max(acc, p.speed), 0);

export const dashboardData = {
  kpis: {
    speed: last.speed,
    maxSpeed,
    battery: last.battery,
    temperature: last.temperature,
    signal: -72,
  },
  charts: {
    telemetry,
  },
  alerts: [
    { id: 1, message: "Temperatura alta detectada", level: "warning" },
    { id: 2, message: "Sinal LoRa instável", level: "info" },
  ],
};
