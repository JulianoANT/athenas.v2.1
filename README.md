# Athenas — Central de Telemetria v2.2

Sistema de telemetria em tempo real para a embarcação autônoma da **Equipe
Athenas**, desenvolvido para a competição **DUNA 2026**.

O coração do projeto é o **Athenas OS**: um dashboard PWA que recebe a
telemetria do barco por **rádio LoRa** e a transforma em navegação tática,
diagnóstico térmico preditivo, análise energética e relatórios técnicos.

> **Não há modo de simulação.** Todo valor exibido vem do hardware. Sem o barco
> transmitindo, os indicadores ficam em `--` e o painel informa *"Aguardando a
> embarcação"*. Um número inventado num painel de prova é pior que número
> nenhum: cria confiança falsa.

---

## Visão geral

O barco navega a centenas de metros no rio — muito além do alcance de WiFi. O
enlace é **LoRa em 915 MHz**, com um segundo ESP32 em terra fazendo a ponte:

```
┌──────────────────┐    LoRa 915 MHz     ┌──────────────────┐   WiFi AP    ┌──────────┐
│     ESCRAVO      │   39 bytes @ 5 Hz   │      MESTRE      │  WebSocket   │    PC    │
│   (no barco)     │ ──────────────────▶ │   (com a equipe) │ ───────────▶ │ Athenas  │
│                  │                     │                  │              │    OS    │
│ MPU6050 (atitude)│                     │ valida CRC       │              │          │
│ GPS Neo-6M @5 Hz │                     │ remonta o JSON   │              │ Worker   │
│ ACS758 (corrente)│                     │ RSSI/SNR no OLED │              │ ├ Kalman │
│ Divisor (tensão) │                     │                  │              │ Zustand  │
│ DS18B20 (estator)│                     │ AP "Athenas-Base"│              │ ├ Térmico│
│ DHT22 (ambiente) │                     │  192.168.4.1     │              │ ├ Predição│
│ PWM tap (leme)   │                     │                  │              │ └ W/nó   │
└──────────────────┘                     └──────────────────┘              └──────────┘
   Heltec V3 (ESP32-S3 + SX1262)          Heltec V3 (ESP32-S3 + SX1262)
```

**O dashboard não sabe que existe um rádio no caminho.** O mestre remonta o
contrato JSON em terra, byte a byte igual ao que o barco enviaria diretamente.
Isso mantém todo o software independente da camada de transporte.

### Por que binário no ar

O contrato JSON tem ~400 bytes; a 5 Hz são 16 kbps. O LoRa em SF7/BW125 entrega
**5,4 kbps brutos**. Empacotando em campos de largura fixa, o mesmo quadro cabe
em **39 bytes** — 10× menor. Detalhes e tabela de alcance × taxa em
[`firmware/README.md`](firmware/README.md).

---

## Arquitetura de alta performance

A telemetria a 5 Hz gera um volume que quebra a abordagem ingênua de React. As
decisões abaixo não são estilísticas — cada uma resolve um gargalo medido.

| Decisão | Substituiu | Por quê |
|---|---|---|
| **Zustand** com seletores primitivos | `React.Context` | Um Context propaga qualquer mudança para **todos** os consumidores. A 5 Hz, o gráfico do motor re-renderizava o mapa, o horizonte 3D e a bússola, 5×/s. Com seletores primitivos o Zustand faz *bailout* por `Object.is`. |
| **Web Worker** dono do WebSocket | parsing na main thread | A main thread nunca vê uma string, nunca chama `JSON.parse` e nunca gerencia reconexão — sobra 100% do orçamento de 16 ms para pintar a interface. |
| **uPlot** (Canvas) | Recharts (SVG) | SVG cria **um nó do DOM por ponto**. 30 min × 5 Hz × 4 séries ≈ 36.000 elementos. O uPlot desenha em um `<canvas>`: custo proporcional aos pixels, não aos pontos. |
| **Buffers circulares** (`Float64Array`) | `useState<Sample[]>` | Zero alocação no caminho quente. O layout colunar é exatamente o que o uPlot consome. |
| **`useFrame` + `getState()`** no 3D | `useState` para rotação | Leitura **sem assinatura** dentro do loop de animação, mutando `mesh.rotation` direto. O DOM virtual fica intacto; só a GPU trabalha. |
| **`React.lazy`** no Three.js | bundle único | Three + R3F + drei somam ~900 kB. Viravam custo fixo de toda visita, inclusive no celular em 4G na beira do lago. |

