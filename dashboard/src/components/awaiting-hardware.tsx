// =============================================================================
//  AwaitingHardware — faixa exibida enquanto nenhum quadro real chegou.
//
//  O Athenas OS v2.1 NAO tem modo simulacao: todo numero na tela vem do ESP32.
//  Quando o enlace esta mudo, e obrigacao do painel dizer isso de forma
//  inequivoca, em vez de mostrar zeros que parecem leitura valida.
//
//  Deliberadamente NAO bloqueia a interface: a tripulacao precisa poder abrir
//  as abas, ajustar o endereco da placa e exportar a sessao anterior mesmo com
//  o barco fora do ar.
// =============================================================================

import * as React from "react";
import { IconPlugConnectedX, IconLoader2 } from "@tabler/icons-react";

import { useTelemetryStore } from "@/lib/telemetry/store";
import { useHasData } from "@/lib/telemetry/selectors";
import { endpointHost } from "@/lib/telemetry/endpoint";

/** Silencio do enlace, em ms, que ja caracteriza perda de telemetria a 5 Hz. */
const STALE_MS = 3000;

/**
 * Relogio de 1 Hz.
 *
 * Detectar "o enlace emudeceu" exige um gatilho de tempo, nao de dado: se os
 * quadros PARAM de chegar, nao ha mais nada no store que mude para provocar um
 * novo render. Sem este tique, o painel continuaria exibindo "Ao vivo" para
 * sempre depois de o ESP32 travar.
 */
function useTick(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function AwaitingHardware() {
  const hasData = useHasData();
  const status = useTelemetryStore((s) => s.status);
  const endpoint = useTelemetryStore((s) => s.endpoint);
  const lastFrameAt = useTelemetryStore((s) => s.lastFrameAt);
  const now = useTick();

  const connected = status === "live";
  // Socket aberto mas sem quadros: o ESP32 respondeu o handshake e parou de
  // transmitir. Sintoma classico de firmware travado num delay() ou de reboot.
  const stale = connected && hasData && now - lastFrameAt > STALE_MS;

  if (connected && hasData && !stale) return null;

  const connecting = status === "connecting";

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
      style={{
        borderColor: connecting ? "var(--warn)" : "var(--alert)",
        background: `color-mix(in oklab, ${
          connecting ? "var(--warn)" : "var(--alert)"
        } 10%, transparent)`,
      }}
    >
      {connecting ? (
        <IconLoader2
          className="mt-0.5 size-5 shrink-0 animate-spin"
          style={{ color: "var(--warn)" }}
        />
      ) : (
        <IconPlugConnectedX
          className="mt-0.5 size-5 shrink-0"
          style={{ color: "var(--alert)" }}
        />
      )}

      <div className="min-w-0 text-sm">
        <div
          className="font-tech text-xs font-bold uppercase tracking-wide"
          style={{ color: connecting ? "var(--warn)" : "var(--alert)" }}
        >
          {connecting
            ? "Conectando a embarcacao…"
            : stale
              ? "Telemetria interrompida"
              : "Aguardando a embarcacao"}
        </div>
        <div className="mt-0.5 text-foreground/80">
          {stale ? (
            <>
              O receptor em{" "}
              <strong className="font-tech">{endpointHost(endpoint)}</strong>{" "}
              esta conectado, mas nao recebe o barco ha mais de 3 s. Veja o
              display do receptor: se marcar <strong>SEM ENLACE</strong>, o
              problema e o alcance do radio, nao o software.
            </>
          ) : (
            <>
              Nao ha dados reais em{" "}
              <strong className="font-tech">{endpointHost(endpoint)}</strong>.
              Confirme que este computador esta conectado a rede WiFi{" "}
              <strong>Athenas-Base</strong> (criada pelo receptor em terra) e
              que o receptor esta ligado — ou ajuste o endereco pela
              engrenagem no topo.
            </>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Este painel nao possui modo de simulacao: todos os valores exibidos
          vem diretamente do hardware.
        </div>
      </div>
    </div>
  );
}
