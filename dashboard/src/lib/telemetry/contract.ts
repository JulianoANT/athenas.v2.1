// Constantes, limiares e modelos matemáticos da Diretriz Athenas v2.0.
// Funções puras reutilizadas pelo simulador, pelo provider e pelas abas.

import type {
  TelemetryFrame,
  TelemetrySample,
  VesselHealth,
} from "@/types/telemetry";

// --- Amostragem ---
export const SAMPLE_INTERVAL_MS = 200; // 5 Hz, cravado com o GPS
export const SAMPLE_RATE_HZ = 1000 / SAMPLE_INTERVAL_MS;

// --- Conversões ---
export const KMH_PER_KNOT = 1.852;
/** Velocidade em nós (unidade naval) a partir de km/h. */
export function toKnots(speed_kmh: number): number {
  return speed_kmh / KMH_PER_KNOT;
}

// --- Limiares (Diretriz) ---
export const RUDDER_MAX_DEG = 45;
export const OVERHEAT_C = 70; // Controle de danos térmicos
export const TATICA_RUDDER_DEG = 30; // Sereia Tática: leme inclinado > 30°
export const TATICA_CURRENT_A = 18; // Sereia Tática: corrente > 18A

// Algoritmo de alerta de algas
export const ALGAE_CURRENT_A = 25; // corrente acima de 25A...
export const ALGAE_DURATION_MS = 1500; // ...por mais de 1.5s...
export const ALGAE_SPEED_KMH = 2; // ...com velocidade abaixo de 2 km/h.

// Curva da bateria de chumbo-ácido 12V
export const BATTERY_FULL_V = 12.7;
export const BATTERY_EMPTY_V = 10.5;
export const BATTERY_GREEN_V = 12.3; // verde
export const BATTERY_YELLOW_HI_V = 11.5; // amarelo entre 11.5...
export const BATTERY_YELLOW_LO_V = 10.8; // ...e 10.8
export const BATTERY_RED_V = 10.5; // vermelho piscante abaixo de 10.5

export const RAIO_TERRA_M = 6371000; // R para Haversine

/** Estimativa de porcentagem de carga pela tensão (curva chumbo-ácido). */
export function batteryPercent(voltage_v: number): number {
  const pct =
    ((voltage_v - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export type BatteryLevel = "green" | "yellow" | "red";
/** Faixa de cor da bateria por tensão (gatilhos CSS da Diretriz). */
export function batteryLevel(voltage_v: number): BatteryLevel {
  if (voltage_v >= BATTERY_GREEN_V) return "green";
  if (voltage_v < BATTERY_RED_V) return "red";
  return "yellow";
}

/**
 * Distância linear (em metros) entre dois pontos via fórmula de Haversine.
 * Usada para medir a distância entre a estação de controle e o barco.
 */
export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.sqrt(a));
}

/**
 * Saúde da embarcação (estado da Sereia Athenas):
 *  - alerta  (vermelho): sobrecarga / superaquecimento / bateria crítica
 *  - tatica  (laranja):  alto arrasto (leme > 30° ou corrente > 18A)
 *  - serena  (verde):    sistema nominal estável
 */
export function vesselHealth(frame: TelemetryFrame): VesselHealth {
  const { sensors, status } = frame;
  if (
    status.overheat_alert ||
    status.battery_low ||
    sensors.temp_c >= OVERHEAT_C ||
    sensors.voltage_v < BATTERY_RED_V
  ) {
    return "alerta";
  }
  if (
    Math.abs(sensors.rudder_deg) > TATICA_RUDDER_DEG ||
    sensors.current_a > TATICA_CURRENT_A ||
    status.algae_alert
  ) {
    return "tatica";
  }
  return "serena";
}

/**
 * Detector de bloqueio por algas (com estado): mantém o instante em que a
 * corrente passou de ALGAE_CURRENT_A. Compartilhado entre o simulador e a UI
 * para manter um único modelo da Diretriz.
 */
export class AlgaeDetector {
  private highCurrentSince: number | null = null;

  update(current_a: number, speed_kmh: number, now: number): boolean {
    if (current_a > ALGAE_CURRENT_A) {
      if (this.highCurrentSince == null) this.highCurrentSince = now;
      const sustained = now - this.highCurrentSince >= ALGAE_DURATION_MS;
      return sustained && speed_kmh < ALGAE_SPEED_KMH;
    }
    this.highCurrentSince = null;
    return false;
  }

  reset() {
    this.highCurrentSince = null;
  }
}

/** Quadro neutro usado antes do primeiro dado chegar. */
export function emptyFrame(t = 0): TelemetrySample {
  return {
    t,
    gps: { lat: 0, lng: 0, speed_kmh: 0, cog: 0, fix: false },
    sensors: { current_a: 0, voltage_v: 0, temp_c: 0, rudder_deg: 0 },
    status: { algae_alert: false, overheat_alert: false, battery_low: false },
  };
}

/** Validação leve de um quadro vindo do WebSocket. */
export function isTelemetryFrame(v: unknown): v is TelemetryFrame {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.gps === "object" &&
    typeof f.sensors === "object" &&
    typeof f.status === "object"
  );
}
