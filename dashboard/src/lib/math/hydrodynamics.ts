// =============================================================================
//  Hidrodinamica — Eficiencia energetica em tempo real
//
//  A potencia eletrica de entrada do conjunto motriz e:
//
//      P_in = V_bat · I_mot          [W]
//
//  Dividindo pela velocidade sobre a agua obtemos o CONSUMO ESPECIFICO:
//
//      SEC = P_in / v                [W / no]
//
//  Esse numero e a metrica que realmente importa numa prova de eficiencia: nao
//  adianta ir rapido gastando muito. Se o SEC sobe SEM ganho de velocidade, a
//  helice esta girando sem "morder" a agua — cavitacao — ou o casco ganhou
//  arrasto (algas, leme travado, deriva).
// =============================================================================

/** Velocidade minima (em nos) abaixo da qual o SEC nao tem significado. */
const MIN_SPEED_KNOTS = 0.8;

/**
 * Consumo especifico de referencia, em W/no. Acima disso o casco esta gastando
 * mais energia do que o esperado para a velocidade. Calibrar na bancada com o
 * conjunto real (motor Imobras + helice de prova).
 */
export const SEC_NOMINAL_W_PER_KNOT = 40;
export const SEC_MAX_W_PER_KNOT = 160; // fundo de escala do gauge

/** Salto relativo de SEC que caracteriza cavitacao/arrasto excessivo. */
const CAVITATION_SEC_RATIO = 1.45;
/** ...desde que a velocidade NAO tenha subido mais que isso (fracao). */
const CAVITATION_SPEED_TOLERANCE = 0.05;
/** ...e a condicao persista por este tempo. */
const CAVITATION_SUSTAIN_MS = 1200;

export interface PowerReading {
  /** Potencia eletrica de entrada, em W. */
  power_w: number;
  /** Consumo especifico, em W por no. `null` quando o barco esta parado. */
  sec_w_per_knot: number | null;
}

/** P_in = V_bat · I_mot, e o consumo especifico correspondente. */
export function computePower(
  voltage_v: number,
  current_a: number,
  speed_knots: number,
): PowerReading {
  const v = Number.isFinite(voltage_v) ? voltage_v : 0;
  const i = Number.isFinite(current_a) ? current_a : 0;
  const power_w = Math.max(0, v * i);

  if (!Number.isFinite(speed_knots) || speed_knots < MIN_SPEED_KNOTS) {
    return { power_w, sec_w_per_knot: null };
  }

  return { power_w, sec_w_per_knot: power_w / speed_knots };
}

export type EfficiencyLevel = "otimo" | "nominal" | "degradado" | "critico";

/** Faixa qualitativa do consumo especifico (cores do gauge). */
export function efficiencyLevel(
  sec_w_per_knot: number | null,
): EfficiencyLevel | null {
  if (sec_w_per_knot == null) return null;
  if (sec_w_per_knot <= SEC_NOMINAL_W_PER_KNOT * 0.8) return "otimo";
  if (sec_w_per_knot <= SEC_NOMINAL_W_PER_KNOT * 1.25) return "nominal";
  if (sec_w_per_knot <= SEC_NOMINAL_W_PER_KNOT * 1.8) return "degradado";
  return "critico";
}

/**
 * Detector de CAVITACAO OU ARRASTO EXCESSIVO (com estado).
 *
 * Compara o consumo especifico instantaneo com uma media movel exponencial de
 * longo prazo. O alerta so dispara quando o SEC salta muito acima da linha de
 * base E a velocidade nao acompanha — a assinatura de uma helice patinando ou
 * de um casco que ganhou arrasto. Exigimos que a condicao persista para nao
 * disparar em transientes de aceleracao, que legitimamente pioram o SEC.
 */
export class CavitationDetector {
  /** Media movel exponencial do SEC (linha de base). */
  private baselineSec: number | null = null;
  /** EMA da velocidade, na mesma escala de tempo da baseline. */
  private baselineSpeed = 0;
  /** Instante em que a condicao anomala comecou. */
  private anomalySince: number | null = null;

  /** Fator de suavizacao da EMA (~30 s de memoria a 5 Hz). */
  private readonly emaAlpha = 0.0066;

