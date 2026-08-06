// =============================================================================
// Constantes, limiares e modelos puros da Diretriz Athenas v2.1.
// Compartilhado entre o Web Worker, o store Zustand e as abas da UI.
// Nenhuma funcao aqui tem efeito colateral ou depende do DOM (roda no Worker).
// =============================================================================

import type {
  TelemetryFrame,
  TelemetrySample,
  VesselHealth,
} from "@/types/telemetry";

// --- Amostragem ---
export const SAMPLE_INTERVAL_MS = 200; // 5 Hz, cravado com o GPS
export const SAMPLE_RATE_HZ = 1000 / SAMPLE_INTERVAL_MS;

// --- Conversoes ---
export const KMH_PER_KNOT = 1.852;
export const KNOTS_TO_MS = 0.514444;
/** Velocidade em nos (unidade naval) a partir de km/h. */
export function toKnots(speed_kmh: number): number {
  return speed_kmh / KMH_PER_KNOT;
}
/** Graus -> radianos (fronteira do WebGL). */
export function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
/** Radianos -> graus. */
export function toDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

// --- Limiares (Diretriz) ---
export const RUDDER_MAX_DEG = 45;
export const OVERHEAT_C = 70; // Controle de danos termicos
export const MELTDOWN_C = 90; // Fusao do estator (gatilho de emergencia)
export const TATICA_RUDDER_DEG = 30; // Sereia Tatica: leme inclinado > 30°
export const TATICA_CURRENT_A = 18; // Sereia Tatica: corrente > 18A

// Algoritmo de alerta de algas
export const ALGAE_CURRENT_A = 25; // corrente acima de 25A...
export const ALGAE_DURATION_MS = 1500; // ...por mais de 1.5s...
export const ALGAE_SPEED_KMH = 2; // ...com velocidade abaixo de 2 km/h.

// Curva da bateria de chumbo-acido 12V
export const BATTERY_FULL_V = 12.7;
export const BATTERY_EMPTY_V = 10.5;
export const BATTERY_GREEN_V = 12.3; // verde
export const BATTERY_YELLOW_HI_V = 11.5; // amarelo entre 11.5...
export const BATTERY_YELLOW_LO_V = 10.8; // ...e 10.8
export const BATTERY_RED_V = 10.5; // vermelho piscante abaixo de 10.5

export const RAIO_TERRA_M = 6371000; // R para Haversine / geodesia

/** Estimativa de porcentagem de carga pela tensao (curva chumbo-acido). */
export function batteryPercent(voltage_v: number): number {
  const pct =
    ((voltage_v - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export type BatteryLevel = "green" | "yellow" | "red";
/** Faixa de cor da bateria por tensao (gatilhos CSS da Diretriz). */
export function batteryLevel(voltage_v: number): BatteryLevel {
  if (voltage_v >= BATTERY_GREEN_V) return "green";
  if (voltage_v < BATTERY_RED_V) return "red";
  return "yellow";
}

/**
 * Distancia linear (em metros) entre dois pontos via formula de Haversine.
 * Usada para medir a distancia entre a estacao de controle e o barco.
 */
export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
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
 * Saude da embarcacao (estado da Sereia Athenas):
 *  - alerta  (vermelho): sobrecarga / superaquecimento / bateria critica
 *  - tatica  (laranja):  alto arrasto (leme > 30° ou corrente > 18A)
 *  - serena  (verde):    sistema nominal estavel
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

/** Quadro neutro usado antes do primeiro dado do hardware chegar. */
export function emptyFrame(t = 0): TelemetrySample {
  return {
    t,
    gps: { lat: 0, lng: 0, speed_kmh: 0, cog: 0, fix: false, sats: 0, hdop: 99 },
    imu: { roll: 0, pitch: 0, yaw: 0, accel_x: 0, accel_y: 0, accel_z: 1 },
    sensors: { current_a: 0, voltage_v: 0, temp_c: 0, rudder_deg: 0 },
    ambient: { temp_c: 0, humidity: 0 },
    status: { algae_alert: false, overheat_alert: false, battery_low: false },
    faults: { gps: true, imu: true, motor_temp: true, ambient: true },
    link: null,
    seq: 0,
    uptime_ms: 0,
  };
}

// ---------------------------------------------------------------------------
// Parser defensivo do quadro do WebSocket.
//
// Escrito com early returns e coercao estrita: um ESP32 com sensor solto pode
// enviar `null`, `NaN` (que vira `null` no JSON) ou campos ausentes. Nada disso
// pode virar `NaN` dentro de um grafico ou de uma matriz de rotacao 3D.
// ---------------------------------------------------------------------------

/** Coercao numerica segura: qualquer coisa nao-finita vira o fallback. */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Coercao booleana segura. */
function bool(v: unknown): boolean {
  return v === true;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Converte o payload cru do WebSocket em um TelemetryFrame validado, ou
 * `null` se o quadro nao tiver a forma minima do contrato (nesse caso o
 * chamador simplesmente descarta o pacote).
 */
export function parseFrame(raw: unknown): TelemetryFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;

  // Forma minima: os tres blocos originais do contrato precisam existir.
  if (!f.gps || !f.sensors || !f.status) return null;

  const g = obj(f.gps);
  const i = obj(f.imu);
  const s = obj(f.sensors);
  const a = obj(f.ambient);
  const st = obj(f.status);
  const fl = obj(f.faults);

  // O bloco `link` so existe quando ha um MESTRE LoRa no caminho. Ligado
  // direto no barco por WiFi, ele nao vem — e `null` e a resposta honesta,
  // nao zeros que pareceriam um enlace pessimo.
  const link =
    f.link && typeof f.link === "object"
      ? (() => {
          const l = obj(f.link);
          return {
            rssi: num(l.rssi, -999),
            snr: num(l.snr),
            lost: num(l.lost),
            corrupt: num(l.corrupt),
          };
        })()
      : null;

  return {
    gps: {
      lat: num(g.lat),
      lng: num(g.lng),
      speed_kmh: Math.max(0, num(g.speed_kmh)),
      cog: ((num(g.cog) % 360) + 360) % 360,
      fix: bool(g.fix),
      sats: num(g.sats),
      hdop: num(g.hdop, 99),
    },
    imu: {
      roll: num(i.roll),
      pitch: num(i.pitch),
      yaw: num(i.yaw),
      accel_x: num(i.accel_x),
      accel_y: num(i.accel_y),
      accel_z: num(i.accel_z, 1),
    },
    sensors: {
      current_a: num(s.current_a),
      voltage_v: num(s.voltage_v),
      temp_c: num(s.temp_c),
      rudder_deg: clamp(num(s.rudder_deg), -RUDDER_MAX_DEG, RUDDER_MAX_DEG),
    },
    ambient: {
      temp_c: num(a.temp_c),
      humidity: clamp(num(a.humidity), 0, 100),
    },
    status: {
      algae_alert: bool(st.algae_alert),
      overheat_alert: bool(st.overheat_alert),
      battery_low: bool(st.battery_low),
    },
    faults: {
      // Se o firmware for antigo e nao enviar `faults`, assumimos que o bloco
      // correspondente nao existe -> marca falha em vez de fingir dado bom.
      gps: f.faults === undefined ? !bool(g.fix) : bool(fl.gps),
      imu: f.faults === undefined ? f.imu === undefined : bool(fl.imu),
      motor_temp: f.faults === undefined ? false : bool(fl.motor_temp),
      ambient: f.faults === undefined ? f.ambient === undefined : bool(fl.ambient),
    },
    link,
    seq: num(f.seq),
    uptime_ms: num(f.uptime_ms),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
