// =============================================================================
//  MeltdownAlert — Gatilho de Emergencia do Gemeo Digital Termico
//
//  Dispara quando a projecao termica indica que o nucleo do estator atingira
//  90 °C dentro dos proximos 30 segundos, mantida a corrente atual.
//
//  E um alerta GLOBAL, montado na raiz do app: nao adianta avisar de fusao
//  iminente so em quem estiver com a aba do Prontuario aberta. O piloto de
//  testes precisa da mensagem esteja onde estiver.
//
//  Comportamento deliberado:
//   - fica na tela enquanto a condicao durar (nao some sozinho);
//   - pode ser dispensado, mas REAPARECE se a condicao voltar depois de ter se
//     normalizado — silenciar uma vez nao silencia para sempre;
//   - nao bloqueia a interface (nao e um modal): a tripulacao precisa continuar
//     vendo a telemetria enquanto reduz a manete.
// =============================================================================

import * as React from "react";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { useTelemetryStore, MELTDOWN_HORIZON_S } from "@/lib/telemetry/store";
import { MELTDOWN_C } from "@/lib/telemetry/contract";

export function MeltdownAlert() {
  const imminent = useTelemetryStore((s) => s.meltdownImminent);
  const seconds = useTelemetryStore((s) => s.secondsToMeltdown);
  const virtual = useTelemetryStore((s) => s.virtualCoreTemp);

  // Guardamos QUAL episodio foi dispensado, nao um booleano.
  //
  // O store incrementa `meltdownEpisode` a cada transicao "seguro -> iminente".
  // Comparar os dois numeros re-arma o alerta automaticamente quando um NOVO
  // episodio comeca: dispensar o aviso durante uma arrancada nao pode silenciar
  // o proximo superaquecimento.
  //
  // Derivacao pura — sem efeito, sem ref, sem setState em cascata.
  const episode = useTelemetryStore((s) => s.meltdownEpisode);
  const [dismissedEpisode, setDismissedEpisode] = React.useState(0);

  if (!imminent || dismissedEpisode === episode) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-2 z-[9999] flex justify-center px-3 sm:top-4"
    >
      <div
        className="animate-pulse-alert pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-lg border-2 px-4 py-3 shadow-lg backdrop-blur"
        style={{
          borderColor: "var(--alert)",
          background: "color-mix(in oklab, var(--alert) 18%, var(--card))",
        }}
      >
        <IconAlertTriangle
          className="mt-0.5 size-6 shrink-0"
          style={{ color: "var(--alert)" }}
        />

        <div className="min-w-0 flex-1">
          <div
            className="font-tech text-sm font-bold uppercase tracking-wide"
            style={{ color: "var(--alert)" }}
          >
            Aviso: risco de fusao do estator iminente
          </div>
          <div className="mt-0.5 text-sm text-foreground">
            Reduza a manete.{" "}
            {seconds !== null && (
              <>
                Projecao termica atinge {MELTDOWN_C} °C em{" "}
                <strong className="font-tech tabular-nums">
                  {Math.max(0, Math.round(seconds))} s
                </strong>{" "}
                mantida a aceleracao atual.
              </>
            )}
          </div>
          <div className="mt-1 font-tech text-xs text-muted-foreground">
            Nucleo virtual:{" "}
            {Number.isFinite(virtual) ? virtual.toFixed(1) : "--"} °C · horizonte
            de analise {MELTDOWN_HORIZON_S} s
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setDismissedEpisode(episode)}
          aria-label="Dispensar alerta"
        >
          <IconX className="size-4" />
        </Button>
      </div>
    </div>
  );
}
