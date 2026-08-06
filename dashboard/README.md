# Athenas OS — Dashboard

Frontend da **Central de Telemetria Athenas v2.1** (DUNA 2026): um PWA que recebe
a telemetria da embarcação a **5 Hz** e a transforma em navegação tática,
diagnóstico térmico preditivo, análise energética e relatórios técnicos.

> Visão geral do sistema completo (firmware, contrato, arquitetura) no
> [README da raiz](../README.md).

> **Não há modo de simulação.** Todo valor exibido vem do ESP32 a bordo. Sem o
> barco transmitindo, os indicadores ficam em `--` e o painel informa
> *"Aguardando a embarcação"*.

---

## Stack

- **React 19** + **React Router 7** (HashRouter)
- **Vite 8** (dev server e build)
- **Tailwind CSS 4** + **shadcn/ui** (Radix)
- **Zustand 5** — estado de telemetria com seletores granulares
- **uPlot** — séries temporais de alta cadência em Canvas
- **Three.js** + **React Three Fiber** + **drei** — horizonte artificial 3D
- **react-leaflet 5** — carta hidrográfica e vetor de predição
- **SheetJS (xlsx)**, **jsPDF** + **jspdf-autotable**, **html2canvas** — exportação client-side
- **TypeScript** estrito

---

## Como rodar

```bash
npm install
npm run dev -- --host    # Vite em http://localhost:5173, escutando na rede
```

O `--host` faz o Vite escutar em todas as interfaces, então o tablet e o celular
da equipe abrem o painel pelo IP do notebook durante os testes de campo.

Faça login e, na **engrenagem** ao lado do indicador de conexão, informe o IP do
ESP32 (ou deixe `athenas.local`).

### Scripts npm

| Script            | Ação                                                        |
| ----------------- | ----------------------------------------------------------- |
| `npm run dev`     | Servidor de desenvolvimento com HMR.                        |
| `npm run build`   | Type-check (`tsc -b`) + build de produção (`vite build`).   |
| `npm run preview` | Serve o build de produção localmente.                       |
| `npm run lint`    | ESLint.                                                     |
| `npm run tiles`   | **Baixa a carta offline da raia** (rode antes da prova).     |

---

## Carta offline — obrigatória antes da prova

Na prova o notebook fica na rede do receptor LoRa (`Athenas-Base`), que **não
tem internet**. Sem a carta cacheada, o mapa do Passadiço abre em branco: a
posição, a trilha e o vetor de predição continuam corretos (é tudo calculado no
cliente), mas sem fundo cartográfico ninguém relaciona o barco com a margem.

```bash
npm run tiles
```

Baixa **346 tiles (~6 MB)** da área das Lagoas do Complexo Expoville para
`public/tiles/`, que entram no build. Leva ~6 minutos — o script se limita a
1 requisição por segundo por respeito à política de uso do OpenStreetMap.

| Comando | Efeito |
|---|---|
| `npm run tiles` | Baixa o que falta (pula o que já está em disco) |
| `npm run tiles -- --dry-run` | Só estima quantidade, tamanho e tempo |
| `npm run tiles -- --max-zoom 19` | Detalhe máximo: 1246 tiles, ~22 MB, ~21 min |
| `npm run tiles -- --force` | Rebaixa tudo |

O mapa mostra um selo no canto informando a fonte em uso — **Carta offline** ou
**Carta online**. Se o cache não existir, aparece um aviso explícito: sem ele, a
equipe testaria na bancada com internet, veria o mapa perfeito e só descobriria
o problema na beira do rio.

### Mudou o local da prova?

A área é definida em **um único lugar**:
[`src/lib/map/race-area.ts`](src/lib/map/race-area.ts). Altere o `RACE_BBOX` e o
`RACE_CENTER` ali, replique o bbox no topo de
[`scripts/fetch-tiles.mjs`](scripts/fetch-tiles.mjs) e rode `npm run tiles` de
novo.

### Outra fonte de tiles

A política do OpenStreetMap **desencoraja download em massa para uso offline**.
Para uma área pequena com 1 req/s o volume é irrisório, mas se a equipe preferir
uma fonte que autorize cache explicitamente, troque `TILE_SOURCE` no script —
MapTiler, Stadia Maps e Thunderforest têm plano gratuito que permite.

---

## Variáveis de ambiente

Lidas pelo Vite (prefixo `VITE_` obrigatório):

| Variável            | Padrão                   | Descrição |
| ------------------- | ------------------------ | --------- |
| `VITE_TELEMETRY_WS` | `ws://athenas.local/ws`  | Endpoint WebSocket do ESP32. É apenas o **padrão** — a tripulação pode trocar em tempo de execução pela engrenagem no topo, e a escolha (salva em `localStorage`) tem precedência. |
| `ATHENAS_BASE`      | `/`                      | Caminho base do deploy. Só o GitHub Pages precisa de subcaminho; o workflow define `/athenas.v2.0/`. Não é `VITE_` porque é lido pelo `vite.config.ts`, não pelo app. |

