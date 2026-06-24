# Athenas Mock Server

Servidor WebSocket em Node que emite o **contrato de telemetria Athenas a 5 Hz
(200 ms)**, permitindo desenvolver e demonstrar o dashboard **sem o ESP32** a
bordo.

A fisica do simulador (`sim.js`) e um porte direto, em JS puro, do simulador
TypeScript do dashboard (`src/lib/telemetry/simulator.ts`): curvas de leme geram
arrasto e picos de corrente, a temperatura do estator sobe com a carga, a
bateria de chumbo-acido descarrega ao longo do tempo e ha um evento periodico de
bloqueio por algas.

- Runtime: **Node 20+**
- Unica dependencia: [`ws`](https://github.com/websockets/ws)
- Modulos: **ESM**

## Contrato emitido

A cada 200 ms o servidor faz broadcast do seguinte JSON para todos os clientes:

```json
{
  "gps": { "lat": 0, "lng": 0, "speed_kmh": 0, "cog": 0, "fix": true },
  "sensors": { "current_a": 0, "voltage_v": 0, "temp_c": 0, "rudder_deg": 0 },
  "status": { "algae_alert": false, "overheat_alert": false, "battery_low": false }
}
```

## Como rodar (local)

```bash
npm install
npm start
```

O servidor sobe em `ws://localhost:8080`. Para usar outra porta:

```bash
PORT=9000 npm start
```

### Teste rapido

```bash
npx wscat -c ws://localhost:8080
```

## Como rodar via Docker

```bash
docker build -t athenas-mock .
docker run --rm -p 8080:8080 athenas-mock
```

Para mudar a porta exposta:

```bash
docker run --rm -e PORT=8080 -p 9000:8080 athenas-mock
```

## Arquivos

| Arquivo          | Funcao                                                        |
| ---------------- | ------------------------------------------------------------ |
| `server.js`      | `WebSocketServer` na porta `PORT` (default 8080); broadcast a 5 Hz; loga conexoes/desconexoes. |
| `sim.js`         | Fisica do simulador portada de TS; exporta `next(now)`.       |
| `package.json`   | Metadados e dependencia `ws`.                                 |
| `Dockerfile`     | Imagem `node:20-alpine`.                                      |
| `.dockerignore`  | Exclui `node_modules` etc. do contexto de build.             |
