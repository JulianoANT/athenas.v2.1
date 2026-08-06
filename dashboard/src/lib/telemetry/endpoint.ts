// =============================================================================
//  Resolucao do endpoint WebSocket.
//
//  ARQUITETURA v2.2 — o dashboard NAO fala com o barco. Ele fala com o MESTRE
//  em terra, que recebe a telemetria por LoRa e a remonta no contrato JSON:
//
//      ESCRAVO (barco) --LoRa 915MHz--> MESTRE (terra) --WiFi AP--> DASHBOARD
//
//  O mestre sobe um Access Point proprio ("Athenas-Base") e serve o WebSocket
//  em ws://192.168.4.1/ws — o IP padrao de SoftAP do ESP32. Como e fixo por
//  construcao, nao ha nada a descobrir em campo.
//
//  Ordem de precedencia:
//    1. Endereco salvo pela tripulacao na UI (localStorage) — tem a palavra
//       final, para cobrir qualquer arranjo de rede improvisado na prova.
//    2. VITE_TELEMETRY_WS do .env — util para bancada/CI.
//    3. ws://192.168.4.1/ws — o AP do mestre.
// =============================================================================

const ENDPOINT_KEY = "athenas:ws-endpoint";

/**
 * Nome mDNS publicado pelo mestre. Funciona nos DOIS modos de rede (estacao e
 * ponto de acesso), entao e o endereco preferencial: nao muda quando o roteador
 * troca o IP nem quando o receptor cai para o modo de campo.
 */
export const MDNS_ENDPOINT = "ws://athenas.local/ws";

/** Endereco fixo do mestre quando ele cria a propria rede (modo de campo). */
export const AP_ENDPOINT = "ws://192.168.4.1/ws";

/**
 * Endereco padrao antes de qualquer descoberta.
 *
 * Deliberadamente o mDNS, e nao o IP do AP: o modo de bancada (mestre dentro da
 * rede do laboratorio) e onde a equipe passa 90% do tempo, e ali o IP e
 * atribuido por DHCP — nao ha endereco fixo para chutar.
 */
export const DEFAULT_ENDPOINT = MDNS_ENDPOINT;

/**
 * Candidatos testados pela DESCOBERTA AUTOMATICA, em ordem de preferencia.
 *
 * O motivo de existir: o mestre muda de endereco conforme o modo de rede, e
 * exigir que a tripulacao descubra e digite o IP certo — na beira do rio, com
 * pressa — e um jeito garantido de perder a prova por um detalhe de
 * configuracao. O painel tenta os enderecos possiveis sozinho e fica no que
 * responder.
 */
export const DISCOVERY_CANDIDATES: readonly string[] = [
  MDNS_ENDPOINT, // estacao ou campo: o nome vale nos dois
  AP_ENDPOINT,   // campo, caso o mDNS nao resolva no aparelho
];

const ENV_ENDPOINT = import.meta.env.VITE_TELEMETRY_WS as string | undefined;

/**
 * Normaliza o que a tripulacao digitar. Aceita as formas praticas de campo:
 *   "192.168.0.50"            -> ws://192.168.0.50/ws
 *   "192.168.0.50:81"         -> ws://192.168.0.50:81/ws
 *   "athenas.local"           -> ws://athenas.local/ws
 *   "ws://192.168.0.50/ws"    -> inalterado
 *   "http://192.168.0.50"     -> ws://192.168.0.50/ws
 */
export function normalizeEndpoint(input: string): string {
  const raw = input.trim();
  if (!raw) return DEFAULT_ENDPOINT;

  let value = raw;

  // Troca esquemas HTTP pelos equivalentes WebSocket.
  if (value.startsWith("https://")) value = "wss://" + value.slice(8);
  else if (value.startsWith("http://")) value = "ws://" + value.slice(7);
  else if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
    value = "ws://" + value;
  }

  try {
    const parsed = new URL(value);
    // Sem caminho (ou apenas "/") -> aplica o caminho do firmware.
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = "/ws";
    }
    return parsed.toString();
  } catch {
    return DEFAULT_ENDPOINT;
  }
}

/**
 * true quando a tripulacao fixou um endereco na interface.
 *
 * Uma escolha explicita desliga a descoberta automatica: se alguem digitou um
 * IP, e porque sabe de algo que o painel nao sabe.
 */
export function hasSavedEndpoint(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENDPOINT_KEY) !== null;
}

/** Endpoint efetivo a ser usado nesta sessao. */
export function readEndpoint(): string {
  if (typeof window === "undefined") return DEFAULT_ENDPOINT;

  const saved = window.localStorage.getItem(ENDPOINT_KEY);
  if (saved) return normalizeEndpoint(saved);

  if (ENV_ENDPOINT) return normalizeEndpoint(ENV_ENDPOINT);

  return DEFAULT_ENDPOINT;
}

/** Persiste o endereco escolhido pela tripulacao. */
export function saveEndpoint(input: string): string {
  const normalized = normalizeEndpoint(input);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ENDPOINT_KEY, normalized);
  }
  return normalized;
}

/** Volta ao padrao (mDNS / .env), esquecendo o que foi salvo na UI. */
export function clearEndpoint(): string {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ENDPOINT_KEY);
  }
  return readEndpoint();
}

/** Host legivel (sem esquema nem caminho) para exibir na interface. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
