import * as React from "react";
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconFlag,
  IconRotateClockwise2,
} from "@tabler/icons-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Cronômetro náutico nativo com precisão de milissegundos.
// Mede tempo decorrido usando performance.now() (monotônico) para não sofrer
// com ajustes do relógio do sistema. setInterval ~30 ms apenas atualiza a
// leitura; o tempo real é sempre derivado dos timestamps acumulados.

const TICK_MS = 30;

interface Lap {
  /** Tempo absoluto desde o início (ms). */
  total: number;
  /** Diferença em relação à volta anterior — o "split" (ms). */
  split: number;
}

/** Formata ms em mm:ss.mmm (cronômetro de regata). */
function fmt(ms: number): { mm: string; ss: string; mmm: string } {
  const totalMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return {
    mm: String(minutes).padStart(2, "0"),
    ss: String(seconds).padStart(2, "0"),
    mmm: String(millis).padStart(3, "0"),
  };
}

function fmtFull(ms: number): string {
  const { mm, ss, mmm } = fmt(ms);
  return `${mm}:${ss}.${mmm}`;
}

export function CronometroNautico() {
  const [running, setRunning] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [laps, setLaps] = React.useState<Lap[]>([]);

  // Acumulador monotônico: base = instante em que (re)iniciou; accrued = tempo
  // já contabilizado em pausas anteriores.
  const startRef = React.useRef<number>(0);
  const accruedRef = React.useRef<number>(0);
  const intervalRef = React.useRef<number | undefined>(undefined);

  const now = React.useCallback(
    () =>
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    [],
  );

  const stopTicking = React.useCallback(() => {
    if (intervalRef.current !== undefined) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);

  React.useEffect(() => stopTicking, [stopTicking]);

  const handleStartStop = React.useCallback(() => {
    if (running) {
      // pausar: congela o decorrido no acumulador
      accruedRef.current += now() - startRef.current;
      setElapsed(accruedRef.current);
      stopTicking();
      setRunning(false);
    } else {
      // (re)iniciar
      startRef.current = now();
      stopTicking();
      intervalRef.current = window.setInterval(() => {
        setElapsed(accruedRef.current + (now() - startRef.current));
      }, TICK_MS);
      setRunning(true);
    }
  }, [running, now, stopTicking]);

  const handleReset = React.useCallback(() => {
    stopTicking();
    accruedRef.current = 0;
    startRef.current = 0;
    setElapsed(0);
    setLaps([]);
    setRunning(false);
  }, [stopTicking]);

  const handleLap = React.useCallback(() => {
    const total = running
      ? accruedRef.current + (now() - startRef.current)
      : elapsed;
    setLaps((prev) => {
      const prevTotal = prev.length ? prev[prev.length - 1].total : 0;
      return [...prev, { total, split: total - prevTotal }];
    });
  }, [running, now, elapsed]);

  const { mm, ss, mmm } = fmt(elapsed);

  const fastest = laps.length
    ? Math.min(...laps.map((l) => l.split))
    : null;
  const slowest = laps.length
    ? Math.max(...laps.map((l) => l.split))
    : null;

  return (
    <Card className="gap-3">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <IconRotateClockwise2 className="size-4" />
          Cronômetro Náutico
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Mostrador */}
        <div
          className={cn(
            "flex items-baseline justify-center font-tech tabular-nums leading-none",
            running && "glow-cyan",
          )}
          style={{ color: running ? "var(--cyan)" : "var(--primary)" }}
          aria-live="off"
        >
          <span className="text-4xl font-semibold">{mm}</span>
          <span className="px-0.5 text-3xl opacity-70">:</span>
          <span className="text-4xl font-semibold">{ss}</span>
          <span className="ml-1 text-xl opacity-80">.{mmm}</span>
        </div>

        {/* Controles amplos */}
        <div className="grid grid-cols-3 gap-2">
          <Button
            size="lg"
            variant={running ? "outline" : "default"}
            className="h-11 text-sm font-medium"
            onClick={handleStartStop}
          >
            {running ? (
              <>
                <IconPlayerPauseFilled /> Parar
              </>
            ) : (
              <>
                <IconPlayerPlayFilled /> {elapsed > 0 ? "Retomar" : "Iniciar"}
              </>
            )}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="h-11 text-sm font-medium"
            onClick={handleLap}
            disabled={!running && elapsed === 0}
          >
            <IconFlag /> Volta
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 text-sm font-medium"
            onClick={handleReset}
            disabled={running || (elapsed === 0 && laps.length === 0)}
          >
            <IconRotateClockwise2 /> Zerar
          </Button>
        </div>

        {/* Lista de voltas (Lap / Split) */}
        {laps.length > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-md ring-1 ring-foreground/10">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr className="text-left">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 text-right font-medium">
                    Parcial
                  </th>
                  <th className="px-2 py-1 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="font-tech tabular-nums">
                {laps
                  .map((lap, i) => ({ lap, i }))
                  .reverse()
                  .map(({ lap, i }) => {
                    const isFastest =
                      laps.length > 1 && lap.split === fastest;
                    const isSlowest =
                      laps.length > 1 && lap.split === slowest;
                    return (
                      <tr
                        key={i}
                        className="border-t border-foreground/5"
                        style={{
                          color: isFastest
                            ? "var(--ok)"
                            : isSlowest
                              ? "var(--warn)"
                              : undefined,
                        }}
                      >
                        <td className="px-2 py-1 text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmtFull(lap.split)}
                        </td>
                        <td className="px-2 py-1 text-right text-muted-foreground">
                          {fmtFull(lap.total)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
