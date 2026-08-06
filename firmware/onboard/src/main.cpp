// ============================================================================
//  Athenas v2.2 — Firmware do ESCRAVO (a bordo da embarcacao)
//
//  Placa: Heltec WiFi LoRa 32 (V3)  —  ESP32-S3 + SX1262 + OLED
//  Framework: Arduino  |  Build: PlatformIO
//
//  PAPEL: ler todos os sensores de bordo e transmitir por LoRa (915 MHz) para
//  o MESTRE em terra. NAO ha WiFi aqui: o barco fica a centenas de metros no
//  rio, fora do alcance de 2,4 GHz.
//
//  ┌──────────────┐   LoRa 915 MHz    ┌──────────────┐   WiFi AP   ┌─────────┐
//  │   ESCRAVO    │  39 bytes @ 5 Hz  │    MESTRE    │  WebSocket  │   PC    │
//  │  (no barco)  │ ────────────────▶ │  (em terra)  │ ──────────▶ │ Athenas │
//  └──────────────┘                   └──────────────┘             └─────────┘
//
//  ---------------------------------------------------------------------------
//  MANDAMENTOS (nao viole ao editar)
//  ---------------------------------------------------------------------------
//   1. NENHUM delay() no loop. Tudo cadenciado por millis().
//   2. NENHUMA alocacao dinamica no caminho quente (sem String, sem new).
//   3. WiFi/Bluetooth DESLIGADOS. Consomem energia, geram ruido e nao ha
//      ninguem para conectar no meio do rio.
//   4. A transmissao LoRa e ASSINCRONA (startTransmit + IRQ). Um sendPacket()
//      bloqueante travaria o loop por ~82 ms a cada quadro — 41% do tempo de
//      CPU parado, e o GPS perderia bytes da UART.
// ============================================================================

#include <Arduino.h>
#include <WiFi.h>   // usado apenas para DESLIGAR o radio de 2,4 GHz
#include <Wire.h>
#include <SPI.h>
#include <RadioLib.h>
#include <U8g2lib.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPS++.h>
#include <DHT.h>

#include "athenas_link.h"

// ============================================================================
//  1) MAPA DE PINOS — Heltec WiFi LoRa 32 V3 (ESP32-S3)
//
//  ATENCAO: esta placa NAO e um ESP32 classico. GPIO 22, 23, 25, 27 e 32 NAO
//  EXISTEM no ESP32-S3, e os pinos 43/44 sao o conversor USB-serial.
//
//  Os pinos abaixo seguem o MAPA DEFINITIVO fornecido pela equipe, conferido
//  contra a fiacao real do barco. Dois deles merecem nota:
//
//   - GPIO 39 a 42 sao as linhas de JTAG do ESP32-S3. Funcionam perfeitamente
//     como GPIO comuns (e assim que os usamos aqui), mas se algum dia a equipe
//     quiser depurar por JTAG, havera conflito. Para telemetria, sem problema.
//
//   - GPIO 3 e 7 estao no ADC1. Isso NAO e detalhe: o ADC2 e usado
//     internamente pelo radio WiFi e devolve lixo quando ele esta ligado.
//     Toda leitura analogica precisa ficar no ADC1 (GPIO 1-10).
// ============================================================================

// --- LoRa SX1262 (fixo na placa, nao mexer) ---
static const int PIN_LORA_NSS  = 8;
static const int PIN_LORA_SCK  = 9;
static const int PIN_LORA_MOSI = 10;
static const int PIN_LORA_MISO = 11;
static const int PIN_LORA_RST  = 12;
static const int PIN_LORA_BUSY = 13;
static const int PIN_LORA_DIO1 = 14;

// --- OLED SSD1306 (fixo na placa) ---
static const int PIN_OLED_SDA = 17;
static const int PIN_OLED_SCL = 18;
static const int PIN_OLED_RST = 21;
static const int PIN_VEXT     = 36;  // alimentacao dos perifericos (ATIVO EM LOW)

// --- Sensores externos (MAPA DEFINITIVO da equipe) ---
//
// Na Heltec V3 a serigrafia do PCB coincide 1:1 com a numeracao das GPIOs do
// ESP32-S3: o pino impresso 3 e a GPIO 3.
//
// O MPU6050 tem BARRAMENTO I2C PROPRIO (41/42), separado do barramento interno
// do OLED (17/18). O ESP32-S3 tem dois controladores I2C, entao usamos `Wire`
// para o display e `Wire1` para o sensor. Alem de seguir a fiacao da equipe,
// isso isola os dois: se um jumper do MPU soltar com a vibracao do casco, o
// display continua funcionando e mostrando a falha.

static const int PIN_I2C_SDA = 41;    // SDA do MPU6050  (barramento Wire1)
static const int PIN_I2C_SCL = 42;    // SCL do MPU6050  (barramento Wire1)

// UART do GPS. ATENCAO ao cruzamento: o TX do modulo vai no RX do ESP32.
//   GPS TX (39) -> ESP RX      |      GPS RX (38) <- ESP TX
static const int PIN_GPS_RX    = 39;  // RX do ESP32 <- TX do GPS
static const int PIN_GPS_TX    = 38;  // TX do ESP32 -> RX do GPS

static const int PIN_TENSAO    = 3;   // ADC1_CH2 — sensor de tensao DC 0-25V
static const int PIN_ACS758    = 7;   // ADC1_CH6 — corrente Hall -50A a +50A
static const int PIN_DS18B20   = 4;   // 1-Wire (pull-up 4k7 OBRIGATORIO)
static const int PIN_DHT22     = 5;   // digital
static const int PIN_LEME_PWM  = 6;   // PWM do receptor RC (interrupcao)

#define DHT_TIPO DHT22

