# Athenas — Central de Telemetria v2.0

Sistema de telemetria em tempo real para a embarcação autônoma da **Equipe
Athenas**, desenvolvido para a competição **DUNA 2026**.

O coração do projeto é o **Athenas OS**: um dashboard PWA que recebe a
telemetria do barco a **5 Hz** e a transforma em navegação, diagnóstico térmico,
análise energética e relatórios técnicos — com um modo de **Simulação** embutido
que roda sem nenhum hardware.

---

## Visão geral

A embarcação carrega um **ESP32** que lê todos os sensores de bordo (GPS,
corrente, tensão, temperatura, ângulo do leme) e transmite um **contrato JSON**
fixo. O dashboard consome esse fluxo, calcula saúde da embarcação, métricas de
desempenho e exibe tudo em três abas operacionais inspiradas em um navio:
**Passadiço**, **Casa de Máquinas** e **Prontuário**.

```
┌──────────────────────────┐        WebSocket            ┌──────────────────────────┐
│        EMBARCAÇÃO         │      JSON @ 5 Hz (200 ms)   │       ATHENAS OS         │
│  ┌────────────────────┐  │  ───────────────────────▶   │   (Dashboard PWA React)  │
│  │ ESP32 (WiFi STA)   │  │     ws://<esp32>:8080       │                          │
│  │  GPS Neo-6M  @5 Hz │  │                             │  Passadiço & Navegação   │
│  │  ACS758 (corrente) │  │                             │  Casa de Máquinas        │
│  │  Divisor (tensão)  │  │                             │  Prontuário & Diagnóst.  │
│  │  DS18B20 (temp.)   │  │                             │  Athenas Log (export)    │
│  │  PWM tap (leme)    │  │                             │                          │
│  └────────────────────┘  │                             │                          │
└──────────────────────────┘                             └──────────────────────────┘
```

Em produção, o **próprio ESP32** opera em modo **WiFi STA** e serve o WebSocket
diretamente — não há servidor relay intermediário na Diretriz v2.0. Para
desenvolvimento e demonstração sem o barco, um **mock-server** Node emite o mesmo
contrato, e o dashboard ainda possui um simulador 100% client-side.

---

## O contrato JSON de telemetria

A cada **200 ms (5 Hz, cravado com o GPS)** o barco transmite exatamente este
payload. É o contrato único compartilhado entre firmware, mock-server e
dashboard — qualquer mudança deve ser refletida nos três.

```json
{
  "gps":     { "lat": 0, "lng": 0, "speed_kmh": 0, "cog": 0, "fix": true },
  "sensors": { "current_a": 0, "voltage_v": 0, "temp_c": 0, "rudder_deg": 0 },
  "status":  { "algae_alert": false, "overheat_alert": false, "battery_low": false }
}
```

| Campo                  | Tipo    | Significado                                                   |
| ---------------------- | ------- | ------------------------------------------------------------ |
| `gps.lat` / `gps.lng`  | número  | Latitude / longitude em graus decimais                       |
| `gps.speed_kmh`        | número  | Velocidade sobre o solo em km/h (`TinyGPS++.speed.kmh()`)    |
| `gps.cog`              | número  | Course over ground em graus (0–360)                          |
| `gps.fix`              | boolean | `true` quando o módulo tem fix de satélites                  |
| `sensors.current_a`    | número  | Corrente do motor em A (ACS758, média móvel de 12 amostras) |
| `sensors.voltage_v`    | número  | Tensão da bateria de chumbo-ácido em V (divisor resistivo)  |
| `sensors.temp_c`       | número  | Temperatura do estator em °C (DS18B20)                       |
| `sensors.rudder_deg`   | número  | Ângulo do leme em graus (−45 a +45), via tap PWM passivo    |
| `status.algae_alert`   | boolean | Possível bloqueio por algas (anomalia de arrasto)           |
| `status.overheat_alert`| boolean | Superaquecimento do estator (≥ 70 °C)                       |
| `status.battery_low`   | boolean | Bateria em nível crítico                                     |

O contrato canônico em TypeScript vive em
[`dashboard/src/types/telemetry.ts`](dashboard/src/types/telemetry.ts), e os
limiares/modelos da Diretriz em
[`dashboard/src/lib/telemetry/contract.ts`](dashboard/src/lib/telemetry/contract.ts).

---

## Estrutura de pastas

```
Athenas/
├── dashboard/          Frontend Athenas OS (React 19 + Vite + Tailwind)
├── firmware/
│   ├── onboard/        Firmware do ESP32 a bordo (PlatformIO) — WiFi STA + WebSocket
│   └── receiver/       Receptor LoRa separado — LEGADO/futuro (long-range)
├── mock-server/        Servidor WebSocket Node que emite o contrato a 5 Hz (dev/demo)
├── server/             Papel de relay — cumprido pelo ESP32 direto (prod) ou mock-server (dev)
├── app/                Aplicativo móvel (futuro)
├── docker-compose.yml  Sobe dashboard + mock-server
└── .env.example        Variáveis de ambiente (VITE_TELEMETRY_WS, PORT)
```

---

## Como rodar

### (a) Desenvolvimento — dashboard isolado

Já funciona em **modo Simulação 5 Hz, sem hardware e sem back-end**: os dados são
gerados no próprio navegador.

```bash
cd dashboard
npm install
npm run dev
```

Abra o endereço impresso pelo Vite (por padrão `http://localhost:5173`).

### (b) Docker — dashboard + mock-server

A partir da raiz do projeto:

```bash
docker compose up --build
```

Sobe dois serviços:

- **dashboard** em `http://localhost:5173` (Nginx);
- **mock-server** em `ws://localhost:8080`.

