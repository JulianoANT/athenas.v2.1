// =============================================================================
//  Filtro de Kalman 2D — suavizacao da trajetoria GPS (Neo-6M)
//
//  PROBLEMA: o Neo-6M sofre com "multipath" na margem do lago — o sinal
//  ricocheteia em arquibancadas, arvores e na propria lamina d'agua, e a
//  posicao reportada salta metros de um quadro para o outro. Plotar isso cru
//  produz uma trilha serrilhada que nao corresponde a fisica do casco.
//
//  MODELO: velocidade constante (constant-velocity) em coordenadas locais ENU
//  (East-North-Up) centradas no primeiro fix. Trabalhar em METROS em vez de
//  graus e essencial: 1° de longitude vale ~111 km no equador mas encolhe com
//  cos(latitude), entao um filtro que trate lat/lon como grandezas homogeneas
//  fica anisotropico.
//
//      Estado:      x = [pe, pn, ve, vn]^T   (posicao e velocidade em ENU)
//      Transicao:   F = [[1,0,dt,0],
//                        [0,1,0,dt],
//                        [0,0,1, 0],
//                        [0,0,0, 1]]
//      Observacao:  H = [[1,0,0,0],
//                        [0,1,0,0]]         (o GPS so mede posicao)
//
//      Predicao:    x' = F·x          P' = F·P·F^T + Q
//      Ganho:       K  = P'·H^T · (H·P'·H^T + R)^-1
//      Correcao:    x  = x' + K·(z − H·x')     P = (I − K·H)·P'
//
//  Q e derivado de um ruido de aceleracao branco (sigma_a) — modelamos as
//  aceleracoes nao previstas do barco (rajada, guinada) como o processo que
//  "surpreende" o filtro.
//
//  Roda dentro do Web Worker, antes do quadro chegar na main thread.
// =============================================================================

import { RAIO_TERRA_M, toRad } from "@/lib/telemetry/contract";

export interface KalmanOptions {
  /**
   * Desvio-padrao do ruido de medicao do GPS, em metros. O Neo-6M em ceu
   * aberto fica em torno de 2.5 m; na margem do lago, com multipath, 4 m e
   * mais realista. Valor maior = filtro confia menos no GPS = trilha mais lisa
   * (porem mais atrasada).
   */
  measurementNoiseM?: number;
  /**
   * Desvio-padrao do ruido de aceleracao do processo, em m/s^2. Representa o
   * quanto o barco pode acelerar sem avisar. Valor maior = filtro reage mais
   * rapido a manobras (porem filtra menos ruido).
   */
  processNoiseAccel?: number;
}

const DEFAULT_MEASUREMENT_NOISE_M = 4.0;
const DEFAULT_PROCESS_NOISE_ACCEL = 0.6;

/** Passo de tempo minimo/maximo aceito, em segundos (defesa contra outliers). */
const MIN_DT_S = 0.001;
const MAX_DT_S = 5;

export interface FilteredPosition {
  lat: number;
  lng: number;
  /** Velocidade estimada para leste, em m/s. */
  vEast: number;
  /** Velocidade estimada para norte, em m/s. */
  vNorth: number;
  /** Modulo da velocidade estimada pelo filtro, em m/s. */
  speed_ms: number;
  /** Rumo estimado pelo filtro (0-360°), util quando o COG do GPS oscila. */
  course_deg: number;
}

export class KalmanFilter2D {
  private readonly R: number; // variancia da medicao (m^2)
  private readonly sigmaA2: number; // variancia da aceleracao (m^2/s^4)

  // Origem local ENU (primeiro fix valido).
  private originLat: number | null = null;
  private originLng: number | null = null;
  private metersPerDegLng = 0;
  private readonly metersPerDegLat = (Math.PI * RAIO_TERRA_M) / 180;

  // Estado x = [pe, pn, ve, vn].
  private x = [0, 0, 0, 0];
  // Covariancia P (4x4, armazenada como array plano row-major).
  private P = new Float64Array(16);

  private lastT: number | null = null;
  private initialized = false;

  constructor(opts: KalmanOptions = {}) {
    const sigmaZ = opts.measurementNoiseM ?? DEFAULT_MEASUREMENT_NOISE_M;
    const sigmaA = opts.processNoiseAccel ?? DEFAULT_PROCESS_NOISE_ACCEL;
    this.R = sigmaZ * sigmaZ;
    this.sigmaA2 = sigmaA * sigmaA;
  }

