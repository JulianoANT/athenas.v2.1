import * as React from "react";
import type {
  ConnectionStatus,
  TelemetryMode,
  TelemetrySample,
  VesselHealth,
} from "@/types/telemetry";
import {
  SAMPLE_INTERVAL_MS,
  emptyFrame,
  haversine,
  isTelemetryFrame,
  vesselHealth,
} from "./contract";
import { TelemetrySimulator } from "./simulator";

const HISTORY_MAX = 1800; // ~6 min a 5 Hz para os gráficos ao vivo
const SESSION_MAX = 7200; // ~2 h decimado a 1 Hz para exportação
const MODE_KEY = "athenas:telemetry-mode";

const DEFAULT_WS =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${
        window.location.hostname || "localhost"
      }:8080`
    : "ws://localhost:8080";

const WS_URL = import.meta.env.VITE_TELEMETRY_WS || DEFAULT_WS;

export interface Station {
  lat: number;
  lng: number;
}

export interface TelemetryContextValue {
  /** Último quadro recebido (null antes do primeiro dado). */
  frame: TelemetrySample | null;
  /** Histórico recente em alta taxa, para gráficos. */
  history: TelemetrySample[];
  /** Log da sessão decimado a 1 Hz, para exportação. */
  sessionLog: TelemetrySample[];
  status: ConnectionStatus;
  mode: TelemetryMode;
  setMode: (m: TelemetryMode) => void;
  health: VesselHealth;
  /** Posição da estação de controle (geolocalização do navegador). */
  station: Station | null;
  /** Distância linear estação -> barco em metros (Haversine). */
  distance_m: number | null;
  requestStation: () => void;
  sessionStart: number;
  resetSession: () => void;
}

const TelemetryContext = React.createContext<TelemetryContextValue | null>(
  null,
);

function readMode(): TelemetryMode {
  if (typeof window === "undefined") return "mock";
  // No build público (GitHub Pages) não há backend WebSocket: força Simulação
  // e ignora qualquer preferência "live" salva localmente.
  if (import.meta.env.PROD) return "mock";
  return window.localStorage.getItem(MODE_KEY) === "live" ? "live" : "mock";
}

export function TelemetryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mode, setModeState] = React.useState<TelemetryMode>(readMode);
  const [status, setStatus] = React.useState<ConnectionStatus>("connecting");
  const [frame, setFrame] = React.useState<TelemetrySample | null>(null);
  const [history, setHistory] = React.useState<TelemetrySample[]>([]);
  const [sessionLog, setSessionLog] = React.useState<TelemetrySample[]>([]);
  const [station, setStation] = React.useState<Station | null>(null);
  const [sessionStart, setSessionStart] = React.useState<number>(() =>
    Date.now(),
  );

  const lastLogAt = React.useRef(0);

  const ingest = React.useCallback((sample: TelemetrySample) => {
    setFrame(sample);
    setHistory((prev) => {
      const next = prev.length >= HISTORY_MAX ? prev.slice(1) : prev.slice();
      next.push(sample);
      return next;
    });
    // Decima o log da sessão para 1 Hz.
    if (sample.t - lastLogAt.current >= 1000) {
      lastLogAt.current = sample.t;
      setSessionLog((prev) => {
        const next = prev.length >= SESSION_MAX ? prev.slice(1) : prev.slice();
        next.push(sample);
        return next;
      });
    }
  }, []);

  // Conexão / geração de dados conforme o modo.
  React.useEffect(() => {
    let cancelled = false;

    if (mode === "mock") {
      setStatus("mock");
      const sim = new TelemetrySimulator({ injectAlgae: true });
      const id = window.setInterval(() => {
        const now = Date.now();
        ingest({ t: now, ...sim.next(now) });
      }, SAMPLE_INTERVAL_MS);
      return () => {
        cancelled = true;
        window.clearInterval(id);
      };
    }

    // mode === "live"
    let ws: WebSocket | null = null;
    let reconnect: number | undefined;
    setStatus("connecting");

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        setStatus("disconnected");
        reconnect = window.setTimeout(connect, 2000);
        return;
      }
      ws.onopen = () => !cancelled && setStatus("live");
      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(ev.data);
          if (isTelemetryFrame(data)) ingest({ t: Date.now(), ...data });
        } catch {
          /* quadro malformado: ignora */
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus("disconnected");
        reconnect = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnect) window.clearTimeout(reconnect);
      ws?.close();
    };
  }, [mode, ingest]);

  const setMode = React.useCallback((m: TelemetryMode) => {
    window.localStorage.setItem(MODE_KEY, m);
    setModeState(m);
  }, []);

  const resetSession = React.useCallback(() => {
    setHistory([]);
    setSessionLog([]);
    setSessionStart(Date.now());
    lastLogAt.current = 0;
  }, []);

  const requestStation = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setStation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setStation(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const current = frame ?? emptyFrame();
  const health = vesselHealth(current);
  const distance_m =
    station && frame && frame.gps.fix
      ? haversine(station.lat, station.lng, frame.gps.lat, frame.gps.lng)
      : null;

  const value: TelemetryContextValue = {
    frame,
    history,
    sessionLog,
    status,
    mode,
    setMode,
    health,
    station,
    distance_m,
    requestStation,
    sessionStart,
    resetSession,
  };

  return (
    <TelemetryContext.Provider value={value}>
      {children}
    </TelemetryContext.Provider>
  );
}

/** Acessa o contexto de telemetria. Lança fora do provider. */
export function useTelemetry(): TelemetryContextValue {
  const ctx = React.useContext(TelemetryContext);
  if (!ctx)
    throw new Error("useTelemetry deve ser usado dentro de <TelemetryProvider>");
  return ctx;
}
