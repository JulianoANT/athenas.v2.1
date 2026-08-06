// =============================================================================
//  ConnectionBadge — estado do enlace com o ESP32 e configuracao do endereco.
//
//  NAO EXISTE MAIS MODO SIMULACAO. O painel so exibe telemetria real vinda do
//  hardware; se o barco nao estiver transmitindo, o estado e "Sem sinal" e os
//  indicadores ficam em "--". Numero inventado em painel de prova e pior que
//  numero nenhum: cria confianca falsa.
//
//  O popover de configuracao existe porque, na beira do lago, o IP do ESP32
//  muda a cada boot do roteador e ninguem vai recompilar o frontend para
//  corrigir isso.
// =============================================================================

import * as React from "react";
import {
  IconBroadcast,
  IconLoader2,
  IconPlugConnectedX,
  IconSettings,
  IconCheck,
  IconRefresh,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTelemetryStore } from "@/lib/telemetry/store";
import {
  DEFAULT_ENDPOINT,
  endpointHost,
  normalizeEndpoint,
} from "@/lib/telemetry/endpoint";
import type { ConnectionStatus } from "@/types/telemetry";

const META: Record<
  ConnectionStatus,
  {
    label: string;
    short: string;
    variant: "ok" | "warn" | "alert" | "muted";
    Icon: typeof IconBroadcast;
    spin?: boolean;
  }
> = {
  live: {
    label: "Ao vivo",
    short: "Ao vivo",
    variant: "ok",
    Icon: IconBroadcast,
  },
  connecting: {
    label: "Conectando…",
    short: "Conect.",
    variant: "warn",
    Icon: IconLoader2,
    spin: true,
  },
  disconnected: {
    label: "Sem sinal",
    short: "Offline",
    variant: "alert",
    Icon: IconPlugConnectedX,
  },
};

/**
 * Formulario do endpoint.
 *
 * Recebe o endereco atual como prop e e remontado por `key` quando ele muda
 * (ver o uso abaixo). Essa e a forma idiomatica de reiniciar estado local a
 * partir de uma mudanca externa — um `useEffect` que chama `setDraft` causaria
 * um render em cascata a cada sincronizacao.
 */
