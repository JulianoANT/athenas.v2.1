// =============================================================================
//  ThermalPredictor — Gemeo Digital Termico do estator (Lei de Joule-Newton)
//
//  MOTIVACAO: o DS18B20 fica encostado na carcaca, nao no enrolamento. Entre o
//  cobre esquentar e o sensor registrar existem dezenas de segundos de inercia
//  termica. Quando o painel mostra 70 °C, o nucleo ja pode estar em 85 °C.
//
//  MODELO: aquecimento por Efeito Joule menos resfriamento por Lei de
//  Resfriamento de Newton:
//
//      dT/dt = alpha·I^2 − beta·(T − T_amb)
//
//      I     : corrente instantanea do motor (ACS758), em A
//      T     : temperatura VIRTUAL do estator, em °C
//      T_amb : temperatura ambiente dentro do casco (DHT22), em °C
//      alpha : coeficiente de aquecimento (resistencia do cobre / capacidade
//              termica do conjunto), em °C·s^-1·A^-2
//      beta  : coeficiente de dissipacao (troca de calor com o ar), em s^-1
//
//  INTEGRACAO: Metodo de Euler explicito, T[n+1] = T[n] + (dT/dt)·dt.
//  A 5 Hz (dt = 0.2 s) o passo e muito menor que a constante de tempo do
//  sistema (1/beta ~ 50 s), entao Euler e estavel e barato.
//
//  CALIBRACAO: alpha e beta sao empiricos. Os defaults vem da Diretriz
//  (0.005 / 0.02) e devem ser refinados na bancada — veja `fitCoefficients`.
// =============================================================================

export interface ThermalCoefficients {
  /** Coeficiente de aquecimento (Efeito Joule), em °C·s⁻¹·A⁻². */
  alpha: number;
  /** Coeficiente de dissipacao (resfriamento newtoniano), em s⁻¹. */
  beta: number;
  /**
   * Ganho do observador, em s⁻¹. Ver `OBSERVER_GAIN` abaixo.
   * Zero desliga a correcao (modelo em malha aberta).
   */
  observerGain?: number;
}

export class ThermalPredictor {
  // ---------------------------------------------------------------------------
  //  CALIBRACAO DAS CONSTANTES EMPIRICAS
  //
  //  A Diretriz sugere alpha=0.005 e beta=0.02 como PONTO DE PARTIDA. Medimos
  //  o que esses valores produzem no conjunto real e eles divergem demais:
  //
  //      T_eq = T_amb + (alpha·I²)/beta
  //      com I = 20 A (cruzeiro) e T_amb = 30 °C:
  //      T_eq = 30 + (0.005 × 400)/0.02 = 30 + 100 = 130 °C
  //
  //  Ou seja: em regime de cruzeiro normal o gemeo preveria 130 °C enquanto o
  //  sensor fisico marca ~60 °C. O alarme de fusao ficaria PERMANENTEMENTE
  //  ligado — e um alarme que toca sempre e um alarme que ninguem escuta.
  //
  //  Os valores abaixo foram derivados da fisica esperada do conjunto:
  //    - constante de tempo termica do estator + carcaca ~ 80 s  ->  beta = 1/80
  //    - temperatura de equilibrio ~ 60 °C em cruzeiro (I = 20 A, T_amb = 30 °C)
  //      -> alpha/beta = 30/400 = 0.075  ->  alpha = 0.075 × 0.0125
  //
  //  Sob sobrecarga real (I = 35 A) isso da T_eq = 30 + 0.00094×1225/0.0125
  //  ≈ 122 °C, ou seja: o alarme de 90 °C dispara quando DEVE disparar.
  //
  //  AINDA ASSIM SAO ESTIMATIVAS. Calibre na bancada com o motor instrumentado
  //  (ver o procedimento em firmware/onboard/README.md) e ajuste pela tela de
  //  calibracao no Prontuario.
  // ---------------------------------------------------------------------------
  private static readonly ALPHA_HEATING = 0.00094;
  private static readonly BETA_COOLING = 0.0125;