O dashboard inicia em modo **Simulação**; ao alternar para **Ao vivo** ele
conecta no mock-server e passa a consumir a telemetria simulada via WebSocket.

### (c) Firmware — ESP32 a bordo

Projeto **PlatformIO** em [`firmware/onboard`](firmware/onboard). Ajuste as
credenciais de WiFi em `src/main.cpp` e compile/grave:

```bash
cd firmware/onboard
pio run -t upload
pio device monitor
```

O ESP32 sobe em WiFi STA e serve o WebSocket em `ws://<ip-do-esp32>:8080`. Aponte
o dashboard para esse endereço via `VITE_TELEMETRY_WS` e use o modo **Ao vivo**.

---

## Athenas OS — guia de uso

### Modos de telemetria: Mock vs Ao vivo

O botão no topo do dashboard alterna a fonte de dados (preferência persistida no
navegador):

- **Simulação · 5 Hz** (Mock): dados gerados client-side. Curvas de leme geram
  arrasto e picos de corrente, o estator aquece sob carga, a bateria descarrega
  e há um evento periódico de bloqueio por algas.
- **Ao vivo · 5 Hz**: conecta no WebSocket (`VITE_TELEMETRY_WS`, padrão
  `ws://<host>:8080`) — o ESP32 em produção ou o mock-server em dev. Reconecta
  automaticamente a cada 2 s se a conexão cair (badge **Sem sinal**).

### Login: Avaliador/Público vs Tripulação

Gate de UI para **Sigilo Tático** durante a prova (não é controle de acesso
server-side):

- **Avaliador / Público**: acesso só às métricas básicas de conformidade
  (Passadiço e Casa de Máquinas).
- **Tripulação Athenas**: ferramentas analíticas completas — desbloqueia
  Prontuário & Diagnósticos e o Athenas Log. Requer **senha tática**.

### Tema: Sol / Noite

- **Noite**: tema navy/ciano padrão (alto contraste em ambiente fechado).
- **Sol**: paleta de alto contraste cromático para legibilidade sob luz solar
  direta na margem do lago.

### A Sereia (saúde da embarcação)

Avatar interativo que sintetiza o **Vessel Health Status** a partir do quadro
atual:

- **Serena** (ciano): sistema nominal estável.
- **Tática** (laranja): alto arrasto — leme > 30° ou corrente > 18 A, ou alerta
  de algas.
- **Alerta** (vermelho): condição crítica — sobrecarga, superaquecimento
  (≥ 70 °C) ou bateria baixa.

### As três abas operacionais

| Aba                          | Foco                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| **Passadiço & Navegação**    | Mapa em tempo real (Leaflet), rumo/COG, velocidade em nós e km/h, trajeto, distância à estação de controle (Haversine), cronômetro de sessão. |
| **Casa de Máquinas**         | Telemetria do conjunto motriz: corrente, tensão e carga da bateria, gráficos de consumo. |
| **Prontuário & Diagnósticos**| (Tripulação) Análise térmica do estator, termômetro, avatar estrutural e alarmes térmicos. |

### Athenas Log (exportação)

Módulo (Tripulação) de exportação **100% client-side**, sem nenhuma chamada de
rede:

- **.xlsx / .csv**: log da sessão decimado a 1 Hz (SheetJS).
- **.pdf**: relatório técnico com métricas da sessão, conclusão automatizada
  sobre a saúde da embarcação e marca d'água institucional (jsPDF).
- **.png**: captura de painéis (html2canvas).

---

## O que já existe vs. a fazer

| Item                                                | Status        |
| --------------------------------------------------- | ------------- |
| Contrato JSON único (firmware ↔ mock ↔ dashboard)   | ✅ Pronto     |
| Dashboard Athenas OS (boot, login, temas, sidebar)  | ✅ Pronto     |
| Modo Simulação 5 Hz (client-side)                   | ✅ Pronto     |
| Modo Ao vivo via WebSocket + reconexão              | ✅ Pronto     |
| Aba Passadiço & Navegação (mapa, rota, cronômetro)  | ✅ Pronto     |
| Aba Casa de Máquinas (corrente/tensão/bateria)      | ✅ Pronto     |
| Aba Prontuário & Diagnósticos (térmica/estrutural)  | ✅ Pronto     |
| Sereia (Vessel Health Status)                       | ✅ Pronto     |
| Aba Athenas Log (export xlsx/csv/pdf/png ligado)    | ✅ Pronto     |
| Firmware ESP32 onboard (WiFi STA + WebSocket 5 Hz)  | ✅ Pronto     |
| Mock-server Node + Docker Compose                   | ✅ Pronto     |
| Cache offline dos tiles do mapa (Parque Expoville)  | ⏳ A fazer (TODO no código) |
| Replay de sessão (timeline do trajeto)              | ⏳ A fazer    |
| IMU (aceleração / inclinação / score de estabilidade)| ⏳ A fazer (sem campo no contrato) |
| Receptor LoRa de longo alcance                      | ⏳ Futuro/legado |
| Aplicativo móvel (`app/`)                           | ⏳ Futuro     |

---

## Stack

- **Dashboard**: React 19, Vite 8, Tailwind CSS 4, shadcn/ui, Recharts, Leaflet.
- **Firmware**: ESP32 (Arduino) via PlatformIO — ESPAsyncWebServer, ArduinoJson,
  TinyGPS++, DallasTemperature/OneWire.
- **Mock-server**: Node 20+ com `ws` (ESM).

Detalhes específicos em cada README:
[`dashboard/`](dashboard/README.md) · [`firmware/onboard/`](firmware/onboard/README.md)
· [`firmware/receiver/`](firmware/receiver/README.md) · [`mock-server/`](mock-server/README.md)
· [`server/`](server/README.md)
# athenas.v2.0
