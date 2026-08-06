// ============================================================================
//  Athenas Link v1 — protocolo binario do enlace LoRa (escravo -> mestre)
//
//  ESTE ARQUIVO E COMPARTILHADO PELOS DOIS FIRMWARES.
//  Incluido por firmware/onboard (escravo, no barco) e firmware/receiver
//  (mestre, em terra). Um unico struct, uma unica verdade — se divergirem, o
//  mestre decodifica lixo silenciosamente.
//
//  ---------------------------------------------------------------------------
//  POR QUE BINARIO, E NAO JSON
//  ---------------------------------------------------------------------------
//  O contrato JSON do dashboard tem ~400 bytes. A 5 Hz sao 16 kbps — varias
//  vezes acima do que o LoRa entrega. Em SF7/BW125 o radio da ~5,4 kbps
//  BRUTOS, e um pacote de 400 bytes levaria ~700 ms de airtime: nao caberiam
//  nem 1,5 quadros por segundo.
//
//  Empacotando em campos de largura fixa o mesmo quadro cabe em 39 BYTES —
//  10x menor. O mestre remonta o JSON completo em terra, entao o dashboard nao
//  percebe diferenca nenhuma: o contrato com o software fica intacto.
//
//  ---------------------------------------------------------------------------
//  ESCALAS DE PONTO FIXO
//  ---------------------------------------------------------------------------
//  Nao ha float no ar. Cada grandeza vira inteiro com um fator de escala
//  escolhido para preservar a resolucao que o sensor de fato entrega:
//
//    latitude/longitude  x1e7   -> ~1 cm  (o GPS entrega ~2,5 m; sobra folga)
//    velocidade          cm/s   -> 0,01 m/s
//    rumo/atitude        0,1°   -> a IMU tem ruido de ~0,5°; sobra folga
//    corrente/tensao     0,01   -> resolucao do ADC apos filtro
//    temperaturas        0,1 °C -> resolucao do DS18B20
//
//  Endianness: os dois lados sao ESP32-S3 (little-endian), entao a copia
//  direta do struct e segura. Se um dia entrar um receptor de outra
//  arquitetura, sera preciso serializar campo a campo.
// ============================================================================

#pragma once

#include <stdint.h>
#include <stddef.h>

// --- Identificacao do protocolo ---------------------------------------------

/** Byte de sincronismo. Descarta ruido de radio antes de olhar o resto. */
#define ATHENAS_LINK_MAGIC 0xA7

/** Versao do protocolo. Incremente ao mudar o layout do struct. */
#define ATHENAS_LINK_VERSION 1

/**
 * Sync word do LoRa. Mantem o receptor surdo a outras redes LoRa na mesma
 * frequencia (ha muita coisa em 915 MHz). Nao e seguranca — e higiene de
 * espectro.
 */
#define ATHENAS_LORA_SYNCWORD 0xA7

// --- Bits do campo `flags` ---------------------------------------------------
// Oito booleanos em UM byte. Como cada bit economiza airtime, nao ha um byte
// por flag.

#define ATH_FLAG_FIX         (1u << 0)  // GPS com fix valido e recente
#define ATH_FLAG_ALGAE       (1u << 1)  // anomalia de arrasto (algas)
#define ATH_FLAG_OVERHEAT    (1u << 2)  // estator >= 70 °C
#define ATH_FLAG_BATTERY_LOW (1u << 3)  // bateria em nivel critico
#define ATH_FLAG_FAULT_GPS   (1u << 4)  // GPS em falha / dado velho
#define ATH_FLAG_FAULT_IMU   (1u << 5)  // MPU6050 sem resposta no I2C
#define ATH_FLAG_FAULT_TEMP  (1u << 6)  // DS18B20 retornou -127 / 85 / NaN
#define ATH_FLAG_FAULT_AMB   (1u << 7)  // DHT22 retornou NaN

// --- Valores sentinela -------------------------------------------------------

/** HDOP indisponivel (o campo e uint8 com escala 0,1 -> maximo real 25,4). */
#define ATH_HDOP_INVALID 0xFF

// ============================================================================
//  O PACOTE
//
//  `packed` e obrigatorio: sem ele o compilador insere padding de alinhamento
//  e o tamanho muda entre plataformas — o receptor leria os campos deslocados.
// ============================================================================

struct __attribute__((packed)) AthenasPacket {
  uint8_t  magic;          // sempre ATHENAS_LINK_MAGIC
  uint8_t  version;        // sempre ATHENAS_LINK_VERSION
  uint16_t seq;            // contador sequencial (detecta perda de pacotes)

  int32_t  lat_e7;         // latitude  x 1e7
  int32_t  lng_e7;         // longitude x 1e7