  /**
   * GANHO DO OBSERVADOR (correcao em malha fechada).
   *
   * Um gemeo digital em malha aberta acumula todo erro de calibracao: se alpha
   * estiver 20% alto, a temperatura virtual afasta-se da real e nunca volta.
   *
   * A solucao classica e um observador de Luenberger — acrescentar um termo
   * que puxa a estimativa de volta para a medicao:
   *
   *     dT/dt = alpha·I² − beta·(T − T_amb) + L·(T_sensor − T)
   *
   * Escolhemos L pequeno (1/200 s) DE PROPOSITO. Assim:
   *   - no CURTO prazo (segundos apos acelerar) o termo alpha·I² domina, e o
   *     gemeo mantem toda a antecipacao sobre a inercia do DS18B20 — que e a
   *     razao de ele existir;
   *   - no LONGO prazo (minutos) o termo L ancora a estimativa na realidade
   *     medida, eliminando a deriva por calibracao imperfeita.
   */
  private static readonly OBSERVER_GAIN = 0.005;

  /**
   * Passo de integracao maximo aceito, em segundos. Se a aba ficar em segundo
   * plano por 40 s, integrar tudo de uma vez com Euler produziria um degrau
   * absurdo — o passo e fatiado (veja `integrate`).
   */
  private static readonly MAX_STEP_S = 0.5;

  /** Temperatura fisicamente impossivel — limita divergencia numerica. */
  private static readonly T_MIN_C = -40;
  private static readonly T_MAX_C = 300;

  /**
   * Integra a temperatura virtual usando o Metodo de Euler.
   *
   * @param currentTemp       Temperatura virtual calculada no ciclo anterior (°C)
   * @param motorCurrent      Corrente atual lida pelo ACS758 (A)
   * @param ambientTemp       Temperatura ambiente lida pelo DHT22 (°C)
   * @param deltaTimeSeconds  Tempo decorrido desde o ultimo calculo (s)
   * @param coeff             Coeficientes empiricos (opcional)
   * @param sensorTemp        Leitura do DS18B20 (°C). Quando informada, ativa a
   *                          correcao do observador. Passe `null` para rodar em
   *                          malha aberta (ex.: projecoes hipoteticas).
   * @returns                 Nova temperatura virtual do nucleo (°C)
   */
  public static calculateNextTemperature(
    currentTemp: number,
    motorCurrent: number,
    ambientTemp: number,
    deltaTimeSeconds: number,
    coeff?: Partial<ThermalCoefficients>,
    sensorTemp: number | null = null,
  ): number {
    // --- Guardas: um NaN aqui viraria a barra laranja em "NaN °C" para sempre,
    // porque o resultado realimenta a proxima iteracao. ---
    if (!Number.isFinite(currentTemp)) return ambientTemp;
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds <= 0) {
      return currentTemp;
    }

    const alpha = coeff?.alpha ?? this.ALPHA_HEATING;
    const beta = coeff?.beta ?? this.BETA_COOLING;
    const L = coeff?.observerGain ?? this.OBSERVER_GAIN;

    const I = Number.isFinite(motorCurrent) ? Math.abs(motorCurrent) : 0;
    const Tamb = Number.isFinite(ambientTemp) ? ambientTemp : currentTemp;

    // Efeito Joule (aquecimento) — proporcional ao quadrado da corrente.
    const jouleHeating = alpha * I * I;

    // Resfriamento Newtoniano (dissipacao) — proporcional ao gradiente.
    const convectiveCooling = beta * (currentTemp - Tamb);

    // Correcao do observador — so quando ha leitura fisica confiavel.
    const observerCorrection =
      sensorTemp !== null && Number.isFinite(sensorTemp)
        ? L * (sensorTemp - currentTemp)
        : 0;

    // dT/dt
    const rateOfChange = jouleHeating - convectiveCooling + observerCorrection;

    // Aplicacao do Passo de Euler.
    const newTemperature = currentTemp + rateOfChange * deltaTimeSeconds;

