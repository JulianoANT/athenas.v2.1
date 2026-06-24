/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do WebSocket de telemetria ao vivo (ESP32 ou mock-server). */
  readonly VITE_TELEMETRY_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