  /**
   * @param sec_w_per_knot Consumo especifico instantaneo (null se parado).
   * @param speed_knots    Velocidade atual em nos.
   * @param now            Timestamp em ms.
   * @returns              true enquanto a anomalia estiver caracterizada.
   */
  update(
    sec_w_per_knot: number | null,
    speed_knots: number,
    now: number,
  ): boolean {
    // Barco parado: nada a inferir, e nao contamina a linha de base.
    if (sec_w_per_knot == null || !Number.isFinite(sec_w_per_knot)) {
      this.anomalySince = null;
      return false;
    }

    // Primeira amostra util: adota como linha de base.
    if (this.baselineSec == null) {
      this.baselineSec = sec_w_per_knot;
      this.baselineSpeed = speed_knots;
      return false;
    }

    const secRatio = sec_w_per_knot / this.baselineSec;
    const speedGain =
      this.baselineSpeed > MIN_SPEED_KNOTS
        ? speed_knots / this.baselineSpeed - 1
        : 0;

    // Assinatura: consumo especifico disparou, velocidade nao acompanhou.
    const anomalous =
      secRatio >= CAVITATION_SEC_RATIO &&
      speedGain <= CAVITATION_SPEED_TOLERANCE;

    if (anomalous) {
      if (this.anomalySince == null) this.anomalySince = now;
      // Durante a anomalia NAO atualizamos a baseline — se atualizassemos, o
      // proprio evento viraria "o novo normal" e o alerta se apagaria sozinho.
      return now - this.anomalySince >= CAVITATION_SUSTAIN_MS;
    }

    this.anomalySince = null;
    this.baselineSec =
      this.baselineSec + this.emaAlpha * (sec_w_per_knot - this.baselineSec);
    this.baselineSpeed =
      this.baselineSpeed + this.emaAlpha * (speed_knots - this.baselineSpeed);
    return false;
  }

  /** Linha de base atual (W/no), ou null se ainda nao aprendeu. */
  get baseline(): number | null {
    return this.baselineSec;
  }

  reset(): void {
    this.baselineSec = null;
    this.baselineSpeed = 0;
    this.anomalySince = null;
  }
}

// ---------------------------------------------------------------------------
//  Rosa dos ventos — correcao de declinacao magnetica
// ---------------------------------------------------------------------------

/**
 * Declinacao magnetica (variacao magnetica) do local da prova, em graus.
 * Convencao: POSITIVO para leste, NEGATIVO para oeste.
 *
 *   Rumo Verdadeiro = Rumo Magnetico + Declinacao
 *   Rumo Magnetico  = Rumo Verdadeiro − Declinacao
 *
 * O GPS Neo-6M reporta COURSE OVER GROUND em relacao ao NORTE VERDADEIRO
 * (geografico), pois deriva da posicao, nao de magnetometro. Por isso a agulha
 * da bussola aponta para o Norte Magnetico aplicando −declinacao ao rumo
 * verdadeiro, enquanto a rosa gira pelo rumo verdadeiro sobre o fundo.
 *
 * Valor default: Joinville/SC (~26.3°S, 48.85°O), sede da prova — cerca de
 * 20.5° Oeste na epoca de 2026 pelo modelo IGRF. Ajuste para o local real da
 * prova antes da regata: https://www.ngdc.noaa.gov/geomag/calculators/
 */
export const MAGNETIC_DECLINATION_DEG = -20.5;

/** Converte rumo verdadeiro (do GPS) em rumo magnetico (da agulha). */
export function trueToMagnetic(
  trueHeadingDeg: number,
  declinationDeg: number = MAGNETIC_DECLINATION_DEG,
): number {
  return (((trueHeadingDeg - declinationDeg) % 360) + 360) % 360;
}

/** Converte rumo magnetico em rumo verdadeiro. */
export function magneticToTrue(
  magneticHeadingDeg: number,
  declinationDeg: number = MAGNETIC_DECLINATION_DEG,
): number {
  return (((magneticHeadingDeg + declinationDeg) % 360) + 360) % 360;
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE",
  "E", "ESE", "SE", "SSE",
  "S", "SSO", "SO", "OSO",
  "O", "ONO", "NO", "NNO",
] as const;

/** Rotulo de 16 pontos da rosa dos ventos (nomenclatura em portugues). */
export function compassPoint(deg: number): string {
  const norm = (((deg % 360) + 360) % 360);
  return COMPASS_POINTS[Math.round(norm / 22.5) % 16];
}