    if (!Number.isFinite(newTemperature)) return currentTemp;
    return Math.min(this.T_MAX_C, Math.max(this.T_MIN_C, newTemperature));
  }

  /**
   * Integra um intervalo arbitrario fatiando em sub-passos de no maximo
   * MAX_STEP_S. Use no lugar de `calculateNextTemperature` quando o dt puder
   * ser grande (aba retomada, reconexao do WebSocket).
   */
  public static integrate(
    currentTemp: number,
    motorCurrent: number,
    ambientTemp: number,
    deltaTimeSeconds: number,
    coeff?: Partial<ThermalCoefficients>,
    sensorTemp: number | null = null,
  ): number {
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds <= 0) {
      return currentTemp;
    }

    let remaining = Math.min(deltaTimeSeconds, 60); // teto de sanidade
    let T = currentTemp;

    while (remaining > 0) {
      const step = Math.min(remaining, this.MAX_STEP_S);
      T = this.calculateNextTemperature(
        T,
        motorCurrent,
        ambientTemp,
        step,
        coeff,
        sensorTemp,
      );
      remaining -= step;
    }

    return T;
  }

  /**
   * Projeta a temperatura virtual `horizonSeconds` a frente, assumindo que a
   * corrente atual seja MANTIDA. E isso que permite a Serena avisar
   * "superaquecimento critico em 45 segundos se a aceleracao for mantida".
   *
   * @returns Temperatura projetada no fim do horizonte (°C).
   */
  public static project(
    currentTemp: number,
    motorCurrent: number,
    ambientTemp: number,
    horizonSeconds: number,
    coeff?: Partial<ThermalCoefficients>,
  ): number {
    return this.integrate(
      currentTemp,
      motorCurrent,
      ambientTemp,
      horizonSeconds,
      coeff,
    );
  }

  /**
   * Tempo estimado, em segundos, ate a temperatura virtual atingir `targetC`
   * mantida a corrente atual.
   *
   * Resolve a EDO analiticamente em vez de simular passo a passo. Para I
   * constante, a solucao fechada e uma exponencial com temperatura de
   * equilibrio T_eq:
   *
   *      T_eq = T_amb + (alpha·I^2) / beta
   *      T(t) = T_eq + (T_0 − T_eq)·e^(−beta·t)
   *
   *  => t = −ln( (target − T_eq) / (T_0 − T_eq) ) / beta
   *
   * @returns Segundos ate atingir o alvo, ou `null` se o alvo for inatingivel
   *          com a corrente atual (T_eq abaixo do alvo) — o caso normal e
   *          seguro.
   */
  public static timeToReach(
    currentTemp: number,
    motorCurrent: number,
    ambientTemp: number,
    targetC: number,
    coeff?: Partial<ThermalCoefficients>,
  ): number | null {
    const alpha = coeff?.alpha ?? this.ALPHA_HEATING;
    const beta = coeff?.beta ?? this.BETA_COOLING;

    if (!Number.isFinite(currentTemp) || !Number.isFinite(targetC)) return null;
    if (beta <= 0) return null;
    if (currentTemp >= targetC) return 0; // ja passou do alvo

    const I = Number.isFinite(motorCurrent) ? Math.abs(motorCurrent) : 0;
    const Tamb = Number.isFinite(ambientTemp) ? ambientTemp : currentTemp;

    // Temperatura de equilibrio para essa corrente.
    const Teq = Tamb + (alpha * I * I) / beta;

    // Se o equilibrio fica abaixo do alvo, o motor nunca chega la nessa carga.
    if (Teq <= targetC) return null;

    const ratio = (targetC - Teq) / (currentTemp - Teq);
    if (!(ratio > 0)) return null;

    const seconds = -Math.log(ratio) / beta;
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  /** Temperatura de equilibrio para uma corrente sustentada (°C). */
  public static equilibrium(
    motorCurrent: number,
    ambientTemp: number,
    coeff?: Partial<ThermalCoefficients>,
  ): number {
    const alpha = coeff?.alpha ?? this.ALPHA_HEATING;
    const beta = coeff?.beta ?? this.BETA_COOLING;
    if (beta <= 0) return ambientTemp;
    const I = Number.isFinite(motorCurrent) ? Math.abs(motorCurrent) : 0;
    return ambientTemp + (alpha * I * I) / beta;
  }

  /** Coeficientes padrao usados quando nada e passado. */
  public static defaults(): ThermalCoefficients {
    return {
      alpha: this.ALPHA_HEATING,
      beta: this.BETA_COOLING,
      observerGain: this.OBSERVER_GAIN,
    };
  }
}
