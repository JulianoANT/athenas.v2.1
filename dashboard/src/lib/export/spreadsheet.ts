// Exportação client-side do log da sessão para planilha (.xlsx) e .csv.
// 100% no navegador via SheetJS — sem nenhuma chamada de rede.

import * as XLSX from "xlsx";
import type { TelemetrySample } from "@/types/telemetry";
import { toKnots } from "@/lib/telemetry/contract";

/** Linha tabular achatada de uma amostra de telemetria. */
interface SheetRow {
  timestamp: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  knots: number;
  cog: number;
  current_a: number;
  voltage_v: number;
  temp_c: number;
  rudder_deg: number;
  algae_alert: boolean;
  overheat_alert: boolean;
  battery_low: boolean;
}

const HEADERS: (keyof SheetRow)[] = [
  "timestamp",
  "lat",
  "lng",
  "speed_kmh",
  "knots",
  "cog",
  "current_a",
  "voltage_v",
  "temp_c",
  "rudder_deg",
  "algae_alert",
  "overheat_alert",
  "battery_low",
];

const round = (n: number, d = 3) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Converte o log da sessão em linhas tabulares prontas para exportação. */
export function toRows(log: TelemetrySample[]): SheetRow[] {
  return log.map((s) => ({
    timestamp: new Date(s.t).toISOString(),
    lat: round(s.gps.lat, 6),
    lng: round(s.gps.lng, 6),
    speed_kmh: round(s.gps.speed_kmh, 2),
    knots: round(toKnots(s.gps.speed_kmh), 2),
    cog: round(s.gps.cog, 1),
    current_a: round(s.sensors.current_a, 2),
    voltage_v: round(s.sensors.voltage_v, 2),
    temp_c: round(s.sensors.temp_c, 1),
    rudder_deg: round(s.sensors.rudder_deg, 1),
    algae_alert: s.status.algae_alert,
    overheat_alert: s.status.overheat_alert,
    battery_low: s.status.battery_low,
  }));
}

function buildWorksheet(log: TelemetrySample[]): XLSX.WorkSheet {
  const rows = toRows(log);
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS as string[] });
  // Larguras de coluna agradáveis.
  ws["!cols"] = [
    { wch: 24 }, // timestamp
    { wch: 12 }, // lat
    { wch: 12 }, // lng
    { wch: 10 }, // speed_kmh
    { wch: 8 }, // knots
    { wch: 7 }, // cog
    { wch: 10 }, // current_a
    { wch: 10 }, // voltage_v
    { wch: 8 }, // temp_c
    { wch: 10 }, // rudder_deg
    { wch: 11 }, // algae_alert
    { wch: 14 }, // overheat_alert
    { wch: 12 }, // battery_low
  ];
  return ws;
}

/** Baixa o log da sessão como planilha .xlsx. */
export function exportXlsx(
  log: TelemetrySample[],
  filename = "athenas-sessao.xlsx",
): void {
  const ws = buildWorksheet(log);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Telemetria");
  // writeFile dispara o download client-side (sem rede).
  XLSX.writeFile(wb, filename, { bookType: "xlsx" });
}

/** Baixa o log da sessão como .csv. */
export function exportCsv(
  log: TelemetrySample[],
  filename = "athenas-sessao.csv",
): void {
  const ws = buildWorksheet(log);
  XLSX.writeFile(wb_of(ws), filename, { bookType: "csv" });
}

function wb_of(ws: XLSX.WorkSheet): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Telemetria");
  return wb;
}
