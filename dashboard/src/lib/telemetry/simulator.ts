// Simulador de telemetria 5 Hz. Reproduz uma sessão de prova no Parque
// Expoville com sinais fisicamente correlacionados: curvas de leme geram
// arrasto hidrodinâmico e picos de corrente no motor Imobras, a temperatura
// do estator sobe com a carga e a bateria de chumbo-ácido descarrega ao longo
// do tempo. Serve para desenvolver/demonstrar a UI sem o ESP32 a bordo.

import type { TelemetryFrame } from "@/types/telemetry";
import {
  AlgaeDetector,
  BATTERY_FULL_V,
  OVERHEAT_C,
  RUDDER_MAX_DEG,
  BATTERY_YELLOW_LO_V,
} from "./contract";

// Centro do percurso (margem da lagoa do Parque Expoville, conforme Diretriz).
const CENTER_LAT = -26.254123;
const CENTER_Lng = -48.847512;
const TRACK_RADIUS_M = 140;
const M_PER_DEG_LAT = 111_320;

export interface SimOptions {
  /** Injeta periodicamente um evento de bloqueio por algas (para demo). */
  injectAlgae?: boolean;
}

export class TelemetrySimulator {
  private t0: number | null = null;
  private voltage = BATTERY_FULL_V;
  private temp = 28; // °C ambiente inicial
  private algae = new AlgaeDetector();
  private opts: SimOptions;

  constructor(opts: SimOptions = {}) {
    this.opts = opts;
  }

  reset() {
    this.t0 = null;
    this.voltage = BATTERY_FULL_V;
    this.temp = 28;
    this.algae.reset();
  }

  next(now: number): TelemetryFrame {
    if (this.t0 == null) this.t0 = now;
    const elapsed = (now - this.t0) / 1000; // segundos de sessão

    // Posição angular ao redor do percurso (~1 volta a cada 70 s).
    const theta = (elapsed / 70) * 2 * Math.PI;

    // Velocidade: cruzeiro ~14 km/h com acelera/desacelera nas retas/curvas.
    const cruise = 14;
    const speedWave = Math.sin(elapsed / 6) * 5 + Math.sin(elapsed / 2.3) * 1.5;
    let speed_kmh = Math.max(0, cruise + speedWave);

    // Leme: o piloto faz guinadas senoidais; mais forte ao "fechar" a curva.
    const rudder_deg = clamp(
      Math.sin(elapsed / 4.5) * 35 + Math.sin(elapsed / 1.7) * 12,
      -RUDDER_MAX_DEG,
      RUDDER_MAX_DEG,
    );

    // Corrente: base + arrasto induzido (|leme|) + carga hidrodinâmica (v^2).
    const dragLoad = Math.abs(rudder_deg) * 0.28; // A por grau de leme
    const hydroLoad = (speed_kmh / 18) ** 2 * 12;
    let current_a = 6 + dragLoad + hydroLoad + (Math.random() - 0.5) * 1.5;

    // Evento de algas: a cada ~95 s, prende o leme e trava a velocidade.
    const inAlgaeWindow =
      this.opts.injectAlgae !== false &&
      elapsed > 30 &&
      elapsed % 95 < 4; // janela de ~4 s
    if (inAlgaeWindow) {
      current_a = 27 + Math.random() * 4; // sobrecarga por bloqueio
      speed_kmh = 1.2; // perde o andamento
    }

    // Course over ground: tangente ao círculo + influência do leme.
    const cog = (deg(theta + Math.PI / 2) + rudder_deg * 0.4 + 360) % 360;

    // Posição GPS ao longo do percurso circular.
    const cosLat = Math.cos((CENTER_LAT * Math.PI) / 180);
    const dLat = (Math.cos(theta) * TRACK_RADIUS_M) / M_PER_DEG_LAT;
    const dLng =
      (Math.sin(theta) * TRACK_RADIUS_M) / (M_PER_DEG_LAT * cosLat);
    const lat = CENTER_LAT + dLat;
    const lng = CENTER_Lng + dLng;

    // Térmica: inércia de 1ª ordem puxando para um alvo ligado à corrente.
    const tempTarget = 30 + current_a * 1.7;
    this.temp += (tempTarget - this.temp) * 0.012;
    // Pequeno overshoot ocasional para exercitar o alarme de 70 °C.
    if (elapsed > 140 && elapsed % 120 < 6) this.temp += 0.4;
    const temp_c = round(this.temp, 1);

    // Descarga da bateria: integra a corrente consumida (queda + sag de carga).
    this.voltage -= (current_a / 3600) * 0.06; // descarga lenta
    const sag = current_a * 0.018; // queda instantânea sob carga
    const voltage_v = round(Math.max(9.5, this.voltage - sag), 2);

    const algae_alert = this.algae.update(current_a, speed_kmh, now);

    const frame: TelemetryFrame = {
      gps: {
        lat: round(lat, 6),
        lng: round(lng, 6),
        speed_kmh: round(speed_kmh, 1),
        cog: round(cog, 1),
        fix: true,
      },
      sensors: {
        current_a: round(current_a, 1),
        voltage_v,
        temp_c,
        rudder_deg: round(rudder_deg, 1),
      },
      status: {
        algae_alert,
        overheat_alert: temp_c >= OVERHEAT_C,
        battery_low: voltage_v <= BATTERY_YELLOW_LO_V,
      },
    };
    return frame;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}
