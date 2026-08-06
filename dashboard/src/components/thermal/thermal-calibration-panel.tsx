// =============================================================================
//  ThermalCalibrationPanel — ajuste de bancada dos coeficientes do gemeo termico
//
//  Alpha e beta sao propriedades fisicas do conjunto motriz montado. Nao existe
//  valor universal: mudam com a helice, com a ventilacao dentro do casco e ate
//  com onde o DS18B20 esta encostado na carcaca.
//
//  Este painel existe para a equipe fechar essa calibracao na doca, sem
//  recompilar nada. O procedimento completo esta em
//  @/lib/math/thermal-calibration.
//
//  O criterio de acerto e verificavel: a "Temperatura de equilibrio prevista"
//  para a corrente de cruzeiro precisa bater com a temperatura em que o motor
//  de fato estabiliza na bancada.
// =============================================================================

import * as React from "react";
import { IconAdjustments, IconRotate2, IconCheck } from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useTelemetryStore } from "@/lib/telemetry/store";
import type { ThermalCoefficients } from "@/lib/math/ThermalPredictor";
import {
  equilibriumAt,
  timeConstantSeconds,
} from "@/lib/math/thermal-calibration";
import { MELTDOWN_C, OVERHEAT_C } from "@/lib/telemetry/contract";

/** Corrente de referencia usada na previa de equilibrio (A). */
const PREVIEW_CURRENTS = [10, 20, 30, 40];

/**
 * Formulario de calibracao.
 *
 * Recebe os coeficientes vigentes como prop e e remontado por `key` quando eles
 * mudam (ver o wrapper no fim do arquivo). Reiniciar estado local por `key` e a
 * forma idiomatica; um `useEffect` chamando `setAlpha`/`setBeta` provocaria
 * render em cascata a cada sincronizacao.
 */
function CalibrationForm({ coeff }: { coeff: ThermalCoefficients }) {
  const setCoeff = useTelemetryStore((s) => s.setThermalCoeff);
  const resetCoeff = useTelemetryStore((s) => s.resetThermalCoeff);
  const ambient = useTelemetryStore((s) => s.frame?.ambient.temp_c ?? 30);

  const [alpha, setAlpha] = React.useState(String(coeff.alpha));
  const [beta, setBeta] = React.useState(String(coeff.beta));
  const [saved, setSaved] = React.useState(false);

  const draft = React.useMemo(
    () => ({
      alpha: Number(alpha),
      beta: Number(beta),
      observerGain: coeff.observerGain,
    }),
    [alpha, beta, coeff.observerGain],
  );

  const valid =
    Number.isFinite(draft.alpha) &&
    Number.isFinite(draft.beta) &&
    draft.alpha > 0 &&
    draft.beta > 0;

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setCoeff(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const tau = valid ? timeConstantSeconds(draft) : NaN;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconAdjustments className="size-4" />
          Calibracao do Gemeo Termico
        </CardTitle>
        <CardDescription>
          dT/dt = α·I² − β·(T − T_amb). Ajuste na bancada; os valores ficam
          salvos neste navegador.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form onSubmit={apply} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                α — aquecimento (°C·s⁻¹·A⁻²)
              </span>
              <Input
                value={alpha}
                onChange={(e) => setAlpha(e.target.value)}
                inputMode="decimal"
                className="font-tech"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                β — dissipacao (s⁻¹)
              </span>
              <Input
                value={beta}
                onChange={(e) => setBeta(e.target.value)}
                inputMode="decimal"
                className="font-tech"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" className="h-9" disabled={!valid}>
              {saved ? (
                <>
                  <IconCheck className="size-4" /> Aplicado
                </>
              ) : (
                "Aplicar calibracao"
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              onClick={resetCoeff}
            >
              <IconRotate2 className="size-4" />
              Padrao de fabrica
            </Button>
          </div>

          {!valid && (
            <p className="text-xs" style={{ color: "var(--alert)" }}>
              α e β precisam ser numeros positivos.
            </p>
          )}
        </form>

        <Separator />

        {/* ---- Previa verificavel: e isto que valida a calibracao ---- */}
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Temperatura de equilibrio prevista (T_amb = {ambient.toFixed(0)} °C)
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PREVIEW_CURRENTS.map((I) => {
              const eq = valid ? equilibriumAt(draft, I, ambient) : NaN;
              const color =
                eq >= MELTDOWN_C
                  ? "var(--alert)"
                  : eq >= OVERHEAT_C
                    ? "var(--warn)"
                    : "var(--ok)";
              return (
                <div
                  key={I}
                  className="rounded-md border px-2 py-1.5 text-center"
                >
                  <div className="text-[10px] text-muted-foreground">{I} A</div>
                  <div
                    className="font-tech text-sm font-semibold tabular-nums"
                    style={{ color }}
                  >
                    {Number.isFinite(eq) ? eq.toFixed(0) : "--"} °C
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              Constante de tempo termica:{" "}
              <strong className="font-tech">
                {Number.isFinite(tau) ? `${tau.toFixed(0)} s` : "--"}
              </strong>
            </span>
            <span>
              Ganho do observador:{" "}
              <strong className="font-tech">{coeff.observerGain ?? 0}</strong> s⁻¹
            </span>
          </div>
        </div>

        <div className="rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Como calibrar:</strong> aqueca o
          motor, desligue e cronometre quanto tempo <em>t</em> a diferenca
          (T − T_amb) leva para cair a 37% do valor inicial —{" "}
          <strong className="font-tech">β = 1/t</strong>. Depois rode com uma
          corrente constante <em>I</em> ate estabilizar em T_eq —{" "}
          <strong className="font-tech">α = β·(T_eq − T_amb)/I²</strong>. A
          calibracao esta certa quando, numa arrancada, a curva laranja sobe
          antes da branca e as duas convergem em regime.
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Wrapper exportado. Remonta o formulario por `key` sempre que os coeficientes
 * vigentes mudam (aplicar calibracao, voltar ao padrao de fabrica), de modo que
 * os campos refletem o estado real sem nenhum efeito de sincronizacao.
 */
export function ThermalCalibrationPanel() {
  const coeff = useTelemetryStore((s) => s.thermalCoeff);
  return (
    <CalibrationForm
      key={`${coeff.alpha}|${coeff.beta}|${coeff.observerGain}`}
      coeff={coeff}
    />
  );
}