  /** Descarta todo o estado — usar ao iniciar uma nova sessao de prova. */
  reset(): void {
    this.originLat = null;
    this.originLng = null;
    this.x = [0, 0, 0, 0];
    this.P = new Float64Array(16);
    this.lastT = null;
    this.initialized = false;
  }

  /**
   * Processa uma medicao de GPS e devolve a posicao suavizada.
   *
   * @param lat  Latitude bruta em graus.
   * @param lng  Longitude bruta em graus.
   * @param tMs  Timestamp da medicao em epoch ms.
   * @returns    Posicao filtrada, ou a propria medicao se ela for invalida.
   */
  update(lat: number, lng: number, tMs: number): FilteredPosition {
    // --- Guardas: nunca deixe um NaN entrar na covariancia. Uma vez dentro,
    // ele contamina P para sempre e o filtro nunca mais volta. ---
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return this.passthrough(lat, lng);
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return this.passthrough(lat, lng);
    }
    // Coordenada (0,0) e o "null island": o firmware envia isso sem fix.
    if (lat === 0 && lng === 0) return this.passthrough(lat, lng);

    // --- Primeira medicao: define a origem ENU e inicializa o estado. ---
    if (!this.initialized) {
      this.originLat = lat;
      this.originLng = lng;
      this.metersPerDegLng = this.metersPerDegLat * Math.cos(toRad(lat));
      this.x = [0, 0, 0, 0];
      // Covariancia inicial: posicao razoavelmente confiavel, velocidade nao.
      this.P = new Float64Array(16);
      this.P[0] = this.R;
      this.P[5] = this.R;
      this.P[10] = 100;
      this.P[15] = 100;
      this.lastT = tMs;
      this.initialized = true;
      return this.output(lat, lng);
    }

    const [ze, zn] = this.toEnu(lat, lng);

