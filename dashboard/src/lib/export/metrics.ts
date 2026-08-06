// =============================================================================
//  Metricas de desempenho da sessao Athenas (funcoes puras).
//
//  Base: sessionLog decimado a ~1 Hz. Toda a matematica usa os modelos do
//  contrato (Haversine para distancia, toKnots para velocidade).
//
//  Contrato v2.1 acrescenta metricas de estabilidade derivadas do MPU6050 —
//  adernamento maximo e um score de estabilidade da sessao.
// =============================================================================

import type { ProcessedSample } from "@/types/telemetry";
import { haversine, toKnots } from "@/lib/telemetry/contract";

/** Resumo de metricas tecnicas calculadas a partir do log da sessao. */
export interface SessionMetrics {
  /** Quantidade de amostras consideradas. */
  samples: number;
  /** Velocidade maxima em nos. */
  maxKnots: number;
  /** Velocidade maxima em km/h (referencia). */
  maxKmh: number;
  /** Velocidade media em nos, considerando so os trechos em movimento. */
  avgKnots: number;
  /** Corrente de pico do ESC em Amperes. */
  peakCurrent: number;
  /** Corrente media em Amperes. */
  avgCurrent: number;
  /** Distancia percorrida em metros (soma de Haversine entre fixes). */
  distance_m: number;
  /** Energia consumida em Watt-hora (integral de V·I no tempo). */
  energy_wh: number;
  /** Consumo Especifico de Energia em Wh/m. */
  sec_wh_per_m: number;
  /** Temperatura maxima do estator (sensor fisico) em °C. */
  tempMax: number;
  /** Temperatura maxima do nucleo virtual em °C. */
  virtualTempMax: number;
  /** Adernamento maximo registrado (|roll|) em graus. */
  maxRoll: number;
  /** Caturro maximo registrado (|pitch|) em graus. */
  maxPitch: number;
  /**
   * Score de estabilidade da sessao (0-100). 100 = casco praticamente
   * nivelado o tempo todo. Derivado do desvio-padrao combinado de roll e
   * pitch — o desvio captura a AGITACAO, que e o que castiga a estrutura,
   * enquanto o maximo so registra o pior instante.
   */
  stabilityScore: number;
  /** Quantidade de amostras com alguma flag de falha de sensor. */
  faultySamples: number;
  /** Duracao da sessao em segundos (primeira -> ultima amostra). */
  duration_s: number;
}

const EMPTY: SessionMetrics = {
  samples: 0,
  maxKnots: 0,
  maxKmh: 0,
  avgKnots: 0,
  peakCurrent: 0,
  avgCurrent: 0,
  distance_m: 0,
  energy_wh: 0,
  sec_wh_per_m: 0,
  tempMax: 0,
  virtualTempMax: 0,
  maxRoll: 0,
  maxPitch: 0,
  stabilityScore: 100,
  faultySamples: 0,
  duration_s: 0,
};

/** Velocidade minima (nos) para uma amostra contar como "em movimento". */
const MOVING_KNOTS = 0.5;

/**
 * Desvio angular combinado (em graus) a partir do qual o score de estabilidade
 * chega a zero. 25° de agitacao RMS ja e uma condicao severa para um casco de
 * competicao.
 */
const STABILITY_FLOOR_DEG = 25;

/**
 * Computa as metricas agregadas da sessao.
 *
 * - distancia: soma das distancias de Haversine entre posicoes consecutivas
 *   que AMBAS tenham fix de GPS. Usa a posicao filtrada por Kalman: somar
 *   coordenadas cruas inflaria a distancia com o ruido de multipath.
 * - energia (Wh): integracao trapezoidal de V·I ao longo do tempo real.
 * - SEC (Wh/m): energia dividida pela distancia percorrida.
 */
