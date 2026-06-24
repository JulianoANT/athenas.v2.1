# Athenas OS — Dashboard

Frontend da **Central de Telemetria Athenas v2.0** (DUNA 2026): um PWA que recebe
a telemetria da embarcação a **5 Hz** e a transforma em navegação, diagnóstico
térmico, análise energética e relatórios técnicos.

> Visão geral do sistema completo (firmware, contrato, arquitetura) no
> [README da raiz](../README.md).

---

## Stack

- **React 19** + **React Router 7** (HashRouter)
- **Vite 8** (dev server e build)
- **Tailwind CSS 4** + **shadcn/ui** (Radix)
- **Recharts** — gráficos de telemetria
- **Leaflet** — mapa de navegação em tempo real
- **SheetJS (xlsx)**, **jsPDF** + **jspdf-autotable**, **html2canvas** — exportação client-side
- **TypeScript** estrito

---

## Como rodar

```bash
npm install
npm run dev      # servidor de desenvolvimento (Vite, http://localhost:5173)
```

O dashboard inicia em **modo Simulação 5 Hz** — funciona sem hardware e sem
back-end, com os dados gerados no próprio navegador.

### Scripts npm

| Script            | Ação                                                        |
| ----------------- | ----------------------------------------------------------- |
| `npm run dev`     | Servidor de desenvolvimento com HMR.                        |
| `npm run build`   | Type-check (`tsc -b`) + build de produção (`vite build`).   |
| `npm run preview` | Serve o build de produção localmente.                       |
| `npm run lint`    | ESLint.                                                     |

---

## Variável de ambiente

Lida pelo Vite (prefixo `VITE_` obrigatório):

| Variável             | Padrão                | Descrição                                                       |
| -------------------- | --------------------- | -------------------------------------------------------------- |
| `VITE_TELEMETRY_WS`  | `ws://<host>:8080`    | Endpoint WebSocket usado no modo **Ao vivo**. Aponte para o ESP32 (produção) ou o mock-server (dev). |

Sem essa variável, o modo Ao vivo deriva o endpoint do host atual (`ws`/`wss` +
hostname + porta `8080`). Veja [`.env.example`](../.env.example) na raiz.

---

## Estrutura de `src/`

```
src/
├── main.tsx                 Entry point; monta Theme/Auth/Telemetry providers
├── App.tsx                  Boot → Login → Shell (sidebar, header, rotas)
├── index.css                Tema (Tailwind 4, variáveis Sol/Noite)
├── routes/                  Árvore de navegação (abas, flag crewOnly)
├── types/
│   └── telemetry.ts         Contrato JSON canônico (espelha firmware + mock)
├── lib/
│   ├── telemetry/
│   │   ├── contract.ts      Limiares e modelos da Diretriz (saúde, bateria, algas, Haversine)
│   │   ├── simulator.ts     Simulador de física 5 Hz (modo Mock)
│   │   └── provider.tsx     TelemetryProvider: WebSocket/sim, histórico, sessão
│   ├── auth.tsx             Login Público/Tripulação (Sigilo Tático)
│   ├── theme.tsx            Tema Sol/Noite
│   └── export/              Athenas Log: metrics.ts, spreadsheet.ts, report.ts
├── components/              Sidebar, badges, Sereia, boot, login-gate, gauge, ui/ (shadcn)
├── hooks/                   Hooks utilitários (ex.: use-mobile)
├── mocks/                   Dados estáticos de apoio
└── pages/
    ├── dashboard/           Visão Geral
    ├── passadico/           Passadiço & Navegação (mapa, cronômetro)
    ├── maquinas/            Casa de Máquinas
    ├── prontuario/          Prontuário & Diagnósticos (térmica/estrutural)
    └── exportar/            Athenas Log
```

---

## Modos de telemetria

O badge no topo alterna a fonte de dados (preferência persistida em
`localStorage`); a lógica vive em `lib/telemetry/provider.tsx`:

- **Simulação · 5 Hz** (Mock): física gerada client-side por `simulator.ts`
  (arrasto por leme, aquecimento do estator, descarga da bateria, evento de
  algas). Não requer rede.
- **Ao vivo · 5 Hz**: conecta em `VITE_TELEMETRY_WS`, valida cada quadro contra o
  contrato e reconecta automaticamente a cada 2 s se a conexão cair.

O provider mantém o último quadro, um **histórico em alta taxa** (~6 min para os
gráficos) e um **log de sessão decimado a 1 Hz** (~2 h) usado na exportação.

---

## Login (Sigilo Tático)

Gate de UI (`lib/auth.tsx`), **não** controle de acesso server-side:

- **Avaliador / Público**: só métricas básicas (Passadiço, Casa de Máquinas).
- **Tripulação Athenas**: senha tática desbloqueia **Prontuário & Diagnósticos**
  e o **Athenas Log** (rotas com `crewOnly`). Nunca commite uma senha real — ela
  pode ser configurada em build.

---

## Temas

`lib/theme.tsx` alterna entre **Noite** (navy/ciano, classe `.dark` do Tailwind)
e **Sol** (alto contraste para luz solar direta). A preferência é persistida em
`localStorage` e aplicada via `data-theme` no `<html>`.