// ============================================================================
//  2) PARAMETROS DO ENLACE LORA
//
//  ---------------------------------------------------------------------------
//  A ESCOLHA DE SF7/BW125 NAO E ARBITRARIA — E O UNICO PONTO QUE SUSTENTA 5 Hz
//  ---------------------------------------------------------------------------
//  Airtime de um pacote de 39 bytes, e o alcance tipico com visada livre:
//
//    SF   BW      airtime   maximo Hz   ciclo @5Hz   alcance (sobre agua)
//    ---  ------  --------  ----------  -----------  --------------------
//    SF7  125kHz    82 ms      12 Hz        41%        ~2-3 km   <-- PADRAO
//    SF7  250kHz    41 ms      24 Hz        21%        ~1,5-2 km
//    SF8  125kHz   144 ms       6 Hz        72%        ~3-4 km
//    SF9  125kHz   267 ms       3 Hz        NAO CABE   ~5 km
//    SF10 125kHz   493 ms       2 Hz        NAO CABE   ~7 km
//
//  Ou seja: 5 Hz custa alcance. Se o rio for mais longo do que o SF7 alcanca,
//  BAIXE A TAXA em vez de forcar — ver INTERVALO_TX_MS. O dashboard mede a
//  cadencia real e se adapta sozinho; nada no software assume 5 Hz.
//
//  FREQUENCIA: 915 MHz. No Brasil a ANATEL libera 902-907,5 e 915-928 MHz
//  para uso sem licenca. NAO use 868 MHz (faixa europeia) aqui.
// ============================================================================

static const float   LORA_FREQ_MHZ   = 915.0f;
static const float   LORA_BW_KHZ     = 125.0f;
static const uint8_t LORA_SF         = 7;
static const uint8_t LORA_CR         = 5;     // coding rate 4/5
static const int8_t  LORA_TX_DBM     = 20;    // 100 mW, dentro do limite ANATEL
static const uint16_t LORA_PREAMBLE  = 8;

// TCXO da Heltec V3: 1,8 V no DIO3. SEM ISTO O RADIO NAO INICIALIZA.
static const float LORA_TCXO_V = 1.8f;

/** Intervalo entre transmissoes. 200 ms = 5 Hz. Aumente para ganhar alcance. */
static const unsigned long INTERVALO_TX_MS = 200;

// ============================================================================
//  3) CALIBRACAO DOS SENSORES
// ============================================================================

// --- ADC do ESP32-S3 (12 bits) ---
static const float ADC_VREF = 3.3f;
static const int   ADC_MAX  = 4095;

// --- ACS758 (+-50A) ---
// Sensibilidade tipica 40 mV/A; offset de 0 A em Vcc/2.
// O sensor opera em 5 V e a entrada do S3 e 3,3 V -> use divisor e ajuste
// ACS758_OFFSET_V para o que CHEGA no pino.
static const float ACS758_SENS_V_POR_A = 0.040f;
static const float ACS758_OFFSET_V     = 1.65f;
static const int   ACS758_OVERSAMPLES  = 16;
static const float ACS758_EMA_ALPHA    = 0.15f;

// --- Sensor de Tensao DC (modulo 0-25 V com divisor resistivo 5:1) ---
// O modulo divide a tensao de entrada por 5, entao 25 V na bateria chegam como
// 5 V na saida. ATENCAO: isso e MAIS do que os 3,3 V que o ESP32-S3 aceita —
// acima de ~16,5 V de entrada o pino satura. Para a bateria de chumbo-acido
// 12 V do projeto (12,7 V no maximo -> 2,54 V no ADC) fica dentro da faixa com
// folga, mas nao ligue nada acima de 16 V neste pino.
static const float TENSAO_DIVISOR_RATIO = 5.0f;
static const float TENSAO_EMA_ALPHA     = 0.20f;

// --- Leme (PWM tipo servo) ---
static const long LEME_PULSO_MIN_US = 1000;   // -45°
static const long LEME_PULSO_MID_US = 1500;   //   0°
static const long LEME_PULSO_MAX_US = 2000;   // +45°
static const int  LEME_ANGULO_MIN   = -45;
static const int  LEME_ANGULO_MAX   = +45;

// --- MPU6050 ---
// Dois enderecos possiveis: 0x68 com AD0 em GND (ou solto), 0x69 com AD0 em
// VCC. O firmware TESTA OS DOIS no boot em vez de exigir que a montagem siga
// uma convencao — trocar de placa nao pode virar uma hora de depuracao.
static const uint8_t MPU6050_ADDR_LOW  = 0x68;
static const uint8_t MPU6050_ADDR_HIGH = 0x69;

/** Endereco efetivamente detectado no barramento. */
uint8_t g_mpuAddr = MPU6050_ADDR_LOW;

static const uint8_t MPU6050_REG_PWR_MGMT = 0x6B;
static const uint8_t MPU6050_REG_ACCEL    = 0x3B;
static const uint8_t MPU6050_REG_WHOAMI   = 0x75;
static const uint8_t MPU6050_REG_CONFIG   = 0x1A;
static const uint8_t MPU6050_REG_GYRO_CFG = 0x1B;
static const uint8_t MPU6050_REG_ACC_CFG  = 0x1C;

static const float MPU_ACCEL_LSB_POR_G    = 16384.0f;  // +-2g
static const float MPU_GYRO_LSB_POR_DEG_S = 131.0f;    // +-250 °/s

// Filtro complementar: peso do giroscopio. 0,98 confia no giro no curto prazo
// (rapido, imune a vibracao) e usa o acelerometro so para corrigir a deriva.
static const float FILTRO_COMPLEMENTAR_ALFA = 0.98f;