Regra prática para a equipe: **nunca** faça `useTelemetryStore(s => s.frame)` num
componente que só precisa da velocidade. Use `useSpeedKnots()`. Ver
[`selectors.ts`](dashboard/src/lib/telemetry/selectors.ts).

---

## Motores matemáticos (client-side)

| Módulo | O que resolve |
|---|---|
| [`KalmanFilter2D.ts`](dashboard/src/lib/math/KalmanFilter2D.ts) | Suaviza o *multipath* do Neo-6M. Modelo de velocidade constante em coordenadas locais ENU (metros, não graus — 1° de longitude encolhe com `cos(lat)`). Roda **dentro do Worker**. |
| [`GeoMath.ts`](dashboard/src/lib/math/GeoMath.ts) | **Problema Direto da Geodésia**: projeta onde o barco **estará**. `φ₂ = arcsin(sin φ₁·cos δ + cos φ₁·sin δ·cos θ)`. A linha tracejada vermelha no mapa. |
| [`ThermalPredictor.ts`](dashboard/src/lib/math/ThermalPredictor.ts) | **Gêmeo Digital Térmico**: `dT/dt = α·I² − β·(T − T_amb)` por Euler, mais um observador de Luenberger que impede deriva por calibração imperfeita. |
| [`hydrodynamics.ts`](dashboard/src/lib/math/hydrodynamics.ts) | `P_in = V_bat · I_mot`, consumo específico em **W/nó**, detector de cavitação/arrasto e correção de declinação magnética. |

### O Gêmeo Digital Térmico

O DS18B20 fica na carcaça, não no enrolamento. Entre o cobre esquentar e o
sensor registrar existem dezenas de segundos de inércia. Quando o painel mostra
70 °C, o núcleo já pode estar em 85 °C.

O painel mostra as duas temperaturas: **branco** = sensor físico (verdade
medida, atrasada); **laranja neon** = núcleo virtual (previsão, imediata). Se a
projeção indicar 90 °C nos próximos 30 s, dispara o alerta global *"Risco de
fusão do estator iminente — reduza a manete"*.

Validado em bancada: o alerta disparou com o sensor físico ainda marcando
**63,3 °C** (seguro) enquanto o núcleo virtual já estava em 69,4 °C subindo sob
48 A.

