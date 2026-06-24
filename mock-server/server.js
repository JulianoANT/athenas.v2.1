// Servidor WebSocket do mock Athenas.
//
// Faz broadcast do contrato de telemetria a 5 Hz (200 ms) para todos os
// clientes conectados, permitindo rodar o dashboard sem o ESP32 a bordo.

import { WebSocketServer } from "ws";
import { next } from "./sim.js";

const PORT = process.env.PORT || 8080;
const INTERVAL_MS = 200; // 5 Hz, cravado com o GPS.

const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
  console.log(
    `[athenas-mock] WebSocket ouvindo em ws://0.0.0.0:${PORT} (broadcast a ${
      1000 / INTERVAL_MS
    } Hz)`,
  );
});

wss.on("connection", (ws, req) => {
  const peer = req.socket.remoteAddress ?? "desconhecido";
  console.log(
    `[athenas-mock] cliente conectado (${peer}) -> ${wss.clients.size} ativo(s)`,
  );

  ws.on("close", () => {
    console.log(
      `[athenas-mock] cliente desconectado (${peer}) -> ${wss.clients.size} ativo(s)`,
    );
  });

  ws.on("error", (err) => {
    console.error(`[athenas-mock] erro no cliente (${peer}):`, err.message);
  });
});

wss.on("error", (err) => {
  console.error("[athenas-mock] erro no servidor:", err.message);
});

// Loop de broadcast: gera um quadro e envia para cada cliente aberto.
const timer = setInterval(() => {
  if (wss.clients.size === 0) return; // nada a fazer sem clientes.
  const payload = JSON.stringify(next(Date.now()));
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}, INTERVAL_MS);

// Encerramento limpo.
function shutdown(signal) {
  console.log(`[athenas-mock] recebido ${signal}, encerrando...`);
  clearInterval(timer);
  for (const client of wss.clients) client.terminate();
  wss.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