// --- Limiares de alerta ---
static const float LIMIAR_TEMP_OVERHEAT_C = 70.0f;
static const float LIMIAR_BATERIA_BAIXA_V = 11.8f;
static const float LIMIAR_ALGA_CORRENTE_A = 25.0f;
static const float LIMIAR_ALGA_VELOC_KMH  = 2.0f;
static const unsigned long LIMIAR_ALGA_TEMPO_MS = 1500;

// --- Validacao (tratamento de dados fantasmas) ---
static const float DS18B20_ERRO_DESCONECTADO = -127.0f;
static const float DS18B20_ERRO_POWERON      = 85.0f;
static const float TEMP_MIN_PLAUSIVEL_C      = -20.0f;
static const float TEMP_MAX_PLAUSIVEL_C      = 150.0f;
static const unsigned long GPS_IDADE_MAX_MS  = 1500;

// --- Cadencias internas (nao bloqueantes) ---
static const unsigned long INTERVALO_TEMP_MS = 1000;  // DS18B20 e lento
static const unsigned long INTERVALO_DHT_MS  = 2000;  // datasheet exige >= 2 s
static const unsigned long INTERVALO_IMU_MS  = 20;    // 50 Hz para a fusao
static const unsigned long INTERVALO_OLED_MS = 500;   // display

/**
 * Intervalo de RETENTATIVA quando o MPU6050 nao responde.
 *
 * Sem isto, um sensor ausente ou com cabo solto era sondado 50 vezes por
 * segundo. Cada tentativa gera uma linha de erro do driver I2C, e o console
 * fica ilegivel — justamente quando voce mais precisa ler as outras mensagens
 * para descobrir o que houve. Alem de queimar CPU a toa.
 *
 * Com a retentativa lenta, o sensor volta sozinho se for reconectado em campo,
 * mas um sensor ausente custa uma sondagem a cada 3 s em vez de 150.
 */
static const unsigned long INTERVALO_RETRY_IMU_MS = 3000;

/**
 * Intervalo do resumo de status na serial.
 *
 * O OLED ja mostra os contadores, mas na bancada com o monitor aberto e muito
 * mais pratico ver a linha rolando — e e o unico jeito de confirmar que o
 * escravo esta MESMO transmitindo sem ter que olhar o display.
 */
static const unsigned long INTERVALO_STATUS_MS = 5000;

// ============================================================================
//  4) OBJETOS GLOBAIS
// ============================================================================

// SPI dedicado ao radio (o S3 tem varios; usamos o FSPI livre).
SPIClass loraSpi(FSPI);
SX1262 radio = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RST,
                          PIN_LORA_BUSY, loraSpi);

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, PIN_OLED_RST,
                                         PIN_OLED_SCL, PIN_OLED_SDA);

OneWire oneWire(PIN_DS18B20);
DallasTemperature sensorTemp(&oneWire);

TinyGPSPlus gps;
DHT dht(PIN_DHT22, DHT_TIPO);

/** Pacote de transmissao — alocado UMA vez, reaproveitado a cada quadro. */
AthenasPacket txPacket;

// ============================================================================
//  5) ESTADO GLOBAL
// ============================================================================

// --- GPS ---
double g_lat = 0.0, g_lng = 0.0, g_speed_kmh = 0.0, g_cog = 0.0;
bool   g_fix = false;
int    g_sats = 0;
double g_hdop = 99.0;

// --- IMU ---
float g_roll = 0.0f, g_pitch = 0.0f, g_yaw = 0.0f;

// --- Sensores ---
float g_current_a = 0.0f, g_voltage_v = 0.0f, g_temp_c = 0.0f;
int   g_rudder_deg = 0;
float g_amb_temp_c = 0.0f, g_amb_hum = 0.0f;

// --- Alertas ---
bool g_algae_alert = false, g_overheat_alert = false, g_battery_low = false;

// --- Flags de falha ---
bool g_fault_gps = true, g_fault_imu = true;
bool g_fault_motor_temp = true, g_fault_ambient = true;

// --- Enlace ---
uint16_t g_seq = 0;
uint32_t g_tx_ok = 0, g_tx_err = 0;
/** Instante em que a transmissao atual comecou (para o watchdog de TX). */
unsigned long inicioTxMs = 0;

// --- Filtros ---
float emaCorrente = 0.0f; bool emaCorrenteIniciado = false;
float emaTensao  = 0.0f;  bool emaTensaoIniciado  = false;

// --- Detector de alga ---
unsigned long algaInicioMs = 0;
bool          algaContando = false;

// --- Temporizadores ---
unsigned long ultimaTxMs = 0, ultimaTempMs = 0, ultimaDhtMs = 0;
unsigned long ultimaImuMs = 0, ultimaOledMs = 0, ultimaStatusMs = 0;

// ============================================================================
//  6) TRANSMISSAO ASSINCRONA
//
//  `transmittedFlag` e setado pela ISR do DIO1 quando o radio termina de
//  transmitir. O loop so precisa checar a flag — nunca bloqueia esperando os
//  82 ms de airtime.
// ============================================================================

volatile bool transmittedFlag = false;
bool transmitindo = false;

void IRAM_ATTR onLoRaTxDone() {
  transmittedFlag = true;
}

// ============================================================================
//  7) LEME — interceptacao passiva do PWM por interrupcao
// ============================================================================

volatile unsigned long lemeInicioPulsoUs = 0;
volatile unsigned long lemeLarguraUs     = LEME_PULSO_MID_US;
volatile bool          lemeNovoPulso     = false;

