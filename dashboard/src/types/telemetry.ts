// Contrato de telemetria Athenas v2.0 (Firmware ESP32 -> Frontend).
// Espelha exatamente o payload JSON definido na Diretriz, transmitido via
// WebSocket a 5 Hz (200 ms). Qualquer mudança aqui deve ser refletida no
// firmware (firmware/onboard) e no servidor mock (mock-server).

export interface GpsData {
  /** Latitude em graus decimais. */
  lat: number;
  /** Longitude em graus decimais. */
  lng: number;
  /** Velocidade sobre o solo em km/h (TinyGPS++ speed.kmh()). */
  speed_kmh: number;
  /** Course over ground em graus (0-360, TinyGPS++ course.deg()). */
  cog: number;
  /** true quando o módulo tem fix de satélites. */
  fix: boolean;
}

export interface SensorData {
  /** Corrente instantânea do motor em Ampéres (ACS758, média móvel j=12). */
  current_a: number;
  /** Tensão da bateria de chumbo-ácido em Volts (divisor resistivo, 0-15V). */
  voltage_v: number;
  /** Temperatura do estator em °C (DS18B20). */
  temp_c: number;
  /** Ângulo do leme em graus (-45 a +45), interceptado do PWM do receptor. */
  rudder_deg: number;
}

export interface StatusData {
  /** Anomalia de arrasto: possível bloqueio por algas. */
  algae_alert: boolean;
  /** Superaquecimento do estator (>= 70 °C). */
  overheat_alert: boolean;
  /** Bateria em nível crítico. */
  battery_low: boolean;
}

/** Quadro completo recebido do barco. */
export interface TelemetryFrame {
  gps: GpsData;
  sensors: SensorData;
  status: StatusData;
}

/** Quadro acrescido do timestamp local de recebimento (epoch ms). */
export interface TelemetrySample extends TelemetryFrame {
  t: number;
}

/** Estados de saúde da embarcação representados pela Sereia Athenas. */
export type VesselHealth = "serena" | "tatica" | "alerta";

/** Estado da conexão de telemetria. */
export type ConnectionStatus =
  | "connecting"
  | "live"
  | "mock"
  | "disconnected";

/** Fonte de dados ativa. */
export type TelemetryMode = "mock" | "live";

/** Níveis de acesso (Sigilo Tático). */
export type AccessRole = "public" | "crew";
