// Cálculo de métricas de desempenho da sessão Athenas (funções puras).
// Base: sessionLog decimado a ~1 Hz (TelemetrySample[]). Toda matemática usa
// os modelos da Diretriz (haversine para distância, toKnots para velocidade).

import type { TelemetrySample } from "@/types/telemetry";
import { haversine, toKnots } from "@/lib/telemetry/contract";

/** Resumo de métricas técnicas calculadas a partir do log da sessão. */
export interface SessionMetrics {
  /** Quantidade de amostras consideradas. */
  samples: number;
  /** Velocidade máxima em nós (max de toKnots(speed_kmh)). */
  maxKnots: number;
  /** Velocidade máxima em km/h (referência). */
  maxKmh: number;
  /** Corrente de pico do ESC em Ampéres (max current_a). */
  peakCurrent: number;
  /** Corrente média em Ampéres. */
  avgCurrent: number;
  /** Distância percorrida em metros (soma de haversine entre fixes). */
  distance_m: number;
  /** Energia consumida em Watt-hora (integral de V*I no tempo). */
  energy_wh: number;
  /** Consumo Específico de Energia em Wh/m (energia / distância). */
  sec_wh_per_m: number;
  /** Temperatura máxima do estator em °C. */
  tempMax: number;
  /** Duração da sessão em segundos (primeira -> última amostra). */
  duration_s: number;
}

const EMPTY: SessionMetrics = {
  samples: 0,
  maxKnots: 0,
  maxKmh: 0,
  peakCurrent: 0,
  avgCurrent: 0,
  distance_m: 0,
  energy_wh: 0,
  sec_wh_per_m: 0,
  tempMax: 0,
  duration_s: 0,
};

/**
 * Computa as métricas agregadas da sessão.
 *
 * - distância: soma das distâncias de Haversine entre posições consecutivas
 *   que ambas tenham fix de GPS.
 * - energia (Wh): integração trapezoidal de potência (V*I) ao longo do tempo,
 *   com dt em horas (dt_ms / 3.6e6). Usa o passo real entre amostras.
 * - SEC (Wh/m): energia dividida pela distância percorrida.
 */
export function computeSessionMetrics(log: TelemetrySample[]): SessionMetrics {
  if (log.length === 0) return { ...EMPTY };

  let maxKmh = 0;
  let peakCurrent = 0;
  let sumCurrent = 0;
  let distance_m = 0;
  let energy_wh = 0;
  let tempMax = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < log.length; i++) {
    const s = log[i];
    maxKmh = Math.max(maxKmh, s.gps.speed_kmh);
    peakCurrent = Math.max(peakCurrent, s.sensors.current_a);
    sumCurrent += s.sensors.current_a;
    tempMax = Math.max(tempMax, s.sensors.temp_c);

    if (i > 0) {
      const prev = log[i - 1];

      // Distância: só entre dois pontos com fix válido.
      if (prev.gps.fix && s.gps.fix) {
        distance_m += haversine(
          prev.gps.lat,
          prev.gps.lng,
          s.gps.lat,
          s.gps.lng,
        );
      }

      // Energia: potência média no intervalo * dt (trapézio), dt em horas.
      const dtHours = Math.max(0, s.t - prev.t) / 3_600_000;
      const pPrev = prev.sensors.voltage_v * prev.sensors.current_a;
      const pCur = s.sensors.voltage_v * s.sensors.current_a;
      energy_wh += ((pPrev + pCur) / 2) * dtHours;
    }
  }

  const samples = log.length;
  const duration_s = Math.max(0, log[samples - 1].t - log[0].t) / 1000;
  const avgCurrent = sumCurrent / samples;
  const sec_wh_per_m = distance_m > 0 ? energy_wh / distance_m : 0;

  return {
    samples,
    maxKnots: toKnots(maxKmh),
    maxKmh,
    peakCurrent,
    avgCurrent,
    distance_m,
    energy_wh,
    sec_wh_per_m,
    tempMax: Number.isFinite(tempMax) ? tempMax : 0,
    duration_s,
  };
}

/** Formata segundos como HH:MM:SS. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
