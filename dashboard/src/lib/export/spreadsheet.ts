// =============================================================================
//  Exportacao client-side do log da sessao para planilha (.xlsx) e .csv.
//  100% no navegador via SheetJS — sem nenhuma chamada de rede.
//
//  Contrato v2.1: a planilha carrega tambem a atitude do casco (MPU6050), o
//  ambiente interno (DHT22), o nucleo virtual do gemeo termico e as flags de
//  falha de sensor. As flags sao decisivas na analise pos-prova: sem elas nao
//  ha como distinguir "o motor esfriou" de "o sensor caiu".
// =============================================================================

import * as XLSX from "xlsx";
import type { ProcessedSample } from "@/types/telemetry";
import { toKnots } from "@/lib/telemetry/contract";
import { computePower } from "@/lib/math/hydrodynamics";

/** Linha tabular achatada de uma amostra de telemetria. */
interface SheetRow {
  timestamp: string;
  seq: number;
  lat: number;
  lng: number;
  lat_filtrada: number;
  lng_filtrada: number;
  fix: boolean;
  sats: number;
  hdop: number;
  speed_kmh: number;
  knots: number;
  cog: number;
  roll_deg: number;
  pitch_deg: number;
  yaw_deg: number;
  accel_x_g: number;
  accel_y_g: number;
  accel_z_g: number;
  current_a: number;
  voltage_v: number;
  power_w: number;
  sec_w_por_no: number | "";
  temp_estator_c: number;
  temp_nucleo_virtual_c: number | "";
  temp_ambiente_c: number;
  umidade_pct: number;
  rudder_deg: number;
  algae_alert: boolean;
  overheat_alert: boolean;
  battery_low: boolean;
  falha_gps: boolean;
  falha_imu: boolean;
  falha_temp_motor: boolean;
  falha_ambiente: boolean;
}

const HEADERS: (keyof SheetRow)[] = [
  "timestamp",
  "seq",
  "lat",
  "lng",
  "lat_filtrada",
  "lng_filtrada",
  "fix",
  "sats",
  "hdop",
  "speed_kmh",
  "knots",
  "cog",
  "roll_deg",
  "pitch_deg",
  "yaw_deg",
  "accel_x_g",
  "accel_y_g",
  "accel_z_g",
  "current_a",
  "voltage_v",
  "power_w",
  "sec_w_por_no",
  "temp_estator_c",
  "temp_nucleo_virtual_c",
  "temp_ambiente_c",
  "umidade_pct",
  "rudder_deg",
  "algae_alert",
  "overheat_alert",
  "battery_low",
  "falha_gps",
  "falha_imu",
  "falha_temp_motor",
  "falha_ambiente",
];

const round = (n: number, d = 3) => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Converte o log da sessao em linhas tabulares prontas para exportacao. */
export function toRows(
  log: readonly ProcessedSample[],
  virtualTemps: readonly number[] = [],
): SheetRow[] {
  return log.map((s, i) => {
    const knots = toKnots(s.gps.speed_kmh);
    const { power_w, sec_w_per_knot } = computePower(
      s.sensors.voltage_v,
      s.sensors.current_a,
      knots,
    );
    const virtual = virtualTemps[i];

    return {
      timestamp: new Date(s.t).toISOString(),
      seq: s.seq,
      lat: round(s.gps.lat, 6),
      lng: round(s.gps.lng, 6),
      lat_filtrada: round(s.lat_f, 6),
      lng_filtrada: round(s.lng_f, 6),
      fix: s.gps.fix,
      sats: s.gps.sats,
      hdop: round(s.gps.hdop, 1),
      speed_kmh: round(s.gps.speed_kmh, 2),
      knots: round(knots, 2),
      cog: round(s.gps.cog, 1),
      roll_deg: round(s.imu.roll, 2),
      pitch_deg: round(s.imu.pitch, 2),
      yaw_deg: round(s.imu.yaw, 2),
      accel_x_g: round(s.imu.accel_x, 3),
      accel_y_g: round(s.imu.accel_y, 3),
      accel_z_g: round(s.imu.accel_z, 3),
      current_a: round(s.sensors.current_a, 2),
      voltage_v: round(s.sensors.voltage_v, 2),
      power_w: round(power_w, 1),
      // Celula vazia (nao zero) quando o barco esta parado: um zero aqui
      // distorceria qualquer media feita depois na planilha.
      sec_w_por_no: sec_w_per_knot == null ? "" : round(sec_w_per_knot, 1),
      temp_estator_c: round(s.sensors.temp_c, 1),
      temp_nucleo_virtual_c:
        virtual == null || !Number.isFinite(virtual) ? "" : round(virtual, 1),
      temp_ambiente_c: round(s.ambient.temp_c, 1),
      umidade_pct: round(s.ambient.humidity, 1),
      rudder_deg: round(s.sensors.rudder_deg, 1),
      algae_alert: s.status.algae_alert,
      overheat_alert: s.status.overheat_alert,
      battery_low: s.status.battery_low,
      falha_gps: s.faults.gps,
      falha_imu: s.faults.imu,
      falha_temp_motor: s.faults.motor_temp,
      falha_ambiente: s.faults.ambient,
    };
  });
}

function buildWorksheet(
  log: readonly ProcessedSample[],
  virtualTemps: readonly number[],
): XLSX.WorkSheet {
  const rows = toRows(log, virtualTemps);
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS as string[] });
  ws["!cols"] = HEADERS.map((h) => ({
    wch: h === "timestamp" ? 24 : Math.max(9, Math.min(22, h.length + 2)),
  }));
  // Congela o cabecalho: com milhares de linhas, rolar sem isso e inviavel.
  ws["!freeze"] = { xSplit: "0", ySplit: "1" };
  return ws;
}

function workbookOf(ws: XLSX.WorkSheet): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Telemetria");
  return wb;
}

/** Baixa o log da sessao como planilha .xlsx. */
export function exportXlsx(
  log: readonly ProcessedSample[],
  filename = "athenas-sessao.xlsx",
  virtualTemps: readonly number[] = [],
): void {
  const wb = workbookOf(buildWorksheet(log, virtualTemps));
  XLSX.writeFile(wb, filename, { bookType: "xlsx" });
}

/** Baixa o log da sessao como .csv. */
export function exportCsv(
  log: readonly ProcessedSample[],
  filename = "athenas-sessao.csv",
  virtualTemps: readonly number[] = [],
): void {
  const wb = workbookOf(buildWorksheet(log, virtualTemps));
  XLSX.writeFile(wb, filename, { bookType: "csv" });
}
