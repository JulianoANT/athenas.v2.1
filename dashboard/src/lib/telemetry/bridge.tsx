// =============================================================================
//  TelemetryBridge — cola entre o Web Worker e o store Zustand.
//
//  Nao renderiza nada e nao expoe Context: e apenas um componente de ciclo de
//  vida montado uma vez na raiz. Ele:
//    1. instancia o Worker de telemetria (dono do WebSocket);
//    2. despacha os quadros recebidos para o store;
//    3. mantem o passo do Gemeo Digital Termico rodando em cadencia propria;
//    4. reconecta quando a tripulacao troca o endereco do ESP32.
// =============================================================================

import * as React from "react";

import { useTelemetryStore } from "./store";
import { SAMPLE_INTERVAL_MS } from "./contract";
import { DISCOVERY_CANDIDATES, hasSavedEndpoint } from "./endpoint";
import type { WorkerCommand, WorkerEvent } from "./telemetry.worker";

/**
 * Cadencia do integrador termico. Alinhada com a taxa de telemetria (5 Hz):
 * passos menores nao acrescentam precisao — a constante de tempo do estator
 * e da ordem de dezenas de segundos.
 */
const THERMAL_TICK_MS = SAMPLE_INTERVAL_MS;

export function TelemetryBridge() {
  const endpoint = useTelemetryStore((s) => s.endpoint);
  const workerRef = React.useRef<Worker | null>(null);

  // --- Ciclo de vida do worker -------------------------------------------
  React.useEffect(() => {
    const worker = new Worker(
      new URL("./telemetry.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      const msg = ev.data;
      const store = useTelemetryStore.getState();

      switch (msg.type) {
        case "frame":
          store.ingest(msg.sample);
          return;
        case "status":
          store.setStatus(msg.status);
          return;
        case "stats":
          store.setLinkStats(msg.dropped, msg.malformed);
          return;
        case "endpoint":
          // A descoberta achou o mestre: registra o endereco que vingou para
          // a UI exibir e para as proximas sessoes comecarem por ele.
          store.setDiscoveredEndpoint(msg.url);
          return;
      }
    };

    return () => {
      worker.onmessage = null;
      const cmd: WorkerCommand = { type: "disconnect" };
      worker.postMessage(cmd);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // --- (Re)conexao quando o endpoint muda ---------------------------------
  React.useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    // Se a tripulacao fixou um endereco na UI, ele e o unico candidato — uma
    // escolha explicita nao deve ser sobrescrita por descoberta automatica.
    // Caso contrario, entregamos a lista e o worker acha o mestre sozinho.
    const urls = hasSavedEndpoint()
      ? [endpoint]
      : [endpoint, ...DISCOVERY_CANDIDATES.filter((u) => u !== endpoint)];

    const cmd: WorkerCommand = { type: "connect", urls };
    worker.postMessage(cmd);
  }, [endpoint]);

  // --- Gemeo Digital Termico: integrador independente ----------------------
  React.useEffect(() => {
    const tick = useTelemetryStore.getState().tickThermal;
    const id = window.setInterval(tick, THERMAL_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
