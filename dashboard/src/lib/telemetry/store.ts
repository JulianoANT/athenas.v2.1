// =============================================================================
//  useTelemetryStore — estado de telemetria em Zustand
//
//  Substitui o React.Context da v2.0. O motivo e de arquitetura, nao de gosto:
//  um Context propaga QUALQUER mudanca de valor para TODOS os consumidores.
//  A 5 Hz isso significa que o grafico do motor re-renderiza o mapa do GPS,
//  o horizonte 3D e a bussola, 5 vezes por segundo, para sempre.
//
//  Com Zustand cada componente assina apenas a fatia primitiva que consome
//  (`useTelemetryStore(s => s.speedKnots)`), e o Zustand faz bailout por
//  Object.is — se o numero nao mudou, o componente nao re-renderiza.
//
//  Alem disso, componentes de altissima frequencia (o horizonte artificial em
//  WebGL) leem via `useTelemetryStore.getState()` DENTRO do useFrame: zero
//  assinaturas, zero re-renders, 60 FPS mutando a matriz da malha direto.
//
//  Series historicas NAO ficam aqui — vivem em buffers circulares
//  (./history.ts). O store so guarda um contador de versao para os graficos
//  saberem que ha dado novo.
// =============================================================================

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import type {
  ConnectionStatus,
  ProcessedSample,
  VesselHealth,
} from "@/types/telemetry";
import {
  MELTDOWN_C,
  emptyFrame,
  haversine,
  toKnots,
  vesselHealth,
} from "./contract";
import { history, sessionLog } from "./history";
import { readEndpoint, saveEndpoint } from "./endpoint";
import {
  ThermalPredictor,
  type ThermalCoefficients,
} from "@/lib/math/ThermalPredictor";
import {
  readCoefficients,
  saveCoefficients,
  resetCoefficients,
} from "@/lib/math/thermal-calibration";
import {
  CavitationDetector,
  computePower,
  efficiencyLevel,
  type EfficiencyLevel,
} from "@/lib/math/hydrodynamics";

/** Horizonte da projecao termica de emergencia, em segundos. */
export const MELTDOWN_HORIZON_S = 30;

export interface Station {
  lat: number;
  lng: number;
}

export interface TelemetryState {
  // --- Quadro bruto (assine so se realmente precisar do objeto inteiro) ---
  frame: ProcessedSample | null;

  // --- Fatias primitivas: o caminho recomendado de consumo na UI ---
  status: ConnectionStatus;
  health: VesselHealth;
  speedKnots: number;
  cog: number;
  /** Latitude/longitude ja suavizadas pelo Filtro de Kalman. */
  lat: number;
  lng: number;
  fix: boolean;

  // --- Gemeo Digital Termico ---
  /** Temperatura virtual do nucleo do estator (°C), integrada por Euler. */
  virtualCoreTemp: number;
  /** Segundos ate o nucleo virtual atingir 90 °C, ou null se inatingivel. */
  secondsToMeltdown: number | null;
  /** Projecao termica daqui a MELTDOWN_HORIZON_S segundos (°C). */
  projectedCoreTemp: number;
  /** Gatilho de emergencia: fusao do estator prevista dentro do horizonte. */
  meltdownImminent: boolean;
  /**
   * Contador de EPISODIOS de risco de fusao — incrementa a cada transicao
   * "seguro -> iminente".
   *
   * Existe para que a UI saiba distinguir "o mesmo alerta continua" de "um novo
   * alerta comecou". Sem isso, dispensar o aviso durante uma arrancada
   * silenciaria tambem o proximo episodio; e a alternativa (rastrear a
   * transicao com refs dentro do componente) tornaria o render impuro.
   */
  meltdownEpisode: number;
  /** Coeficientes empiricos do modelo termico (calibrados na bancada). */
  thermalCoeff: ThermalCoefficients;

  // --- Eficiencia hidrodinamica ---
  /** Potencia eletrica de entrada P_in = V·I (W). */
  power_w: number;
  /** Consumo especifico (W/no); null quando o barco esta praticamente parado. */
  sec_w_per_knot: number | null;
  efficiency: EfficiencyLevel | null;
  /** Cavitacao ou arrasto excessivo caracterizado. */
  cavitationAlert: boolean;

