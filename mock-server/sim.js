// Simulador de telemetria 5 Hz (porte do simulador TS do dashboard para JS puro).
//
// Reproduz uma sessao de prova no Parque Expoville com sinais fisicamente
// correlacionados: curvas de leme geram arrasto hidrodinamico e picos de
// corrente no motor Imobras, a temperatura do estator sobe com a carga e a
// bateria de chumbo-acido descarrega ao longo do tempo. Serve para
// desenvolver/demonstrar a UI sem o ESP32 a bordo.
//
// Fonte: dashboard/src/lib/telemetry/simulator.ts + contract.ts.

// --- Limiares (Diretriz) ---
const RUDDER_MAX_DEG = 45;
const OVERHEAT_C = 70; // Controle de danos termicos

// Algoritmo de alerta de algas
const ALGAE_CURRENT_A = 25; // corrente acima de 25A...
const ALGAE_DURATION_MS = 1500; // ...por mais de 1.5s...
const ALGAE_SPEED_KMH = 2; // ...com velocidade abaixo de 2 km/h.

// Curva da bateria de chumbo-acido 12V
const BATTERY_FULL_V = 12.7;
const BATTERY_YELLOW_LO_V = 10.8; // gatilho de battery_low

// Centro do percurso (margem da lagoa do Parque Expoville, conforme Diretriz).
const CENTER_LAT = -26.254123;
const CENTER_Lng = -48.847512;
const TRACK_RADIUS_M = 140;
const M_PER_DEG_LAT = 111_320;

/**
 * Detector de bloqueio por algas (com estado): mantem o instante em que a
 * corrente passou de ALGAE_CURRENT_A. Espelha o AlgaeDetector da Diretriz.
 */
class AlgaeDetector {
  constructor() {
    this.highCurrentSince = null;
  }

  update(current_a, speed_kmh, now) {
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

export class TelemetrySimulator {
  /** @param {{ injectAlgae?: boolean }} [opts] */
  constructor(opts = {}) {
    this.t0 = null;
    this.voltage = BATTERY_FULL_V;
    this.temp = 28; // graus C ambiente inicial
    this.algae = new AlgaeDetector();
    this.opts = opts;
  }

  reset() {
    this.t0 = null;
    this.voltage = BATTERY_FULL_V;
    this.temp = 28;
    this.algae.reset();
  }

  /**
   * Calcula o proximo quadro de telemetria.
   * @param {number} now timestamp em ms (Date.now()).
   * @returns {object} quadro no formato do contrato Athenas.
   */
  next(now) {
    if (this.t0 == null) this.t0 = now;
    const elapsed = (now - this.t0) / 1000; // segundos de sessao

    // Posicao angular ao redor do percurso (~1 volta a cada 70 s).
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

    // Corrente: base + arrasto induzido (|leme|) + carga hidrodinamica (v^2).
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

    // Course over ground: tangente ao circulo + influencia do leme.
    const cog = (deg(theta + Math.PI / 2) + rudder_deg * 0.4 + 360) % 360;

    // Posicao GPS ao longo do percurso circular.
    const cosLat = Math.cos((CENTER_LAT * Math.PI) / 180);
    const dLat = (Math.cos(theta) * TRACK_RADIUS_M) / M_PER_DEG_LAT;
    const dLng =
      (Math.sin(theta) * TRACK_RADIUS_M) / (M_PER_DEG_LAT * cosLat);
    const lat = CENTER_LAT + dLat;
    const lng = CENTER_Lng + dLng;

    // Termica: inercia de 1a ordem puxando para um alvo ligado a corrente.
    const tempTarget = 30 + current_a * 1.7;
    this.temp += (tempTarget - this.temp) * 0.012;
    // Pequeno overshoot ocasional para exercitar o alarme de 70 C.
    if (elapsed > 140 && elapsed % 120 < 6) this.temp += 0.4;
    const temp_c = round(this.temp, 1);

    // Descarga da bateria: integra a corrente consumida (queda + sag de carga).
    this.voltage -= (current_a / 3600) * 0.06; // descarga lenta
    const sag = current_a * 0.018; // queda instantanea sob carga
    const voltage_v = round(Math.max(9.5, this.voltage - sag), 2);

    const algae_alert = this.algae.update(current_a, speed_kmh, now);

    return {
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
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function round(v, decimals) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
function deg(rad) {
  return (rad * 180) / Math.PI;
}

// Instancia compartilhada + helper next(now), conforme solicitado.
const sim = new TelemetrySimulator();

/**
 * Retorna o proximo quadro de telemetria do simulador compartilhado.
 * @param {number} [now] timestamp em ms; usa Date.now() se omitido.
 */
export function next(now = Date.now()) {
  return sim.next(now);
}

export default { next, TelemetrySimulator };