void IRAM_ATTR isrLeme() {
  unsigned long agoraUs = micros();
  if (digitalRead(PIN_LEME_PWM) == HIGH) {
    lemeInicioPulsoUs = agoraUs;
  } else {
    unsigned long largura = agoraUs - lemeInicioPulsoUs;
    // Ignora ruido fora da faixa de um servo (0,5-2,5 ms).
    if (largura >= 500 && largura <= 2500) {
      lemeLarguraUs = largura;
      lemeNovoPulso = true;
    }
  }
}

// ============================================================================
//  8) MPU6050 — driver I2C minimo
//
//  Falamos I2C direto em vez de puxar uma biblioteca: sao ~40 linhas, elimina
//  uma dependencia e nos da controle total sobre o tratamento de falha do
//  barramento — que e justamente o que precisamos reportar ao painel.
// ============================================================================

/**
 * Sondagem SILENCIOSA de presenca no barramento.
 *
 * Usa apenas beginTransmission/endTransmission — nao chama requestFrom(), que e
 * quem emite a linha "i2cWriteReadNonStop returned Error -1" do driver. Assim
 * podemos procurar o sensor sem poluir o console.
 */
bool i2cPresente(uint8_t addr) {
  Wire1.beginTransmission(addr);
  return Wire1.endTransmission() == 0;
}

/**
 * Varre o barramento e imprime tudo o que responder.
 *
 * E o primeiro diagnostico a olhar quando a IMU nao aparece: se o OLED (0x3C)
 * responde e o MPU nao, o barramento esta bom e o problema e a ligacao do
 * sensor. Se nada responde, o problema e SDA/SCL, alimentacao ou pull-ups.
 */
void i2cScan() {
  Serial.printf("[I2C] Varrendo o barramento do MPU6050 (SDA %d / SCL %d)...\n",
                PIN_I2C_SDA, PIN_I2C_SCL);
  int encontrados = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    if (!i2cPresente(addr)) continue;
    encontrados++;
    const char* conhecido = "";
    if (addr == 0x3C || addr == 0x3D) conhecido = "  <- OLED (outro barramento)";
    else if (addr == 0x68)            conhecido = "  <- MPU6050 (AD0 em GND)";
    else if (addr == 0x69)            conhecido = "  <- MPU6050 (AD0 em VCC)";
    Serial.printf("[I2C]   0x%02X%s\n", addr, conhecido);
  }
  if (encontrados == 0) {
    Serial.printf("[I2C]   NADA no barramento. Cheque SDA no GPIO %d, "
                  "SCL no GPIO %d, 3V3 e GND.\n", PIN_I2C_SDA, PIN_I2C_SCL);
  }
}

bool mpuEscreverReg(uint8_t reg, uint8_t valor) {
  Wire1.beginTransmission(g_mpuAddr);
  Wire1.write(reg);
  Wire1.write(valor);
  return Wire1.endTransmission() == 0;
}

bool mpuIniciar() {
  // Descobre em qual dos dois enderecos o sensor esta. A sondagem e silenciosa,
  // entao tentar os dois nao gera ruido no console.
  if (i2cPresente(MPU6050_ADDR_LOW)) {
    g_mpuAddr = MPU6050_ADDR_LOW;
  } else if (i2cPresente(MPU6050_ADDR_HIGH)) {
    g_mpuAddr = MPU6050_ADDR_HIGH;
  } else {
    return false;  // nao esta no barramento: nem tenta ler
  }

  Wire1.beginTransmission(g_mpuAddr);
  Wire1.write(MPU6050_REG_WHOAMI);
  if (Wire1.endTransmission(false) != 0) return false;
  if (Wire1.requestFrom((int)g_mpuAddr, 1) != 1) return false;
  uint8_t who = Wire1.read();
  if (who == 0xFF || who == 0x00) return false;

  // Acorda o sensor usando o giroscopio X como clock (mais estavel que o
  // oscilador interno).
  if (!mpuEscreverReg(MPU6050_REG_PWR_MGMT, 0x01)) return false;
  delay(10);  // permitido: setup, nao o loop

  // Passa-baixa digital em 44 Hz — corta a vibracao do motor antes que ela
  // contamine a estimativa de atitude.
  if (!mpuEscreverReg(MPU6050_REG_CONFIG, 0x03)) return false;
  if (!mpuEscreverReg(MPU6050_REG_GYRO_CFG, 0x00)) return false;  // +-250 °/s
  if (!mpuEscreverReg(MPU6050_REG_ACC_CFG, 0x00)) return false;   // +-2g

  Serial.printf("[IMU] MPU6050 em 0x%02X (WHO_AM_I = 0x%02X)\n", g_mpuAddr, who);
  return true;
}