  // --- Estacao de controle ---
  station: Station | null;
  distance_m: number | null;

  // --- Sessao e diagnostico do enlace ---
  sessionStart: number;
  /** Incrementa a cada quadro; graficos assinam isto para redesenhar. */
  historyVersion: number;
  /** Idem, mas apenas quando o log de 1 Hz recebe uma amostra. */
  sessionVersion: number;
  droppedFrames: number;
  malformedFrames: number;
  /** Epoch ms do ultimo quadro recebido (detecta enlace mudo). */
  lastFrameAt: number;
  /**
   * Cadencia REAL medida, em Hz.
   *
   * Nada no painel assume 5 Hz. Com o enlace LoRa a taxa e uma escolha de
   * engenharia — baixar de 5 Hz para 2 Hz dobra o alcance util — e o numero
   * exibido tem que refletir o que esta chegando de fato, nao o que o projeto
   * gostaria de estar recebendo.
   */
  measuredHz: number;

  // --- Configuracao ---
  endpoint: string;

  // --- Acoes ---
  ingest: (sample: ProcessedSample) => void;
  setStatus: (status: ConnectionStatus) => void;
  setLinkStats: (dropped: number, malformed: number) => void;
  setEndpoint: (input: string) => void;
  /** Registra o endereco que a descoberta automatica encontrou. */
  setDiscoveredEndpoint: (url: string) => void;
  setStation: (station: Station | null) => void;
  requestStation: () => void;
  resetSession: () => void;
  tickThermal: () => void;
  setThermalCoeff: (coeff: ThermalCoefficients) => void;
  resetThermalCoeff: () => void;
}

const cavitation = new CavitationDetector();

/** Instante da ultima integracao termica (para obter o dt real). */
let lastThermalAt = 0;

/**
 * Janela de medicao da cadencia, em ms.
 *
 * 3 s equilibra os dois erros: janela curta demais volta a sofrer com as
 * rajadas do TCP; longa demais faz o numero demorar a reagir quando a equipe
 * muda o spreading factor do radio para ganhar alcance.
 */
const RATE_WINDOW_MS = 3000;

/** Estado da janela de medicao (fora do store: nao precisa disparar render). */
let rateWindowStart = 0;
let rateSeqStart = 0;