  uint16_t speed_cms;      // velocidade sobre o solo, cm/s
  uint16_t cog_ddeg;       // course over ground, decimos de grau (0..3599)

  int16_t  roll_ddeg;      // adernamento, decimos de grau
  int16_t  pitch_ddeg;     // caturro, decimos de grau
  uint16_t yaw_ddeg;       // guinada, decimos de grau (0..3599)

  int16_t  current_ca;     // corrente do motor, centesimos de A (com sinal)
  uint16_t voltage_cv;     // tensao da bateria, centesimos de V
  int16_t  temp_ddeg;      // temperatura do estator, decimos de °C
  int16_t  amb_temp_ddeg;  // temperatura ambiente no casco, decimos de °C

  int8_t   rudder_deg;     // angulo do leme, graus inteiros (-45..+45)
  uint8_t  humidity;       // umidade relativa, % inteiro (0..100)
  uint8_t  sats;           // satelites rastreados
  uint8_t  hdop_d;         // HDOP x 10, ou ATH_HDOP_INVALID
  uint8_t  flags;          // bitfield ATH_FLAG_*

  uint16_t uptime_s;       // segundos desde o boot do escravo (rola em ~18 h)

  uint16_t crc;            // CRC16-CCITT de todos os bytes anteriores
};

/** Tamanho do pacote no ar. Confira o static_assert abaixo. */
#define ATHENAS_PACKET_SIZE 39

// Se esta linha nao compilar, o layout mudou sem o tamanho ser atualizado —
// exatamente o tipo de divergencia silenciosa que quebraria o enlace em campo.
#if defined(__cplusplus) && __cplusplus >= 201103L
static_assert(sizeof(AthenasPacket) == ATHENAS_PACKET_SIZE,
              "AthenasPacket mudou de tamanho: atualize ATHENAS_PACKET_SIZE e "
              "ATHENAS_LINK_VERSION, e regrave OS DOIS firmwares.");
#endif

// ============================================================================
//  CRC16-CCITT (polinomio 0x1021, inicial 0xFFFF)
//
//  O LoRa ja tem CRC proprio no nivel do radio, mas ele so protege contra erro
//  de MODULACAO. Nao protege contra um pacote de outro sistema que por acaso
//  passe pelo sync word, nem contra corrupcao no SPI entre o MCU e o SX1262.
//  Este CRC e a garantia de que o que o mestre publica veio mesmo do barco.
// ============================================================================

static inline uint16_t athenas_crc16(const uint8_t* data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; i++) {
    crc ^= (uint16_t)data[i] << 8;
    for (uint8_t bit = 0; bit < 8; bit++) {
      if (crc & 0x8000) {
        crc = (uint16_t)((crc << 1) ^ 0x1021);
      } else {
        crc = (uint16_t)(crc << 1);
      }
    }
  }
  return crc;
}

/** Calcula e grava o CRC do pacote (chame por ultimo, antes de transmitir). */
static inline void athenas_packet_finalize(AthenasPacket* pkt) {
  pkt->magic = ATHENAS_LINK_MAGIC;
  pkt->version = ATHENAS_LINK_VERSION;
  pkt->crc = athenas_crc16((const uint8_t*)pkt,
                           ATHENAS_PACKET_SIZE - sizeof(uint16_t));
}

/**
 * Valida um pacote recebido: tamanho, magic, versao e CRC.
 * @return true se o pacote pode ser confiado.
 */
static inline bool athenas_packet_valid(const AthenasPacket* pkt,
                                        size_t received_length) {
  if (received_length != ATHENAS_PACKET_SIZE) return false;
  if (pkt->magic != ATHENAS_LINK_MAGIC) return false;
  if (pkt->version != ATHENAS_LINK_VERSION) return false;

  const uint16_t expected =
      athenas_crc16((const uint8_t*)pkt, ATHENAS_PACKET_SIZE - sizeof(uint16_t));
  return pkt->crc == expected;
}

// ============================================================================
//  Helpers de conversao (compartilhados para os dois lados usarem a MESMA
//  aritmetica de arredondamento — divergir aqui produz erro de 1 LSB que
//  aparece como tremor no painel).
// ============================================================================

/** Satura um valor em ponto flutuante dentro da faixa de um inteiro. */
static inline int32_t athenas_clamp_i32(double v, int32_t lo, int32_t hi) {
  if (!(v > (double)lo)) return lo;   // captura NaN: comparacao invertida
  if (v > (double)hi) return hi;
  return (int32_t)(v < 0 ? v - 0.5 : v + 0.5);
}

static inline int16_t athenas_to_i16(double value, double scale) {
  return (int16_t)athenas_clamp_i32(value * scale, -32768, 32767);
}

static inline uint16_t athenas_to_u16(double value, double scale) {
  return (uint16_t)athenas_clamp_i32(value * scale, 0, 65535);
}