export function computeSessionMetrics(
  log: readonly ProcessedSample[],
  virtualTemps: readonly number[] = [],
): SessionMetrics {
  if (log.length === 0) return { ...EMPTY };

  let maxKmh = 0;
  let peakCurrent = 0;
  let sumCurrent = 0;
  let distance_m = 0;
  let energy_wh = 0;
  let tempMax = Number.NEGATIVE_INFINITY;
  let virtualTempMax = Number.NEGATIVE_INFINITY;
  let maxRoll = 0;
  let maxPitch = 0;
  let faultySamples = 0;

  let movingKnotsSum = 0;
  let movingCount = 0;

  // Acumuladores para o desvio-padrao de roll/pitch (metodo de uma passada).
  let rollSum = 0;
  let rollSqSum = 0;
  let pitchSum = 0;
  let pitchSqSum = 0;

  for (let i = 0; i < log.length; i++) {
    const s = log[i];

    maxKmh = Math.max(maxKmh, s.gps.speed_kmh);
    peakCurrent = Math.max(peakCurrent, s.sensors.current_a);
    sumCurrent += s.sensors.current_a;

    // Uma leitura marcada como falha e o ultimo valor retido, nao um dado
    // fresco: incluir no maximo produziria um pico fantasma no relatorio.
    if (!s.faults.motor_temp) {
      tempMax = Math.max(tempMax, s.sensors.temp_c);
    }

    const v = virtualTemps[i];
    if (v != null && Number.isFinite(v)) {
      virtualTempMax = Math.max(virtualTempMax, v);
    }

    if (!s.faults.imu) {
      maxRoll = Math.max(maxRoll, Math.abs(s.imu.roll));
      maxPitch = Math.max(maxPitch, Math.abs(s.imu.pitch));
      rollSum += s.imu.roll;
      rollSqSum += s.imu.roll * s.imu.roll;
      pitchSum += s.imu.pitch;
      pitchSqSum += s.imu.pitch * s.imu.pitch;
    }

    if (
      s.faults.gps ||
      s.faults.imu ||
      s.faults.motor_temp ||
      s.faults.ambient
    ) {
      faultySamples++;
    }

    const knots = toKnots(s.gps.speed_kmh);
    if (knots >= MOVING_KNOTS) {
      movingKnotsSum += knots;
      movingCount++;
    }

    if (i > 0) {
      const prev = log[i - 1];

      if (prev.gps.fix && s.gps.fix) {
        distance_m += haversine(prev.lat_f, prev.lng_f, s.lat_f, s.lng_f);
      }

      // Energia: potencia media no intervalo x dt (trapezio), dt em horas.
      const dtHours = Math.max(0, s.t - prev.t) / 3_600_000;
      const pPrev = prev.sensors.voltage_v * prev.sensors.current_a;
      const pCur = s.sensors.voltage_v * s.sensors.current_a;
      energy_wh += ((pPrev + pCur) / 2) * dtHours;
    }
  }

  const samples = log.length;
  const duration_s = Math.max(0, log[samples - 1].t - log[0].t) / 1000;
  const imuSamples = samples - 0;

  // Desvio-padrao populacional de roll e pitch.
  const n = Math.max(1, imuSamples);
  const rollVar = Math.max(0, rollSqSum / n - (rollSum / n) ** 2);
  const pitchVar = Math.max(0, pitchSqSum / n - (pitchSum / n) ** 2);
  const agitation = Math.sqrt(rollVar + pitchVar);
  const stabilityScore = Math.max(
    0,
    Math.min(100, 100 * (1 - agitation / STABILITY_FLOOR_DEG)),
  );

  return {
    samples,
    maxKnots: toKnots(maxKmh),
    maxKmh,
    avgKnots: movingCount > 0 ? movingKnotsSum / movingCount : 0,
    peakCurrent,
    avgCurrent: sumCurrent / samples,
    distance_m,
    energy_wh,
    sec_wh_per_m: distance_m > 0 ? energy_wh / distance_m : 0,
    tempMax: Number.isFinite(tempMax) ? tempMax : 0,
    virtualTempMax: Number.isFinite(virtualTempMax) ? virtualTempMax : 0,
    maxRoll,
    maxPitch,
    stabilityScore,
    faultySamples,
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