bool mpuAtualizar(float dtSegundos) {
  Wire1.beginTransmission(g_mpuAddr);
  Wire1.write(MPU6050_REG_ACCEL);
  if (Wire1.endTransmission(false) != 0) return false;
  if (Wire1.requestFrom((int)g_mpuAddr, 14) != 14) return false;

  int16_t axRaw = (Wire1.read() << 8) | Wire1.read();
  int16_t ayRaw = (Wire1.read() << 8) | Wire1.read();
  int16_t azRaw = (Wire1.read() << 8) | Wire1.read();
  Wire1.read(); Wire1.read();                     // temperatura interna: ignorada
  int16_t gxRaw = (Wire1.read() << 8) | Wire1.read();
  int16_t gyRaw = (Wire1.read() << 8) | Wire1.read();
  int16_t gzRaw = (Wire1.read() << 8) | Wire1.read();

  float ax = axRaw / MPU_ACCEL_LSB_POR_G;
  float ay = ayRaw / MPU_ACCEL_LSB_POR_G;
  float az = azRaw / MPU_ACCEL_LSB_POR_G;
  float gx = gxRaw / MPU_GYRO_LSB_POR_DEG_S;
  float gy = gyRaw / MPU_GYRO_LSB_POR_DEG_S;
  float gz = gzRaw / MPU_GYRO_LSB_POR_DEG_S;

  // Todos os eixos zerados = cabo solto.
  if (ax == 0.0f && ay == 0.0f && az == 0.0f) return false;

  // Atitude pelo acelerometro: boa no longo prazo (nao deriva), pessima no
  // curto (le a aceleracao do barco como se fosse inclinacao).
  float rollAcc  = atan2(ay, az) * 180.0f / PI;
  float pitchAcc = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0f / PI;

  // FILTRO COMPLEMENTAR: integra o giro e puxa devagar para a referencia.
  g_roll  = FILTRO_COMPLEMENTAR_ALFA * (g_roll  + gx * dtSegundos)
          + (1.0f - FILTRO_COMPLEMENTAR_ALFA) * rollAcc;
  g_pitch = FILTRO_COMPLEMENTAR_ALFA * (g_pitch + gy * dtSegundos)
          + (1.0f - FILTRO_COMPLEMENTAR_ALFA) * pitchAcc;

  // A guinada e integracao pura do giroscopio (sem magnetometro) e VAI derivar
  // alguns graus por minuto. Serve para animar o horizonte artificial; para
  // rumo de navegacao, confie no COG do GPS.
  g_yaw += gz * dtSegundos;
  if (g_yaw >= 360.0f) g_yaw -= 360.0f;
  if (g_yaw < 0.0f)    g_yaw += 360.0f;

  return true;
}

// ============================================================================
//  9) LEITURA DOS SENSORES
// ============================================================================

void lerCorrente() {
  // Oversampling: 16 leituras reduzem o ruido branco do ADC por sqrt(16) = 4.
  uint32_t soma = 0;
  for (int i = 0; i < ACS758_OVERSAMPLES; i++) soma += analogRead(PIN_ACS758);
  float mediaAdc = (float)soma / (float)ACS758_OVERSAMPLES;

  float tensao = (mediaAdc / ADC_MAX) * ADC_VREF;
  float corrente = (tensao - ACS758_OFFSET_V) / ACS758_SENS_V_POR_A;

  // EMA: alisa o residuo sem buffer circular (O(1) em tempo e memoria).
  if (!emaCorrenteIniciado) {
    emaCorrente = corrente;
    emaCorrenteIniciado = true;
  } else {
    emaCorrente = ACS758_EMA_ALPHA * corrente
                + (1.0f - ACS758_EMA_ALPHA) * emaCorrente;
  }
  g_current_a = emaCorrente;
}

void lerTensao() {
  uint32_t soma = 0;
  for (int i = 0; i < 8; i++) soma += analogRead(PIN_TENSAO);
  // Tensao que chega ao pino, depois desfeito o divisor 5:1 do modulo.
  float tensaoAdc = ((float)soma / 8.0f / (float)ADC_MAX) * ADC_VREF;
  float bateria = tensaoAdc * TENSAO_DIVISOR_RATIO;

  if (!emaTensaoIniciado) {
    emaTensao = bateria;
    emaTensaoIniciado = true;
  } else {
    emaTensao = TENSAO_EMA_ALPHA * bateria
              + (1.0f - TENSAO_EMA_ALPHA) * emaTensao;
  }
  g_voltage_v = emaTensao;
}

void atualizarLeme() {
  if (!lemeNovoPulso) return;
  noInterrupts();
  unsigned long largura = lemeLarguraUs;
  lemeNovoPulso = false;
  interrupts();

  long ang = map((long)largura, LEME_PULSO_MIN_US, LEME_PULSO_MAX_US,
                 LEME_ANGULO_MIN, LEME_ANGULO_MAX);
  g_rudder_deg = (int)constrain(ang, LEME_ANGULO_MIN, LEME_ANGULO_MAX);
}

void atualizarGps() {
  while (Serial1.available() > 0) gps.encode(Serial1.read());

  // Aceita o dado so se for valido E RECENTE. Sem o teste de idade, um GPS que
  // perdeu o fix reportaria a ultima posicao para sempre.
  bool posOk = gps.location.isValid() && gps.location.age() < GPS_IDADE_MAX_MS;

  if (posOk) {
    g_lat = gps.location.lat();
    g_lng = gps.location.lng();
    g_fix = true;
    g_fault_gps = false;
  } else {
    g_fix = false;
    g_fault_gps = true;
    // Retem a ultima posicao valida (nao zera): o painel mostra o ultimo ponto
    // conhecido, marcado como suspeito.
  }

  if (gps.speed.isValid() && gps.speed.age() < GPS_IDADE_MAX_MS) {
    g_speed_kmh = gps.speed.kmph();
  } else if (!posOk) {
    g_speed_kmh = 0.0;
  }

  if (gps.course.isValid() && gps.course.age() < GPS_IDADE_MAX_MS) {
    g_cog = gps.course.deg();
  }
  if (gps.satellites.isValid()) g_sats = gps.satellites.value();
  if (gps.hdop.isValid())       g_hdop = gps.hdop.hdop();
}

void atualizarTempMotor() {
  float t = sensorTemp.getTempCByIndex(0);

  // -127,00 = barramento aberto (fio solto / pull-up 4k7 ausente)
  //   85,00 = valor de power-on, lido antes da conversao terminar
  // Ambos sao codigos de ERRO, nao temperaturas.
  bool erro = (t == DEVICE_DISCONNECTED_C)
           || (t <= DS18B20_ERRO_DESCONECTADO + 0.5f)
           || (fabs(t - DS18B20_ERRO_POWERON) < 0.01f)
           || (t < TEMP_MIN_PLAUSIVEL_C) || (t > TEMP_MAX_PLAUSIVEL_C)
           || isnan(t);

  if (erro) {
    g_fault_motor_temp = true;   // retem o ultimo valor valido
  } else {
    g_temp_c = t;
    g_fault_motor_temp = false;
  }
  sensorTemp.requestTemperatures();  // dispara a proxima conversao (assincrona)
}

