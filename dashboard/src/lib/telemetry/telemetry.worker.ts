// =============================================================================
//  Web Worker de telemetria — thread dedicada de ingestao
//
//  A Diretriz manda tirar a deserializacao do JSON da Main Thread. Fomos alem:
//  este worker e dono do WEBSOCKET INTEIRO. A main thread nunca ve uma string,
//  nunca chama JSON.parse e nunca gerencia reconexao — ela so recebe objetos
//  ja validados e ja filtrados, e pode gastar 100% do orcamento de 16 ms
//  pintando a interface.
//
//  Pipeline executado aqui, fora da UI:
//    1. Recepcao do frame do ESP32 (texto)
//    2. JSON.parse
//    3. Validacao/coercao defensiva (parseFrame)
//    4. Filtro de Kalman 2D no GPS (suavizacao da trajetoria)
//    5. postMessage do ProcessedSample para a main thread
//
//  Reconexao com backoff exponencial limitado — durante a prova a rede WiFi da
//  margem do lago cai e volta; martelar a cada 100 ms so piora.
// =============================================================================

/// <reference lib="webworker" />

import { parseFrame } from "./contract";
import { KalmanFilter2D } from "@/lib/math/KalmanFilter2D";
import type { ProcessedSample } from "@/types/telemetry";

// --- Protocolo main thread -> worker ---
export type WorkerCommand =
  | { type: "connect"; urls: string[] }
  | { type: "disconnect" }
  | { type: "reset" };

// --- Protocolo worker -> main thread ---
export type WorkerEvent =
  | { type: "frame"; sample: ProcessedSample }
  | { type: "status"; status: "connecting" | "live" | "disconnected" }
  | { type: "stats"; dropped: number; malformed: number }
  | { type: "endpoint"; url: string };

const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 8000;
/** Intervalo de envio das estatisticas de saude do enlace. */
const STATS_INTERVAL_MS = 2000;

let socket: WebSocket | null = null;
/**
 * Candidatos de endereco do mestre, em ordem de preferencia.
 *
 * O receptor muda de endereco conforme o modo de rede (entra na rede da
 * bancada por DHCP, ou cria a propria em 192.168.4.1). Exigir que a tripulacao
 * descubra e digite o IP certo, na hora da prova, e um jeito garantido de
 * perder tempo por configuracao. Aqui o worker CICLA pelos candidatos a cada
 * tentativa ate um responder, e entao fica nele.
 */
let candidatos: string[] = [];
let candidatoAtual = 0;
let url = "";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let attempt = 0;
let closedByUs = false;

const kalman = new KalmanFilter2D();

/** Ultimo `seq` recebido — detecta pacotes perdidos no enlace WiFi. */
let lastSeq = -1;
let droppedFrames = 0;
let malformedFrames = 0;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(event: WorkerEvent): void {
  ctx.postMessage(event);
}

// ---------------------------------------------------------------------------
//  Conexao
// ---------------------------------------------------------------------------

function clearReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (closedByUs) return;
  clearReconnect();
  // Backoff exponencial com teto: 0.8s, 1.6s, 3.2s, 6.4s, 8s, 8s...
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  attempt++;
  candidatoAtual++;   // proxima tentativa testa o proximo endereco
  reconnectTimer = setTimeout(open, delay);
}

function open(): void {
  if (candidatos.length === 0) return;

  // Cicla entre os candidatos. Enquanto nenhum responde, cada nova tentativa
  // testa o proximo — em vez de insistir para sempre num endereco errado.
  url = candidatos[candidatoAtual % candidatos.length];
  closedByUs = false;
  post({ type: "status", status: "connecting" });

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    // URL invalida (ex.: usuario digitou host errado no campo de configuracao).
    post({ type: "status", status: "disconnected" });
    scheduleReconnect();
    return;
  }

  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return; // socket obsoleto de uma tentativa anterior
    attempt = 0;
    lastSeq = -1;
    // Achou: para de ciclar e informa a UI qual endereco vingou.
    post({ type: "endpoint", url });
    post({ type: "status", status: "live" });
  };

  ws.onmessage = (ev: MessageEvent) => {
    if (socket !== ws) return;
    handleMessage(ev.data);
  };

  ws.onerror = () => {
    // O evento de erro do WebSocket nao traz detalhe util por seguranca do
    // browser; o fechamento subsequente e quem dispara a reconexao.
    try {
      ws.close();
    } catch {
      /* ja fechado */
    }
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    post({ type: "status", status: "disconnected" });
    scheduleReconnect();
  };
}

function close(): void {
  closedByUs = true;
  clearReconnect();
  const ws = socket;
  socket = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  post({ type: "status", status: "disconnected" });
}

// ---------------------------------------------------------------------------
//  Processamento de um quadro
// ---------------------------------------------------------------------------

function handleMessage(data: unknown): void {
  // O ESP32 envia texto (ws.textAll). Um Blob so apareceria se alguem trocasse
  // para binario; nesse caso descartamos em vez de fazer I/O assincrono aqui.
  if (typeof data !== "string") {
    malformedFrames++;
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    malformedFrames++;
    return;
  }

  const frame = parseFrame(raw);
  if (!frame) {
    malformedFrames++;
    return;
  }

  const t = Date.now();

  // --- Contagem de pacotes perdidos pelo campo `seq` do firmware ---
  if (lastSeq >= 0) {
    // Um seq MENOR que o anterior significa que o ESP32 reiniciou; nesse caso
    // nao contamos como perda, apenas re-sincronizamos.
    if (frame.seq > lastSeq) {
      droppedFrames += frame.seq - lastSeq - 1;
    } else if (frame.seq < lastSeq) {
      kalman.reset(); // trajetoria antiga nao vale mais apos reboot
    }
  }
  lastSeq = frame.seq;

  // --- Filtro de Kalman 2D: so alimentamos o filtro com fix VALIDO.
  // Injetar (0,0) de um GPS sem fix arrastaria a estimativa para o meio do
  // Atlantico e levaria dezenas de segundos para o filtro se recuperar. ---
  let lat_f = frame.gps.lat;
  let lng_f = frame.gps.lng;

  if (frame.gps.fix && !frame.faults.gps) {
    const filtered = kalman.update(frame.gps.lat, frame.gps.lng, t);
    lat_f = filtered.lat;
    lng_f = filtered.lng;
  }

  const sample: ProcessedSample = { ...frame, t, lat_f, lng_f };
  post({ type: "frame", sample });
}

// ---------------------------------------------------------------------------
//  Ciclo de vida
// ---------------------------------------------------------------------------

statsTimer = setInterval(() => {
  post({ type: "stats", dropped: droppedFrames, malformed: malformedFrames });
}, STATS_INTERVAL_MS);

ctx.onmessage = (ev: MessageEvent<WorkerCommand>) => {
  const cmd = ev.data;
  if (!cmd || typeof cmd !== "object") return;

  switch (cmd.type) {
    case "connect": {
      const novos = cmd.urls.filter(Boolean);
      if (novos.length === 0) return;
      // Trocar de lista: derruba o socket atual antes de abrir o novo.
      if (novos.join("|") !== candidatos.join("|") || !socket) {
        close();
        candidatos = novos;
        candidatoAtual = 0;
        attempt = 0;
        kalman.reset();
        open();
      }
      return;
    }
    case "disconnect": {
      close();
      return;
    }
    case "reset": {
      kalman.reset();
      lastSeq = -1;
      droppedFrames = 0;
      malformedFrames = 0;
      return;
    }
  }
};

ctx.addEventListener("close", () => {
  if (statsTimer !== null) clearInterval(statsTimer);
  clearReconnect();
});
