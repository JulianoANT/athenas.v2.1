// =============================================================================
// Contrato de telemetria Athenas v2.1 (Firmware ESP32 -> Frontend).
//
// Espelha exatamente o payload JSON emitido pelo firmware de bordo
// (firmware/onboard/src/main.cpp) via WebSocket a 5 Hz (200 ms).
//
// Qualquer mudanca aqui DEVE ser refletida no firmware. Nao ha simulador:
// o dashboard so exibe dados reais vindos do hardware.
//
// Evolucao v2.0 -> v2.1 (Diretrizes de Engenharia Avancada):
//   + bloco `imu`     : MPU6050 (angulos de Euler + aceleracao)
//   + bloco `ambient` : DHT22 (temperatura/umidade dentro do casco)
//   + bloco `faults`  : flags de "Sensor Fault" (tratamento de dados fantasmas)
//   + `seq` / `uptime_ms` : diagnostico de perda de pacotes e reboot do ESP32
// =============================================================================

export interface GpsData {
  /** Latitude em graus decimais. */
  lat: number;
  /** Longitude em graus decimais. */
  lng: number;
  /** Velocidade sobre o solo em km/h (TinyGPS++ speed.kmph()). */
  speed_kmh: number;
  /** Course over ground em graus (0-360, TinyGPS++ course.deg()). */
  cog: number;
  /** true quando o modulo tem fix de satelites e a idade do dado < 1500 ms. */
  fix: boolean;
  /** Numero de satelites rastreados. */
  sats: number;
  /** Diluicao horizontal de precisao (menor = melhor). */
  hdop: number;
}

/**
 * Atitude do casco medida pelo MPU6050 (I2C: SDA=21, SCL=22).
 * Angulos de Euler em GRAUS — a conversao para radianos e feita apenas na
 * fronteira do WebGL (Three.js opera nativamente em radianos).
 */
export interface ImuData {
  /** Rolagem / Adernamento (phi) — rotacao no eixo longitudinal X.
   *  Negativo = bombordo, positivo = estibordo. */
  roll: number;
  /** Arfagem / Caturro (theta) — rotacao no eixo transversal Y.
   *  Positivo = proa levantando. */
  pitch: number;
  /** Guinada (psi) — rotacao no eixo vertical Z (heading inercial). */
  yaw: number;
  /** Aceleracao propria no eixo X em g. */
  accel_x: number;
  /** Aceleracao propria no eixo Y em g. */
  accel_y: number;
  /** Aceleracao propria no eixo Z em g (~1 g em repouso nivelado). */
  accel_z: number;
}

export interface SensorData {
  /** Corrente instantanea do motor em Amperes (ACS758, oversampling 16 + EMA). */
  current_a: number;
  /** Tensao da bateria de chumbo-acido em Volts (divisor resistivo, 0-15V). */
  voltage_v: number;
  /** Temperatura do estator em °C (DS18B20, GPIO 4 com pull-up 4k7). */
  temp_c: number;
  /** Angulo do leme em graus (-45 a +45), interceptado do PWM do receptor. */
  rudder_deg: number;
}

/** Ambiente interno do casco (DHT22, GPIO 15) — T_amb do modelo termico. */
export interface AmbientData {
  /** Temperatura ambiente dentro do casco em °C. */
  temp_c: number;
  /** Umidade relativa em % (indicador de infiltracao). */
  humidity: number;
}

export interface StatusData {
  /** Anomalia de arrasto: possivel bloqueio por algas. */
  algae_alert: boolean;
  /** Superaquecimento do estator (>= 70 °C). */
  overheat_alert: boolean;
  /** Bateria em nivel critico. */
  battery_low: boolean;
}

/**
 * Flags de "Sensor Fault". Quando `true`, o valor correspondente no quadro e o
 * ULTIMO VALOR VALIDO retido pelo firmware — nao um dado fresco. A UI deve
 * marcar essas leituras como suspeitas em vez de trata-las como reais.
 */
export interface FaultFlags {
  /** GPS sem fix valido ou dado velho (age >= 1500 ms). */
  gps: boolean;
  /** MPU6050 ausente/nao respondendo no barramento I2C. */
  imu: boolean;
  /** DS18B20 retornou -127.00 / 85.00 (erro classico de 1-Wire). */
  motor_temp: boolean;
  /** DHT22 retornou NaN (falha de leitura por vibracao do casco). */
  ambient: boolean;
}

/**
 * Qualidade do enlace de radio, medida pelo MESTRE em terra.
 *
 * Diferente de todo o resto do contrato, estes campos NAO vem do barco: sao
 * medidos pelo SX1262 do receptor ao demodular cada pacote. Sao a ferramenta
 * de campo para apontar a antena e julgar se o alcance chegou ao limite.
 */
export interface LinkQuality {
  /** Potencia do sinal recebido, em dBm. Tipico: -40 (perto) a -120 (limite). */
  rssi: number;
  /** Relacao sinal-ruido, em dB. Abaixo de -7 dB o LoRa comeca a perder. */
  snr: number;
  /** Pacotes perdidos no ar, deduzidos das lacunas no contador `seq`. */
  lost: number;
  /** Pacotes recebidos com CRC invalido (corrompidos na propagacao). */
  corrupt: number;
}

/** Quadro completo recebido do barco. */
export interface TelemetryFrame {
  gps: GpsData;
  imu: ImuData;
  sensors: SensorData;
  ambient: AmbientData;
  status: StatusData;
  faults: FaultFlags;
  /**
   * Qualidade do enlace LoRa. `null` quando o dashboard fala direto com o
   * barco por WiFi (sem radio no caminho).
   */
  link: LinkQuality | null;
  /** Contador sequencial de quadros (detecta perda de pacotes). */
  seq: number;
  /** millis() do ESP32 — uma queda no valor indica reboot da placa. */
  uptime_ms: number;
}

/** Quadro acrescido do timestamp local de recebimento (epoch ms). */
export interface TelemetrySample extends TelemetryFrame {
  t: number;
}

/**
 * Quadro apos o pipeline do Web Worker: acrescido dos campos derivados
 * calculados fora da main thread (Filtro de Kalman 2D no GPS).
 */
export interface ProcessedSample extends TelemetrySample {
  /** Latitude suavizada pelo Filtro de Kalman 2D (trilha azul do mapa). */
  lat_f: number;
  /** Longitude suavizada pelo Filtro de Kalman 2D. */
  lng_f: number;
}

/** Estados de saude da embarcacao representados pela Sereia Athenas. */
export type VesselHealth = "serena" | "tatica" | "alerta";

/** Estado da conexao de telemetria com o ESP32. */
export type ConnectionStatus = "connecting" | "live" | "disconnected";

/** Niveis de acesso (Sigilo Tatico). */
export type AccessRole = "public" | "crew";