void atualizarDht() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  bool erro = isnan(t) || isnan(h)
           || t < TEMP_MIN_PLAUSIVEL_C || t > TEMP_MAX_PLAUSIVEL_C
           || h < 0.0f || h > 100.0f;

  if (erro) {
    g_fault_ambient = true;
  } else {
    g_amb_temp_c = t;
    g_amb_hum = h;
    g_fault_ambient = false;
  }
}

void avaliarStatus() {
  // So afirmamos superaquecimento se a leitura for CONFIAVEL. Disparar a sirene
  // por causa de um sensor solto destroi a confianca da tripulacao no painel.
  g_overheat_alert = (!g_fault_motor_temp) &&
                     (g_temp_c >= LIMIAR_TEMP_OVERHEAT_C);

  g_battery_low = (g_voltage_v <= LIMIAR_BATERIA_BAIXA_V);

  // Alga: helice presa -> esforco sobe mas o barco quase nao anda.
  bool condicaoAlga = (!g_fault_gps) &&
                      (g_current_a > LIMIAR_ALGA_CORRENTE_A) &&
                      (g_speed_kmh < LIMIAR_ALGA_VELOC_KMH);

  unsigned long agora = millis();
  if (condicaoAlga) {
    if (!algaContando) { algaContando = true; algaInicioMs = agora; }
    g_algae_alert = (agora - algaInicioMs) >= LIMIAR_ALGA_TEMPO_MS;
  } else {
    algaContando = false;
    g_algae_alert = false;
  }
}

// ============================================================================
//  10) MONTAGEM E TRANSMISSAO DO PACOTE
// ============================================================================

void montarPacote() {
  txPacket.seq = g_seq++;

  txPacket.lat_e7 = (int32_t)athenas_clamp_i32(g_lat * 1e7, INT32_MIN, INT32_MAX);
  txPacket.lng_e7 = (int32_t)athenas_clamp_i32(g_lng * 1e7, INT32_MIN, INT32_MAX);

  // km/h -> cm/s : (km/h) * 1000 m / 3600 s * 100 cm = * 27,7778
  txPacket.speed_cms = athenas_to_u16(g_speed_kmh, 27.77778);
  txPacket.cog_ddeg  = athenas_to_u16(fmod(g_cog + 360.0, 360.0), 10.0);

  txPacket.roll_ddeg  = athenas_to_i16(g_roll, 10.0);
  txPacket.pitch_ddeg = athenas_to_i16(g_pitch, 10.0);
  txPacket.yaw_ddeg   = athenas_to_u16(fmod(g_yaw + 360.0f, 360.0f), 10.0);

  txPacket.current_ca    = athenas_to_i16(g_current_a, 100.0);
  txPacket.voltage_cv    = athenas_to_u16(g_voltage_v, 100.0);
  txPacket.temp_ddeg     = athenas_to_i16(g_temp_c, 10.0);
  txPacket.amb_temp_ddeg = athenas_to_i16(g_amb_temp_c, 10.0);

  txPacket.rudder_deg = (int8_t)constrain(g_rudder_deg, -127, 127);
  txPacket.humidity   = (uint8_t)constrain((int)(g_amb_hum + 0.5f), 0, 100);
  txPacket.sats       = (uint8_t)constrain(g_sats, 0, 255);
  txPacket.hdop_d     = (g_hdop >= 25.4 || g_hdop <= 0)
                          ? ATH_HDOP_INVALID
                          : (uint8_t)(g_hdop * 10.0 + 0.5);

  uint8_t flags = 0;
  if (g_fix)               flags |= ATH_FLAG_FIX;
  if (g_algae_alert)       flags |= ATH_FLAG_ALGAE;
  if (g_overheat_alert)    flags |= ATH_FLAG_OVERHEAT;
  if (g_battery_low)       flags |= ATH_FLAG_BATTERY_LOW;
  if (g_fault_gps)         flags |= ATH_FLAG_FAULT_GPS;
  if (g_fault_imu)         flags |= ATH_FLAG_FAULT_IMU;
  if (g_fault_motor_temp)  flags |= ATH_FLAG_FAULT_TEMP;
  if (g_fault_ambient)     flags |= ATH_FLAG_FAULT_AMB;
  txPacket.flags = flags;

  txPacket.uptime_s = (uint16_t)(millis() / 1000);

  athenas_packet_finalize(&txPacket);  // grava magic, version e CRC
}

void transmitirPacote() {
  // Ainda transmitindo o quadro anterior? Pula este. Perder um quadro e melhor
  // do que enfileirar e transmitir dado velho — no fim da fila, a posicao
  // reportada estaria segundos atrasada em relacao ao barco real.
  if (transmitindo) return;

  montarPacote();

  int estado = radio.startTransmit((uint8_t*)&txPacket, ATHENAS_PACKET_SIZE);
  if (estado == RADIOLIB_ERR_NONE) {
    transmitindo = true;
    inicioTxMs = millis();
  } else {
    g_tx_err++;
    Serial.printf("[LoRa] Falha ao iniciar TX: %d\n", estado);
  }
}

/**
 * WATCHDOG DE TRANSMISSAO.
 *
 * A transmissao assincrona depende da interrupcao de DIO1 para saber que
 * terminou. Se essa interrupcao nao chegar — ruido no pino, radio travado, IRQ
 * perdida — a flag `transmitindo` fica presa em true PARA SEMPRE, e o barco
 * para de transmitir em silencio absoluto: sem erro, sem log, sem sintoma
 * nenhum alem do painel congelar.
 *
 * Esse era um ponto unico de falha inaceitavel numa prova. Aqui, se a
 * transmissao passar do dobro do pior airtime possivel, forcamos a liberacao e
 * contabilizamos o erro — o enlace se recupera sozinho e o contador ERR no OLED
 * mostra que algo esta errado.
 */