export const useTelemetryStore = create<TelemetryState>()(
  subscribeWithSelector((set, get) => ({
    frame: null,
    status: "connecting",
    health: "serena",
    speedKnots: 0,
    cog: 0,
    lat: 0,
    lng: 0,
    fix: false,

    virtualCoreTemp: NaN,
    secondsToMeltdown: null,
    projectedCoreTemp: NaN,
    meltdownImminent: false,
    meltdownEpisode: 0,
    thermalCoeff: readCoefficients(),

    power_w: 0,
    sec_w_per_knot: null,
    efficiency: null,
    cavitationAlert: false,

    station: null,
    distance_m: null,

    sessionStart: Date.now(),
    historyVersion: 0,
    sessionVersion: 0,
    droppedFrames: 0,
    malformedFrames: 0,
    lastFrameAt: 0,
    measuredHz: 0,

    endpoint: readEndpoint(),

    // -----------------------------------------------------------------------
    //  Ingestao de um quadro ja validado e filtrado pelo Web Worker.
    //  Caminho quente: roda 5x por segundo. Tudo aqui e O(1).
    // -----------------------------------------------------------------------
    ingest: (sample) => {
      const s = get();

      const speedKnots = toKnots(sample.gps.speed_kmh);
      const health = vesselHealth(sample);

      const { power_w, sec_w_per_knot } = computePower(
        sample.sensors.voltage_v,
        sample.sensors.current_a,
        speedKnots,
      );
      const cavitationAlert = cavitation.update(
        sec_w_per_knot,
        speedKnots,
        sample.t,
      );

      // O gemeo termico e semeado com a primeira leitura FISICA valida do
      // DS18B20: partir de um chute deixaria a curva virtual errada por
      // minutos ate a exponencial convergir.
      const virtual = Number.isFinite(s.virtualCoreTemp)
        ? s.virtualCoreTemp
        : sample.faults.motor_temp
          ? NaN
          : sample.sensors.temp_c;

      history.push(sample, virtual);
      const logged = sessionLog.push(sample, virtual);

      const distance_m =
        s.station && sample.gps.fix
          ? haversine(s.station.lat, s.station.lng, sample.lat_f, sample.lng_f)
          : null;

      // --- Cadencia real do enlace ---
      //
      // Derivada do CONTADOR `seq`, nao dos instantes de chegada. Essa escolha
      // custou duas tentativas erradas antes de ficar certa:
      //
      //   1. intervalo entre quadros consecutivos -> exibia 20 Hz. O TCP
      //      entrega em rajada, entao dois quadros podem chegar com 50 ms de
      //      diferenca mesmo a 5 Hz reais.
      //   2. contagem de chegadas por janela -> exibia 6,7 Hz. Melhor, mas
      //      ainda contaminado por reentregas e pelas bordas da janela.
      //
      // O `seq` e incrementado UMA VEZ por quadro encaminhado pelo mestre.
      // Dividir o avanco dele pelo tempo decorrido da a taxa exata, imune a
      // rajada, a duplicata e a jitter de rede.
      let measuredHz = s.measuredHz;
      if (rateWindowStart === 0) {
        rateWindowStart = sample.t;
        rateSeqStart = sample.seq;
      } else {
        const janela = sample.t - rateWindowStart;
        if (janela >= RATE_WINDOW_MS) {
          // `seq` e uint16 no firmware: trata o retorno a zero.
          let delta = sample.seq - rateSeqStart;
          if (delta < 0) delta += 65536;
          measuredHz = (delta * 1000) / janela;
          rateWindowStart = sample.t;
          rateSeqStart = sample.seq;
        }
      }

      set({
        frame: sample,
        speedKnots,
        cog: sample.gps.cog,
        lat: sample.lat_f,
        lng: sample.lng_f,
        fix: sample.gps.fix,
        health,
        power_w,
        sec_w_per_knot,
        efficiency: efficiencyLevel(sec_w_per_knot),
        cavitationAlert,
        distance_m,
        virtualCoreTemp: virtual,
        historyVersion: s.historyVersion + 1,
        sessionVersion: logged ? s.sessionVersion + 1 : s.sessionVersion,
        lastFrameAt: sample.t,
        measuredHz,
      });
    },

    // -----------------------------------------------------------------------
    //  Passo do Gemeo Digital Termico.
    //
    //  Roda em um setInterval proprio (ver ./bridge.ts), DESVINCULADO da
    //  chegada de quadros e da renderizacao: mesmo que o WiFi engasgue por um
    //  segundo, a integracao continua com a ultima corrente conhecida e a
    //  curva nao ganha degraus.
    // -----------------------------------------------------------------------
    tickThermal: () => {
      const s = get();
      const frame = s.frame;
      if (!frame) return;

      const now = Date.now();

      // Enlace mudo ha mais de 3 s: congela a integracao. Continuar somando
      // calor com base numa corrente obsoleta produziria um alarme falso.
      if (now - s.lastFrameAt > 3000) return;

      const dt = lastThermalAt ? (now - lastThermalAt) / 1000 : 0;
      lastThermalAt = now;
      if (dt <= 0) return;

      // Sem T_amb confiavel (DHT22 em falha), usamos a propria temperatura do
      // estator como referencia: isso zera o termo de resfriamento e torna a
      // previsao CONSERVADORA (mais quente), que e o lado seguro do erro.
      const ambient = frame.faults.ambient
        ? frame.sensors.temp_c
        : frame.ambient.temp_c;

      const seed = frame.faults.motor_temp ? NaN : frame.sensors.temp_c;
      const current = Number.isFinite(s.virtualCoreTemp)
        ? s.virtualCoreTemp
        : seed;
      if (!Number.isFinite(current)) return;

      const coeff = s.thermalCoeff;

      // A leitura fisica so alimenta o observador quando e CONFIAVEL. Com o
      // DS18B20 em falha o gemeo passa a rodar em malha aberta — menos preciso,
      // mas melhor do que ser ancorado por um valor congelado e falso.
      const sensorAnchor = frame.faults.motor_temp
        ? null
        : frame.sensors.temp_c;

      const next = ThermalPredictor.integrate(
        current,
        frame.sensors.current_a,
        ambient,
        dt,
        coeff,
        sensorAnchor,
      );

      // A PROJECAO roda em MALHA ABERTA (sem o termo do observador): ela
      // responde "para onde o nucleo vai se esta corrente for mantida", e nessa
      // hipotese o proprio sensor tambem subiria — ancorar na leitura atual
      // subestimaria o risco justamente no momento em que ele importa.
      const secondsToMeltdown = ThermalPredictor.timeToReach(
        next,
        frame.sensors.current_a,
        ambient,
        MELTDOWN_C,
        coeff,
      );

      const projectedCoreTemp = ThermalPredictor.project(
        next,
        frame.sensors.current_a,
        ambient,
        MELTDOWN_HORIZON_S,
        coeff,
      );

      const meltdownImminent =
        secondsToMeltdown !== null && secondsToMeltdown <= MELTDOWN_HORIZON_S;

      set({
        virtualCoreTemp: next,
        secondsToMeltdown,
        projectedCoreTemp,
        meltdownImminent,
        // Conta apenas a transicao seguro -> iminente.
        meltdownEpisode:
          meltdownImminent && !s.meltdownImminent
            ? s.meltdownEpisode + 1
            : s.meltdownEpisode,
      });
    },

    setStatus: (status) => {
      if (get().status !== status) set({ status });
    },

    setLinkStats: (droppedFrames, malformedFrames) =>
      set({ droppedFrames, malformedFrames }),

    setEndpoint: (input) => set({ endpoint: saveEndpoint(input) }),

    // Apenas reflete na UI: NAO persiste. Persistir transformaria uma
    // descoberta automatica em escolha manual, e o painel deixaria de
    // procurar o mestre se ele mudasse de endereco na proxima sessao.
    setDiscoveredEndpoint: (url) => {
      if (get().endpoint !== url) set({ endpoint: url });
    },

    setThermalCoeff: (coeff) => {
      // Recalibrar muda a fisica do modelo: manter a temperatura virtual antiga
      // misturaria duas parametrizacoes na mesma curva. Zeramos para o gemeo
      // ser semeado de novo pela proxima leitura fisica valida.
      set({
        thermalCoeff: saveCoefficients(coeff),
        virtualCoreTemp: NaN,
        secondsToMeltdown: null,
        projectedCoreTemp: NaN,
        meltdownImminent: false,
      });
    },

    resetThermalCoeff: () =>
      set({
        thermalCoeff: resetCoefficients(),
        virtualCoreTemp: NaN,
        secondsToMeltdown: null,
        projectedCoreTemp: NaN,
        meltdownImminent: false,
      }),

    setStation: (station) => {
      const frame = get().frame;
      const distance_m =
        station && frame && frame.gps.fix
          ? haversine(station.lat, station.lng, frame.lat_f, frame.lng_f)
          : null;
      set({ station, distance_m });
    },

    requestStation: () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          get().setStation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        () => get().setStation(null),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    },

    resetSession: () => {
      history.clear();
      sessionLog.clear();
      cavitation.reset();
      lastThermalAt = 0;
      rateWindowStart = 0;
      rateSeqStart = 0;
      set({
        sessionStart: Date.now(),
        historyVersion: 0,
        sessionVersion: 0,
        droppedFrames: 0,
        malformedFrames: 0,
        measuredHz: 0,
        virtualCoreTemp: NaN,
        secondsToMeltdown: null,
        projectedCoreTemp: NaN,
        meltdownImminent: false,
        cavitationAlert: false,
      });
    },
  })),
);

/**
 * Leitura nao reativa do quadro atual, para uso dentro de loops de animacao
 * (useFrame do @react-three/fiber). Devolve um quadro neutro antes do primeiro
 * dado do hardware, de modo que o consumidor nunca precise checar null a
 * 60 FPS.
 */
export function currentFrame(): ProcessedSample {
  const f = useTelemetryStore.getState().frame;
  return f ?? { ...emptyFrame(Date.now()), lat_f: 0, lng_f: 0 };
}