Veja [`.env.example`](../.env.example) na raiz.

---

## Estrutura de `src/`

```
src/
├── main.tsx                 Entry point; monta Theme/Auth + TelemetryBridge
├── App.tsx                  Boot → Login → Shell (sidebar, header, rotas)
├── index.css                Tema (Tailwind 4, variáveis Sol/Noite)
├── routes/                  Árvore de navegação (abas, flag crewOnly)
├── types/
│   └── telemetry.ts         Contrato JSON canônico v2.1 (espelha o firmware)
├── lib/
│   ├── math/
│   │   ├── KalmanFilter2D.ts        Suavização da trajetória GPS (roda no Worker)
│   │   ├── GeoMath.ts               Problema Direto da Geodésia (vetor de predição)
│   │   ├── ThermalPredictor.ts      Gêmeo Digital Térmico (Euler + observador)
│   │   ├── thermal-calibration.ts   Persistência e procedimento de calibração de α/β
│   │   └── hydrodynamics.ts         P_in = V·I, W/nó, cavitação, declinação magnética
│   ├── telemetry/
│   │   ├── contract.ts              Limiares e parser defensivo do quadro
│   │   ├── telemetry.worker.ts      Web Worker: WebSocket + JSON.parse + Kalman
│   │   ├── store.ts                 Store Zustand (fatias primitivas)
│   │   ├── selectors.ts             Hooks de seleção granular ← USE ESTES
│   │   ├── history.ts               Buffers circulares colunares (Float64Array)
│   │   ├── endpoint.ts              Resolução do endereço do ESP32
│   │   └── bridge.tsx               Ciclo de vida do Worker + tique térmico
│   ├── auth.tsx             Login Público/Tripulação (Sigilo Tático)
│   ├── theme.tsx            Tema Sol/Noite
│   └── export/              Athenas Log: metrics.ts, spreadsheet.ts, report.ts
├── components/
│   ├── nav/                 Bússola vetorial, horizonte 3D, leitura de atitude
│   ├── thermal/             Gêmeo térmico, alerta de fusão, calibração
│   ├── charts/live-chart    Séries temporais em Canvas (uPlot)
│   └── ui/                  shadcn/ui
├── hooks/                   Hooks utilitários (ex.: use-mobile)
└── pages/
    ├── dashboard/           Visão Geral
    ├── passadico/           Passadiço & Navegação (mapa tático, cronômetro)
    ├── maquinas/            Casa de Máquinas
    ├── prontuario/          Prontuário & Diagnósticos
    └── exportar/            Athenas Log
```

---

## Regras de performance (não quebre estas)

A telemetria a 5 Hz é implacável com padrões ingênuos de React. Ao mexer no
código, respeite:

1. **Nunca** faça `useTelemetryStore(s => s.frame)` num componente que só precisa
   de um valor. Use os hooks de [`selectors.ts`](src/lib/telemetry/selectors.ts) —
   eles devolvem primitivos, e o Zustand faz *bailout* por `Object.is`.
2. **Nunca** use `useState` para animar algo a 5 Hz ou mais. Dentro de `useFrame`
   (Three.js), leia com `useTelemetryStore.getState()` — leitura **sem
   assinatura** — e mute a propriedade direto.
3. **Nunca** ponha séries temporais longas em componentes SVG. Use
   [`LiveChart`](src/components/charts/live-chart.tsx), que desenha em Canvas e se
   alimenta por assinatura imperativa, sem re-render do React.
4. **Nunca** guarde histórico em estado do React. Use os buffers circulares de
   [`history.ts`](src/lib/telemetry/history.ts).
5. Camadas de mapa que mudam a cada quadro (marcador, trilha, vetor) são mutadas
   **imperativamente** dentro de `VesselLayer`, não via componentes declarativos
   do react-leaflet.

---

## Login (Sigilo Tático)

Gate de UI (`lib/auth.tsx`), **não** controle de acesso server-side:

- **Avaliador / Público**: métricas básicas de conformidade.
- **Tripulação Athenas**: senha tática desbloqueia **Prontuário & Diagnósticos**,
  a calibração térmica e o **Athenas Log** (rotas com `crewOnly`). Nunca commite
  uma senha real.

---

## Temas

`lib/theme.tsx` alterna entre **Noite** (navy/ciano, classe `.dark` do Tailwind)
e **Sol** (alto contraste para luz solar direta). A preferência é persistida em
`localStorage` e aplicada via `data-theme` no `<html>`.

---

## Responsividade

Testado sem rolagem horizontal em **375 px** (celular), **768 px** (tablet) e
desktop, em todas as abas. Alvos de toque ≥ 44 px, header fixo, controles do
Leaflet ampliados no celular e `safe-area-inset` para aparelhos com notch.