void watchdogTx() {
  if (!transmitindo) return;
  // Pior caso em SF12/BW125 fica abaixo de 3 s; 1 s cobre com folga o SF7 usado.
  if (millis() - inicioTxMs < 1000) return;

  g_tx_err++;
  transmitindo = false;
  transmittedFlag = false;
  radio.finishTransmit();
  radio.standby();
  Serial.println("[LoRa] TX travada (IRQ perdida). Radio liberado a forca.");
}

// ============================================================================
//  11) OLED — status local (util na bancada e ao embarcar)
// ============================================================================

void atualizarOled() {
  char linha[24];
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);

  oled.drawStr(0, 8, "ATHENAS ESCRAVO");
  oled.drawHLine(0, 11, 128);

  snprintf(linha, sizeof(linha), "TX %lu  ERR %lu",
           (unsigned long)g_tx_ok, (unsigned long)g_tx_err);
  oled.drawStr(0, 23, linha);

  snprintf(linha, sizeof(linha), "GPS %s %d sat",
           g_fix ? "FIX" : "---", g_sats);
  oled.drawStr(0, 34, linha);

  snprintf(linha, sizeof(linha), "%.1fA %.2fV %.1fC",
           g_current_a, g_voltage_v, g_temp_c);
  oled.drawStr(0, 45, linha);

  // Uma letra por sensor em falha: G(ps) I(mu) T(emp) A(mbiente).
  snprintf(linha, sizeof(linha), "FALHA %c%c%c%c",
           g_fault_gps ? 'G' : '-', g_fault_imu ? 'I' : '-',
           g_fault_motor_temp ? 'T' : '-', g_fault_ambient ? 'A' : '-');
  oled.drawStr(0, 56, linha);

  oled.sendBuffer();
}

// ============================================================================
//  12) SETUP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[Athenas v2.2] ESCRAVO — Heltec V3 (ESP32-S3 + SX1262)");

  // --- Vext ON: alimenta o OLED (ativo em LOW) ---
  pinMode(PIN_VEXT, OUTPUT);
  digitalWrite(PIN_VEXT, LOW);
  delay(50);

  // --- OLED ---
  oled.begin();
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 20, "ATHENAS");
  oled.drawStr(0, 32, "iniciando...");
  oled.sendBuffer();

  // --- I2C (compartilhado OLED + MPU6050) ---
  // Barramento PROPRIO do MPU6050 (GPIO 41/42). O OLED usa o `Wire` interno
  // da placa (17/18) e e inicializado pelo U8g2 — nao mexemos nele aqui.
  Wire1.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire1.setClock(400000);  // Fast Mode: sustenta a cadencia da cinematica naval

  // BLINDAGEM CONTRA TRAVAMENTO DO BARRAMENTO.
  // Se um jumper do MPU6050 soltar com a vibracao do casco (e vai soltar), a
  // Wire.h padrao espera INDEFINIDAMENTE pela resposta e trava o loop inteiro:
  // o GPS para de ser lido, a corrente para de ser amostrada e o barco para de
  // transmitir. Com o timeout, uma leitura ruim custa 250 ms e a telemetria
  // segue — o sensor e marcado como em falha e o resto opera normalmente.
  Wire1.setTimeOut(250);
  Wire.setTimeOut(250);   // idem para o barramento do display

  // Varredura do barramento ANTES de tentar o sensor. E o diagnostico que
  // responde de imediato "o MPU esta ligado?" sem ninguem precisar adivinhar.
  i2cScan();

  if (mpuIniciar()) {
    g_fault_imu = false;
  } else {
    g_fault_imu = true;
    Serial.println("[IMU] FALHA: MPU6050 nao encontrado em 0x68 nem 0x69.");
    Serial.printf("[IMU]   Ligue SDA do MPU no GPIO %d e SCL no GPIO %d.\n",
                  PIN_I2C_SDA, PIN_I2C_SCL);
    Serial.println("[IMU]   VCC em 3V3, GND comum com a placa.");
    Serial.println("[IMU]   O barco continua transmitindo sem a IMU: o painel");
    Serial.println("[IMU]   marca o sensor como em falha e segue operando.");
  }

  // --- ADC ---
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_ACS758, ADC_11db);
  analogSetPinAttenuation(PIN_TENSAO, ADC_11db);

  // --- DS18B20 ---
  sensorTemp.begin();
  sensorTemp.setWaitForConversion(false);  // nao bloqueante
  sensorTemp.requestTemperatures();
  Serial.printf("[1-Wire] %d sensor(es) DS18B20\n", sensorTemp.getDeviceCount());

  // --- DHT22 ---
  dht.begin();

  // --- Leme ---
  pinMode(PIN_LEME_PWM, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_LEME_PWM), isrLeme, CHANGE);

  // --- GPS na UART1 ---
  // No ESP32-S3 usamos Serial1 (a Serial0 e o console USB da placa).
  Serial1.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  delay(100);

  // UBX CFG-RATE: taxa de medicao = 200 ms (5 Hz).
  const uint8_t UBX_CFG_RATE_5HZ[] = {
    0xB5, 0x62, 0x06, 0x08, 0x06, 0x00,
    0xC8, 0x00,   // measRate = 200 ms
    0x01, 0x00,   // navRate  = 1
    0x01, 0x00,   // timeRef  = GPS
    0xDE, 0x6A    // checksum
  };
  Serial1.write(UBX_CFG_RATE_5HZ, sizeof(UBX_CFG_RATE_5HZ));
  Serial1.flush();

  // --- WiFi e Bluetooth DESLIGADOS ---
  // Nao ha ninguem para conectar no meio do rio. Desligar economiza energia e
  // tira uma fonte de ruido de 2,4 GHz de perto da antena de 915 MHz.
  WiFi.mode(WIFI_OFF);
  btStop();

  // --- LoRa SX1262 ---
  loraSpi.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);

  int estado = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                           ATHENAS_LORA_SYNCWORD, LORA_TX_DBM, LORA_PREAMBLE,
                           LORA_TCXO_V, false);
  if (estado != RADIOLIB_ERR_NONE) {
    Serial.printf("[LoRa] FALHA na inicializacao: %d\n", estado);
    oled.clearBuffer();
    oled.drawStr(0, 20, "LoRa FALHOU");
    oled.sendBuffer();
    // Sem radio nao ha telemetria: trava aqui de proposito, com o erro visivel
    // no display, em vez de rodar fingindo que esta tudo bem.
    while (true) delay(1000);
  }

  // DIO2 controla o switch de RF na Heltec V3. Sem isto o sinal nao sai da
  // antena — o radio "transmite" e ninguem recebe nada.
  radio.setDio2AsRfSwitch(true);
  radio.setPacketSentAction(onLoRaTxDone);

  Serial.printf("[LoRa] %.1f MHz  SF%d  BW%.0f kHz  %d dBm  (%d bytes/pacote)\n",
                LORA_FREQ_MHZ, LORA_SF, LORA_BW_KHZ, LORA_TX_DBM,
                ATHENAS_PACKET_SIZE);
  Serial.printf("[Athenas] Pronto. Transmitindo a %.1f Hz.\n",
                1000.0f / INTERVALO_TX_MS);
}

