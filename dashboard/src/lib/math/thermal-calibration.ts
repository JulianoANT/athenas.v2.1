// =============================================================================
//  Calibracao do Gemeo Digital Termico.
//
//  Alpha e beta sao propriedades FISICAS do conjunto motriz montado — mudam com
//  a helice, com a ventilacao dentro do casco e ate com a posicao do sensor na
//  carcaca. Nao existe valor universal: sao medidos na bancada.
//
//  Por isso ficam persistidos no navegador em vez de embutidos no build: a
//  equipe ajusta na doca, sem recompilar nada.
//
//  ---------------------------------------------------------------------------
//  PROCEDIMENTO DE CALIBRACAO (bancada, ~15 min)
//  ---------------------------------------------------------------------------
//  1. BETA (dissipacao) — mede a constante de tempo do resfriamento:
//     a) Aqueca o motor ate uma temperatura estavel e DESLIGUE (I = 0).
//     b) Anote T0 (no desligamento) e T_amb.
//     c) Cronometrando, anote quanto tempo (t63, em segundos) leva para a
//        diferenca (T − T_amb) cair a 37% do valor inicial.
//        Ex.: T0 = 60 °C, T_amb = 30 °C -> diferenca inicial 30 °C.
//             Espere ate marcar 30 + 0.37×30 ≈ 41 °C.
//     d) beta = 1 / t63.
//
//  2. ALPHA (aquecimento) — mede o ganho termico da corrente:
//     a) Rode o motor com corrente CONSTANTE conhecida I ate a temperatura
//        estabilizar (nao subir mais por ~2 min). Anote T_eq.
//     b) alpha = beta × (T_eq − T_amb) / I²
//
//  Digite os dois valores na tela de calibracao do Prontuario. O acerto se
//  confirma quando, numa arrancada, a curva laranja SOBE ANTES da branca e as
//  duas CONVERGEM depois que a temperatura estabiliza.
// =============================================================================

import { ThermalPredictor, type ThermalCoefficients } from "./ThermalPredictor";

const STORAGE_KEY = "athenas:thermal-coeff";

/** Faixas aceitas — barram digitacao que desestabilizaria o integrador. */
export const ALPHA_RANGE: [number, number] = [0.00001, 0.05];
export const BETA_RANGE: [number, number] = [0.001, 0.2];
export const OBSERVER_RANGE: [number, number] = [0, 0.1];

function clamp(v: number, [lo, hi]: [number, number]): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Coeficientes salvos pela tripulacao, ou os padroes de fabrica. */
export function readCoefficients(): ThermalCoefficients {
  const defaults = ThermalPredictor.defaults();
  if (typeof window === "undefined") return defaults;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as Partial<ThermalCoefficients>;
    return {
      alpha: Number.isFinite(parsed.alpha)
        ? clamp(parsed.alpha as number, ALPHA_RANGE)
        : defaults.alpha,
      beta: Number.isFinite(parsed.beta)
        ? clamp(parsed.beta as number, BETA_RANGE)
        : defaults.beta,
      observerGain: Number.isFinite(parsed.observerGain)
        ? clamp(parsed.observerGain as number, OBSERVER_RANGE)
        : defaults.observerGain,
    };
  } catch {
    // JSON corrompido no localStorage nao pode derrubar a telemetria.
    return defaults;
  }
}

/** Persiste os coeficientes calibrados, ja limitados as faixas validas. */
export function saveCoefficients(
  coeff: ThermalCoefficients,
): ThermalCoefficients {
  const safe: ThermalCoefficients = {
    alpha: clamp(coeff.alpha, ALPHA_RANGE),
    beta: clamp(coeff.beta, BETA_RANGE),
    observerGain: clamp(
      coeff.observerGain ?? ThermalPredictor.defaults().observerGain ?? 0,
      OBSERVER_RANGE,
    ),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  }
  return safe;
}

/** Volta aos padroes de fabrica. */
export function resetCoefficients(): ThermalCoefficients {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return ThermalPredictor.defaults();
}

/**
 * Temperatura de equilibrio prevista para uma corrente sustentada — o numero
 * que torna a calibracao verificavel: se a bancada estabiliza em 60 °C a 20 A,
 * os coeficientes devem prever 60 °C a 20 A.
 */
export function equilibriumAt(
  coeff: ThermalCoefficients,
  current_a: number,
  ambient_c: number,
): number {
  return ThermalPredictor.equilibrium(current_a, ambient_c, coeff);
}

/** Constante de tempo termica (s) implicada por beta. */
export function timeConstantSeconds(coeff: ThermalCoefficients): number {
  return coeff.beta > 0 ? 1 / coeff.beta : Infinity;
}