> **α e β precisam ser calibrados no seu conjunto motriz.** Os padrões são
> estimativas. Procedimento em
> [`firmware/onboard/README.md`](firmware/onboard/README.md#passo-5--calibração-do-gêmeo-térmico),
> ajustável pela tela *Prontuário → Calibração do Gêmeo Térmico* sem recompilar.

---

## Contrato JSON v2.1

O **mestre** publica exatamente este payload a cada quadro recebido do barco:

```json
{
  "gps":     { "lat": 0, "lng": 0, "speed_kmh": 0, "cog": 0,
               "fix": true, "sats": 9, "hdop": 1.2 },
  "imu":     { "roll": 0, "pitch": 0, "yaw": 0,
               "accel_x": 0, "accel_y": 0, "accel_z": 1 },
  "sensors": { "current_a": 0, "voltage_v": 0, "temp_c": 0, "rudder_deg": 0 },
  "ambient": { "temp_c": 0, "humidity": 0 },
  "status":  { "algae_alert": false, "overheat_alert": false,
               "battery_low": false },
  "faults":  { "gps": false, "imu": false,
               "motor_temp": false, "ambient": false },
  "link":    { "rssi": -78, "snr": 9.5, "lost": 12, "corrupt": 0,
               "boat_seq": 4821 },
  "seq": 0,
  "uptime_ms": 0
}
```

**`faults`** implementa o "Tratamento de Dados Fantasmas": o firmware nunca
envia leitura corrompida — retém o último valor válido e levanta a flag. A aba
*Prontuário* mostra o estado de cada sensor.

**`link`** é a qualidade do rádio, medida pelo mestre ao demodular cada pacote.
Note que há **dois** contadores de perda, medindo enlaces diferentes:

- `link.lost` → perdas **no ar** (LoRa): alcance, antena, obstrução.
- lacunas em `seq` → perdas entre **mestre e PC** (WiFi da margem).

Separar os dois é o que permite saber de que lado está o problema.

Contrato canônico: [`telemetry.ts`](dashboard/src/types/telemetry.ts) ·
Limiares e parser: [`contract.ts`](dashboard/src/lib/telemetry/contract.ts).

---

## Estrutura de pastas

```
Athenas/
├── dashboard/          Frontend Athenas OS (React 19 + Vite + Tailwind 4)
│   └── src/
│       ├── lib/math/       Kalman, geodésia, térmica, hidrodinâmica
│       ├── lib/telemetry/  Worker, store Zustand, buffers, seletores
│       ├── components/     nav/ (bússola, horizonte 3D), thermal/, charts/
│       └── pages/          Visão Geral, Passadiço, Máquinas, Prontuário, Log
├── firmware/
│   ├── onboard/        ESCRAVO — sensores + transmissão LoRa (Heltec V3)
│   ├── receiver/       MESTRE  — recepção LoRa + WebSocket (Heltec V3)
│   └── shared/         Protocolo binário compartilhado pelos dois
├── server/             Papel de relay — cumprido pelo próprio ESP32
├── app/                Aplicativo móvel (futuro)
├── docker-compose.yml  Sobe o dashboard
└── .env.example        VITE_TELEMETRY_WS
```

---

## Como rodar

### Com o hardware (o caminho normal)

1. Grave as **duas** placas — ver [`firmware/README.md`](firmware/README.md):

```bash
cd firmware/onboard  && pio run -t upload    # escravo (vai no barco)
cd firmware/receiver && pio run -t upload    # mestre (fica com a equipe)
```

2. Ligue as duas. **Confira as antenas conectadas antes de energizar** —
   transmitir sem antena danifica o SX1262.
3. No notebook, conecte-se à rede WiFi **`Athenas-Base`** (senha
   `athenas2026`), criada pelo mestre.
4. Suba o painel:

```bash
cd dashboard && npm install && npm run dev -- --host
```

O endereço padrão já é `ws://192.168.4.1/ws` — não precisa configurar nada. O
`--host` faz o Vite escutar em todas as interfaces, então o tablet e o celular
da equipe abrem o painel pelo IP do notebook.

### Docker

```bash
docker compose up --build
```

Sobe o dashboard em `http://localhost:5173`. O container precisa alcançar a rede
onde o ESP32 está — em Docker Desktop (Mac/Windows) prefira `npm run dev`
durante os testes de campo.

### ⚠️ GitHub Pages não conecta no barco

O Pages serve por **HTTPS**, e navegadores **bloqueiam** conexões `ws://` a
partir de páginas `https://` (regra de *mixed content*). Como o ESP32 fala
`ws://` puro, o painel publicado no Pages serve apenas como vitrine estática.
**Para operação real, sirva por HTTP na rede local.**

---

## Athenas OS — guia de uso

### Login: Avaliador/Público vs Tripulação

Gate de UI para **Sigilo Tático** durante a prova (não é controle de acesso
server-side):

- **Avaliador / Público**: métricas básicas de conformidade.
- **Tripulação Athenas**: analítica completa, gráficos de arrasto, calibração
  térmica e o Athenas Log. Requer senha tática.

### Tema: Sol / Noite

**Noite** é o navy/ciano padrão. **Sol** usa alto contraste cromático para
legibilidade sob luz solar direta na margem do lago.

### As abas

| Aba | Foco |
|---|---|
| **Visão Geral** | KPIs, bússola, atitude do casco e séries temporais em canvas. |
| **Passadiço & Navegação** | Mapa tático com **vetor de predição de rota**, rosa dos ventos com declinação magnética, horizonte artificial 3D, cronômetro náutico. |
| **Casa de Máquinas** | Velocímetro, **eficiência hidrodinâmica (W/nó)**, gêmeo térmico, comparativo de arrasto leme×corrente, saúde da bateria. |
| **Prontuário & Diagnósticos** *(tripulação)* | Controle de danos térmicos com alarme sonoro, avatar estrutural, **saúde de cada sensor**, calibração do gêmeo térmico. |
| **Athenas Log** *(tripulação)* | Exportação 100% client-side: `.xlsx`, `.csv`, `.pdf` e `.png`. |

### A Sereia (saúde da embarcação)

- **Serena** (ciano): sistema nominal estável.
- **Tática** (laranja): alto arrasto — leme > 30° ou corrente > 18 A, ou algas.
- **Alerta** (vermelho): sobrecarga, superaquecimento (≥ 70 °C) ou bateria baixa.

### Responsividade

Testado em **375 px (celular)**, **768 px (tablet)** e desktop, sem rolagem
horizontal em nenhuma aba. Alvos de toque ≥ 44 px, header fixo, controles do
Leaflet ampliados no celular e `safe-area-inset` para aparelhos com notch.

---

## O que já existe vs. a fazer

| Item | Status |
|---|---|
| Contrato JSON v2.1 (firmware ↔ dashboard) | ✅ |
| Firmware do escravo (MPU6050, DHT22, EMA, LoRa TX assíncrono) | ✅ |
| Firmware do mestre (LoRa RX, CRC, remontagem do JSON, AP + WebSocket) | ✅ |
| Protocolo binário de 39 bytes com CRC16 | ✅ |
| Store Zustand + Web Worker de ingestão | ✅ |
| Filtro de Kalman 2D no GPS | ✅ |
| Vetor de predição de rota (geodésia esférica) | ✅ |
| Horizonte artificial 3D (React Three Fiber) | ✅ |
| Rosa dos ventos com declinação magnética | ✅ |
| Gêmeo Digital Térmico + gatilho de fusão + calibração | ✅ |
| Eficiência hidrodinâmica (W/nó) + detector de cavitação | ✅ |
| Gráficos em Canvas (uPlot) | ✅ |
| Athenas Log (xlsx/csv/pdf/png) | ✅ |
| Responsividade PC/tablet/celular | ✅ |
| **Teste de alcance real do LoRa** | ⏳ **fazer antes da prova** |
| Carta offline da raia (cache de tiles + fallback online) | ✅ |
| Replay de sessão (timeline do trajeto) | ⏳ |
| Aplicativo móvel (`app/`) | ⏳ Futuro |

### Calibrações pendentes antes da prova

0. **Baixar a carta offline** — `cd dashboard && npm run tiles`. Sem isso o
   mapa fica em branco na prova, porque a rede do receptor não tem internet.
1. **Declinação magnética** — `MAGNETIC_DECLINATION_DEG` em
   [`hydrodynamics.ts`](dashboard/src/lib/math/hydrodynamics.ts) está em −20,5°
   (Joinville/SC, 2026). Confirme em
   <https://www.ngdc.noaa.gov/geomag/calculators/>.
2. **α e β do gêmeo térmico** — procedimento no README do firmware.
3. **`SEC_NOMINAL_W_PER_KNOT`** — o consumo específico de referência (40 W/nó)
   é um chute; meça o do conjunto real.
4. **Offset do ACS758** — `ACS758_OFFSET_V` no firmware do escravo.
5. **Alcance útil do rádio** — leve o escravo caminhando e anote a distância em
   que a perda passa de 5% (o RSSI aparece no OLED do mestre). É esse número que
   decide se dá para manter 5 Hz ou se é preciso subir o spreading factor. Ver
   [`firmware/README.md`](firmware/README.md#passo-3--alcance-real-faça-antes-da-prova).

---

## Stack

- **Dashboard**: React 19, Vite 8, Tailwind CSS 4, shadcn/ui, Zustand 5,
  Three.js + React Three Fiber, react-leaflet 5, uPlot.
- **Firmware**: ESP32 (Arduino) via PlatformIO — ESPAsyncWebServer, ArduinoJson
  6, TinyGPS++, DallasTemperature/OneWire, DHT.