// ============================================================================
//  13) LOOP — 100% nao bloqueante
// ============================================================================

void loop() {
  unsigned long agora = millis();

  // --- (a) TX concluida? Libera o radio para o proximo quadro ---
  if (transmittedFlag) {
    transmittedFlag = false;
    transmitindo = false;
    g_tx_ok++;
    radio.finishTransmit();
  }

  // --- (b) GPS: drenar a UART o tempo todo ---
  atualizarGps();

  // --- (c) Leme: aplicar o ultimo pulso medido pela ISR ---
  atualizarLeme();

  // --- (d) Analogicos (leitura barata) ---
  lerCorrente();
  lerTensao();

  // --- (e) IMU ---
  //
  // Em operacao normal, 50 Hz: a fusao complementar precisa de passos curtos e
  // regulares para o termo de integracao do giroscopio fazer sentido.
  //
  // Com o sensor EM FALHA, o ritmo cai para uma tentativa a cada 3 s. Sondar um
  // sensor ausente a 50 Hz enche o console de erros do driver I2C e esconde
  // todas as outras mensagens — exatamente quando voce precisa delas.
  {
    const unsigned long intervalo =
        g_fault_imu ? INTERVALO_RETRY_IMU_MS : INTERVALO_IMU_MS;

    if (agora - ultimaImuMs >= intervalo) {
      const float dt = (agora - ultimaImuMs) / 1000.0f;
      ultimaImuMs = agora;

      if (g_fault_imu) {
        // Reconexao: so tenta reinicializar se o sensor voltou ao barramento.
        // A sondagem e silenciosa, entao a espera nao custa uma linha de log.
        if (i2cPresente(MPU6050_ADDR_LOW) || i2cPresente(MPU6050_ADDR_HIGH)) {
          if (mpuIniciar()) {
            g_fault_imu = false;
            Serial.println("[IMU] MPU6050 reconectado.");
          }
        }
      } else if (!mpuAtualizar(dt)) {
        g_fault_imu = true;
        Serial.println("[IMU] MPU6050 parou de responder. "
                       "Retentando a cada 3 s.");
      }
    }
  }

  // --- (f) DS18B20 a 1 Hz (sensor lento) ---
  if (agora - ultimaTempMs >= INTERVALO_TEMP_MS) {
    ultimaTempMs = agora;
    atualizarTempMotor();
  }

  // --- (g) DHT22 a 0,5 Hz (datasheet exige >= 2 s) ---
  if (agora - ultimaDhtMs >= INTERVALO_DHT_MS) {
    ultimaDhtMs = agora;
    atualizarDht();
  }

  // --- (h) Transmissao LoRa ---
  if (agora - ultimaTxMs >= INTERVALO_TX_MS) {
    ultimaTxMs = agora;
    avaliarStatus();
    transmitirPacote();
  }

  // --- (i) Watchdog de TX: destrava o radio se a IRQ se perder ---
  watchdogTx();

  // --- (j) OLED (baixa prioridade) ---
  if (agora - ultimaOledMs >= INTERVALO_OLED_MS) {
    ultimaOledMs = agora;
    atualizarOled();
  }

  // --- (k) Resumo de status na serial ---
  if (agora - ultimaStatusMs >= INTERVALO_STATUS_MS) {
    ultimaStatusMs = agora;
    Serial.printf(
        "[STATUS] TX ok=%lu err=%lu | GPS %s %d sat | %.1fA %.2fV %.1fC | "
        "falhas: %s%s%s%s\n",
        (unsigned long)g_tx_ok, (unsigned long)g_tx_err,
        g_fix ? "FIX" : "---", g_sats,
        g_current_a, g_voltage_v, g_temp_c,
        g_fault_gps ? "GPS " : "", g_fault_imu ? "IMU " : "",
        g_fault_motor_temp ? "TEMP " : "", g_fault_ambient ? "AMB " : "");
  }
}