function EndpointSettings({ endpoint }: { endpoint: string }) {
  const setEndpoint = useTelemetryStore((s) => s.setEndpoint);
  const dropped = useTelemetryStore((s) => s.droppedFrames);
  const malformed = useTelemetryStore((s) => s.malformedFrames);

  const [draft, setDraft] = React.useState(endpoint);
  const [saved, setSaved] = React.useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setEndpoint(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const preview = normalizeEndpoint(draft);

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-3">
      <div>
        <div className="text-sm font-medium">Endereco do receptor</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          O padrao <code className="font-tech">192.168.4.1</code> ja aponta para o
          Access Point do receptor em terra — normalmente nao ha nada a mudar
          aqui. O caminho <code>/ws</code> e adicionado automaticamente.
        </p>
      </div>

      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="192.168.4.1"
        className="font-tech text-sm"
        autoComplete="off"
        spellCheck={false}
        inputMode="url"
      />

      <div className="rounded-md bg-muted px-2 py-1.5 font-tech text-[11px] break-all text-muted-foreground">
        {preview}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" className="h-9 flex-1">
          {saved ? (
            <>
              <IconCheck className="size-4" /> Salvo
            </>
          ) : (
            <>
              <IconRefresh className="size-4" /> Conectar
            </>
          )}
        </Button>
        {/* Volta ao AP do receptor. Antes este botao definia "athenas.local",
            endereco que deixou de existir quando o enlace virou LoRa — clicar
            nele DERRUBAVA a conexao em vez de restaura-la. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9"
          title="Voltar ao endereco padrao do receptor"
          onClick={() => setDraft(DEFAULT_ENDPOINT)}
        >
          Padrao
        </Button>
      </div>

      <div className="space-y-1 border-t pt-2 text-[11px] text-muted-foreground">
        <LinkStats />
        <div className="flex justify-between gap-2">
          <span>Quadros perdidos (WebSocket)</span>
          <span className="font-tech tabular-nums">{dropped}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Quadros malformados</span>
          <span className="font-tech tabular-nums">{malformed}</span>
        </div>
      </div>
    </form>
  );
}

/**
 * Qualidade do enlace de RADIO, medida pelo mestre.
 *
 * So aparece quando existe um receptor LoRa no caminho — ligado direto no
 * barco por WiFi, esses numeros nao existem e mostrar zeros seria mentira.
 */
function LinkStats() {
  const link = useTelemetryStore((s) => s.frame?.link ?? null);
  if (!link) return null;

  // Faixas praticas do SX1262 em 915 MHz:
  //   RSSI > -100 dBm  -> folga confortavel
  //   RSSI -100..-115  -> ainda funciona, mas ja no limite
  //   RSSI < -115      -> perda de pacotes iminente
  const rssiColor =
    link.rssi > -100
      ? "var(--ok)"
      : link.rssi > -115
        ? "var(--warn)"
        : "var(--alert)";

  // Abaixo de -7 dB o LoRa em SF7 comeca a nao demodular.
  const snrColor = link.snr > -5 ? "var(--ok)" : "var(--warn)";

  return (
    <>
      <div className="flex justify-between gap-2">
        <span>Sinal LoRa (RSSI)</span>
        <span className="font-tech tabular-nums" style={{ color: rssiColor }}>
          {link.rssi.toFixed(0)} dBm
        </span>
      </div>
      <div className="flex justify-between gap-2">
        <span>Relacao sinal-ruido</span>
        <span className="font-tech tabular-nums" style={{ color: snrColor }}>
          {link.snr.toFixed(1)} dB
        </span>
      </div>
      <div className="flex justify-between gap-2">
        <span>Pacotes perdidos no ar</span>
        <span className="font-tech tabular-nums">{link.lost}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span>Pacotes corrompidos</span>
        <span className="font-tech tabular-nums">{link.corrupt}</span>
      </div>
    </>
  );
}

export function ConnectionBadge() {
  const status = useTelemetryStore((s) => s.status);
  const endpoint = useTelemetryStore((s) => s.endpoint);
  const hz = useTelemetryStore((s) => s.measuredHz);
  const rssi = useTelemetryStore((s) => s.frame?.link?.rssi ?? null);
  const temQuadro = useTelemetryStore((s) => s.frame !== null);

  // ---------------------------------------------------------------------------
  //  "Ao vivo" NAO pode significar so "o WebSocket abriu".
  //
  //  Ha DOIS enlaces em serie — barco -> receptor (LoRa) e receptor -> PC
  //  (WiFi) — e o segundo funcionar nao diz nada sobre o primeiro. Mostrar
  //  "Ao vivo" com o barco mudo manda a equipe procurar defeito no lado errado.
  //
  //  Entao: conectado ao receptor mas sem nenhum quadro do barco vira um estado
  //  proprio, em laranja, dizendo exatamente onde esta o problema.
  // ---------------------------------------------------------------------------
  const semBarco = status === "live" && !temQuadro;

  const m = semBarco
    ? {
        label: "Receptor ok · sem barco",
        short: "Sem barco",
        variant: "warn" as const,
        Icon: IconPlugConnectedX,
        spin: false,
      }
    : META[status];
  const Icon = m.Icon;

  // A taxa exibida e a MEDIDA, nao a nominal. Com o enlace LoRa a cadencia e
  // uma escolha de projeto (5 Hz custa alcance), e a equipe precisa ver o que
  // esta chegando de fato.
  const rate = status === "live" && hz > 0 ? ` · ${hz.toFixed(1)} Hz` : "";

  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant={m.variant}
        title={`Telemetria: ${endpointHost(endpoint)}${
          rssi !== null ? ` · RSSI ${rssi.toFixed(0)} dBm` : ""
        }`}
      >
        <Icon className={`size-3.5 ${m.spin ? "animate-spin" : ""}`} />
        {/* Rotulo curto no celular; completo a partir de sm. */}
        <span className="sm:hidden">{m.short}</span>
        <span className="hidden sm:inline">
          {m.label}
          {rate}
        </span>
      </Badge>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Configurar endereco do ESP32"
            aria-label="Configurar endereco do ESP32"
          >
            <IconSettings className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-0">
          <EndpointSettings key={endpoint} endpoint={endpoint} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