    // --- Passo de tempo. Um dt absurdo (aba em background, reconexao) e
    // tratado como reinicio suave para nao explodir a covariancia. ---
    let dt = (tMs - (this.lastT ?? tMs)) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) dt = MIN_DT_S;
    if (dt > MAX_DT_S) {
      this.lastT = tMs;
      this.x = [ze, zn, 0, 0];
      this.P[0] = this.R;
      this.P[5] = this.R;
      this.P[10] = 100;
      this.P[15] = 100;
      return this.output(lat, lng);
    }
    this.lastT = tMs;

    this.predict(dt);
    this.correct(ze, zn);

    const [pe, pn, ve, vn] = this.x;
    const { lat: fLat, lng: fLng } = this.fromEnu(pe, pn);
    const speed = Math.hypot(ve, vn);
    // atan2(east, north) da o azimute a partir do Norte, sentido horario.
    const course = (Math.atan2(ve, vn) * (180 / Math.PI) + 360) % 360;

    return {
      lat: fLat,
      lng: fLng,
      vEast: ve,
      vNorth: vn,
      speed_ms: speed,
      course_deg: course,
    };
  }

  // -------------------------------------------------------------------------
  //  Etapa de predicao: x' = F·x , P' = F·P·F^T + Q
  //
  //  F e esparsa (modelo de velocidade constante), entao a multiplicacao e
  //  expandida a mao em vez de usar um loop generico de matrizes 4x4. Isso
  //  importa: esse metodo roda 5x por segundo durante toda a prova.
  // -------------------------------------------------------------------------
  private predict(dt: number): void {
    const P = this.P;

    // x' = F·x
    this.x[0] += this.x[2] * dt;
    this.x[1] += this.x[3] * dt;
    // velocidades permanecem (modelo de velocidade constante)

    // P' = F·P·F^T, com F somando dt*linha_velocidade na linha_posicao.
    // Primeiro F·P (linhas 0 e 1 recebem dt * linhas 2 e 3).
    for (let c = 0; c < 4; c++) {
      P[0 * 4 + c] += dt * P[2 * 4 + c];
      P[1 * 4 + c] += dt * P[3 * 4 + c];
    }
    // Depois (F·P)·F^T (colunas 0 e 1 recebem dt * colunas 2 e 3).
    for (let r = 0; r < 4; r++) {
      P[r * 4 + 0] += dt * P[r * 4 + 2];
      P[r * 4 + 1] += dt * P[r * 4 + 3];
    }

    // Q — ruido de processo por aceleracao branca discretizada:
    //   Q = sigma_a^2 · [[dt^4/4, 0, dt^3/2, 0],
    //                    [0, dt^4/4, 0, dt^3/2],
    //                    [dt^3/2, 0, dt^2, 0],
    //                    [0, dt^3/2, 0, dt^2]]
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt3 * dt;
    const q = this.sigmaA2;
    const q11 = (dt4 / 4) * q;
    const q13 = (dt3 / 2) * q;
    const q33 = dt2 * q;

    P[0] += q11;
    P[2] += q13;
    P[5] += q11;
    P[7] += q13;
    P[8] += q13;
    P[10] += q33;
    P[13] += q13;
    P[15] += q33;
  }

  // -------------------------------------------------------------------------
  //  Etapa de correcao. Como H seleciona apenas [pe, pn], a inovacao S e uma
  //  matriz 2x2 e o ganho K sai de uma inversao fechada — sem solver generico.
  // -------------------------------------------------------------------------
  private correct(ze: number, zn: number): void {
    const P = this.P;

    // S = H·P·H^T + R  (bloco superior-esquerdo 2x2 de P, mais R na diagonal)
    const s00 = P[0] + this.R;
    const s01 = P[1];
    const s10 = P[4];
    const s11 = P[5] + this.R;

    const det = s00 * s11 - s01 * s10;
    // Determinante degenerado: pula a correcao neste quadro em vez de dividir
    // por ~0 e destruir o estado.
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return;

    const invDet = 1 / det;
    const si00 = s11 * invDet;
    const si01 = -s01 * invDet;
    const si10 = -s10 * invDet;
    const si11 = s00 * invDet;

    // K = P·H^T·S^-1  -> 4x2. P·H^T e simplesmente as duas primeiras colunas.
    const K = new Float64Array(8);
    for (let r = 0; r < 4; r++) {
      const p0 = P[r * 4 + 0];
      const p1 = P[r * 4 + 1];
      K[r * 2 + 0] = p0 * si00 + p1 * si10;
      K[r * 2 + 1] = p0 * si01 + p1 * si11;
    }

    // Inovacao (residuo da medicao).
    const ye = ze - this.x[0];
    const yn = zn - this.x[1];

    // x = x' + K·y
    for (let r = 0; r < 4; r++) {
      this.x[r] += K[r * 2 + 0] * ye + K[r * 2 + 1] * yn;
    }

    // P = (I − K·H)·P'. K·H tem colunas nao nulas apenas em 0 e 1.
    const Pnew = new Float64Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const khP = K[r * 2 + 0] * P[0 * 4 + c] + K[r * 2 + 1] * P[1 * 4 + c];
        Pnew[r * 4 + c] = P[r * 4 + c] - khP;
      }
    }
    // Simetriza: erros de arredondamento acumulam assimetria em P ao longo de
    // milhares de iteracoes, o que leva a covariancias negativas.
    for (let r = 0; r < 4; r++) {
      for (let c = r; c < 4; c++) {
        const avg = (Pnew[r * 4 + c] + Pnew[c * 4 + r]) / 2;
        Pnew[r * 4 + c] = avg;
        Pnew[c * 4 + r] = avg;
      }
    }
    this.P = Pnew;
  }

  // --- Conversoes ENU <-> geograficas (plano tangente local) ---

  private toEnu(lat: number, lng: number): [number, number] {
    const east = (lng - (this.originLng ?? lng)) * this.metersPerDegLng;
    const north = (lat - (this.originLat ?? lat)) * this.metersPerDegLat;
    return [east, north];
  }

  private fromEnu(east: number, north: number): { lat: number; lng: number } {
    return {
      lat: (this.originLat ?? 0) + north / this.metersPerDegLat,
      lng: (this.originLng ?? 0) + east / (this.metersPerDegLng || 1),
    };
  }

  /** Saida sem filtragem (primeira medicao ou entrada invalida). */
  private passthrough(lat: number, lng: number): FilteredPosition {
    return {
      lat,
      lng,
      vEast: 0,
      vNorth: 0,
      speed_ms: 0,
      course_deg: 0,
    };
  }

  private output(lat: number, lng: number): FilteredPosition {
    return {
      lat,
      lng,
      vEast: this.x[2],
      vNorth: this.x[3],
      speed_ms: Math.hypot(this.x[2], this.x[3]),
      course_deg:
        (Math.atan2(this.x[2], this.x[3]) * (180 / Math.PI) + 360) % 360,
    };
  }
}
