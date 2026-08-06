// ============================================================================
//  Athenas v2.2 — Firmware do MESTRE (estacao de terra)
//
//  Placa: Heltec WiFi LoRa 32 (V3)  —  ESP32-S3 + SX1262 + OLED
//  Framework: Arduino  |  Build: PlatformIO
//
//  PAPEL: receber os pacotes binarios do barco por LoRa, validar, remontar o
//  CONTRATO JSON v2.1 e servir aos clientes por WebSocket.
//
//  ┌──────────────┐   LoRa 915 MHz    ┌──────────────┐   WiFi AP   ┌─────────┐
//  │   ESCRAVO    │  39 bytes @ 5 Hz  │    MESTRE    │  WebSocket  │   PC    │
//  │  (no barco)  │ ────────────────▶ │  (em terra)  │ ──────────▶ │ Athenas │
//  └──────────────┘                   └──────────────┘             └─────────┘
//
//  ---------------------------------------------------------------------------
//  POR QUE O MESTRE CRIA A PROPRIA REDE WiFi
//  ---------------------------------------------------------------------------
//  O mestre fica ao lado do notebook, a um metro. Criando um Access Point
//  proprio ele elimina TODA a infraestrutura: nao depende de roteador, nao
//  depende de rede da organizacao do evento, e nao precisa de cabo USB.
//
//  E, principalmente: o dashboard ja fala WebSocket. Remontando o JSON aqui, o
//  software nao precisa saber que existe um enlace LoRa no caminho — o contrato
//  e byte a byte o mesmo que ele receberia do barco diretamente.
//
//  Como fallback de bancada, o mesmo JSON tambem sai pela USB serial.
// ============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <SPI.h>
#include <RadioLib.h>
#include <U8g2lib.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>

#include "athenas_link.h"

// ============================================================================
//  1) REDE DO MESTRE — MODO DUPLO (estacao com fallback para ponto de acesso)
//
//  ---------------------------------------------------------------------------
//  POR QUE DOIS MODOS
//  ---------------------------------------------------------------------------
//  Criar sempre a propria rede parecia certo — ate a bancada mostrar o custo:
//  para ver o painel, o notebook TINHA que sair da rede do laboratorio e entrar
//  na do receptor, perdendo a internet. Na pratica isso vira um ciclo de trocar
//  de rede, testar, voltar — e uma hora ninguem sabe mais em que rede esta.
//
//  Entao o mestre agora tenta, NESTA ORDEM:
//
//   1. ESTACAO (STA) — entra na rede configurada em wifi_credentials.h. E o
//      modo de BANCADA: o notebook fica na mesma rede de sempre, com internet,
//      e alcanca o mestre pelo IP dele. Zero troca de rede.
//
//   2. PONTO DE ACESSO (AP) — se a rede nao existir (ou seja, na PROVA, no
//      meio do rio), cria a propria automaticamente. Modo de campo: nao depende
//      de infraestrutura nenhuma.
//
//  A troca e automatica e o display mostra em que modo esta, com o IP. Ninguem
//  precisa recompilar para mudar de contexto.
// ============================================================================

#include "wifi_credentials.h"

// --- Modo 1: estacao (bancada) ---
static const char* STA_SSID     = ATHENAS_STA_SSID;
static const char* STA_PASSWORD = ATHENAS_STA_PASSWORD;

/**
 * Tempo de tentativa de entrar na rede antes de desistir e criar a propria.
 * 8 s cobre uma associacao normal com folga; mais que isso so atrasaria a
 * subida do modo de campo, onde a rede simplesmente nao existe.
 */
static const unsigned long STA_TIMEOUT_MS = 8000;

/** Nome mDNS: o painel acha o mestre sem ninguem precisar descobrir o IP. */
static const char* MDNS_HOSTNAME = "athenas";

// --- Modo 2: ponto de acesso (campo) ---
static const char* AP_SSID     = "Athenas-Base";
static const char* AP_PASSWORD = "athenas2026";  // minimo 8 caracteres (WPA2)

// IP fixo do AP. O dashboard aponta para ws://192.168.4.1/ws — e o endereco
// padrao do SoftAP do ESP32, entao nao ha nada a descobrir em campo.
static const IPAddress AP_IP(192, 168, 4, 1);
static const IPAddress AP_GATEWAY(192, 168, 4, 1);
static const IPAddress AP_SUBNET(255, 255, 255, 0);

// Canal WiFi. O 1 e o mais distante das interferencias tipicas; se a prova
// tiver muitas redes, teste 6 ou 11.
static const int AP_CHANNEL = 1;

// ============================================================================
//  2) PINOS — Heltec WiFi LoRa 32 V3 (identicos aos do escravo)
// ============================================================================

static const int PIN_LORA_NSS  = 8;
static const int PIN_LORA_SCK  = 9;
static const int PIN_LORA_MOSI = 10;
static const int PIN_LORA_MISO = 11;
static const int PIN_LORA_RST  = 12;
static const int PIN_LORA_BUSY = 13;
static const int PIN_LORA_DIO1 = 14;

static const int PIN_OLED_SDA = 17;
static const int PIN_OLED_SCL = 18;
static const int PIN_OLED_RST = 21;
static const int PIN_VEXT     = 36;  // ativo em LOW

// ============================================================================
//  3) PARAMETROS DO ENLACE
//
//  ATENCAO: TEM QUE SER IDENTICO AO DO ESCRAVO. Frequencia, SF, largura de
//  banda, coding rate e sync word diferentes = silencio absoluto, sem nenhuma
//  mensagem de erro. E o modo de falha mais frustrante do LoRa.
// ============================================================================

static const float   LORA_FREQ_MHZ  = 915.0f;
static const float   LORA_BW_KHZ    = 125.0f;
static const uint8_t LORA_SF        = 7;
static const uint8_t LORA_CR        = 5;
static const int8_t  LORA_TX_DBM    = 20;   // o mestre so recebe; valor formal
static const uint16_t LORA_PREAMBLE = 8;
static const float   LORA_TCXO_V    = 1.8f;

/** Silencio (ms) apos o qual consideramos o enlace com o barco perdido. */
static const unsigned long LINK_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
//  HIGIENE DE CLIENTES WEBSOCKET
//
//  O PROBLEMA REAL (observado em bancada):
//  quando o notebook troca de rede WiFi, o TCP e cortado SEM fechamento limpo.
//  O servidor continua achando que o cliente existe — uma conexao "meio aberta"
//  — e segue enfileirando quadros a 5 Hz para um socket que nunca drena.
//
//  Cada ciclo de "conecta, testa, volta para a rede do escritorio" deixava mais
//  um zumbi. Com tres deles acumulados, o handshake de NOVAS conexoes passou a
//  falhar: o painel ficava eternamente em "Conectando…" enquanto o /health
//  respondia normalmente — um sintoma que aponta para o lugar errado.
//
//  A DEFESA, em tres camadas:
//   1. teto baixo de clientes: cleanupClients() derruba os mais antigos alem
//      do limite, entao um zumbi e expulso assim que alguem novo chega;
//   2. ping periodico: um socket meio aberto so e detectado quando alguem
//      tenta escrever nele e falha — o ping forca essa deteccao em segundos,
//      em vez de esperar o timeout do TCP, que leva minutos;
//   3. envio condicionado: so transmitimos quando o socket aceita dados, para
//      um cliente lento nao encher a fila e travar o servidor inteiro.
// ---------------------------------------------------------------------------

/** Quantos painéis podem assistir ao mesmo tempo. */
static const uint8_t MAX_WS_CLIENTS = 3;

/** Intervalo do ping que detecta conexoes meio abertas. */
static const unsigned long INTERVALO_PING_MS = 3000;


static const unsigned long INTERVALO_OLED_MS = 400;

/**
 * Resumo de status na serial.
 *
 * O mestre so imprimia quando RECEBIA um pacote — o que significa que, com o
 * enlace mudo, ele ficava em silencio absoluto e era impossivel distinguir
 * "receptor travado" de "receptor vivo mas sem ouvir nada". Este batimento
 * resolve isso: se as linhas aparecem, o receptor esta rodando.
 */
static const unsigned long INTERVALO_STATUS_MS = 5000;

// ============================================================================
//  4) OBJETOS GLOBAIS
// ============================================================================

SPIClass loraSpi(FSPI);
SX1262 radio = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RST,
                          PIN_LORA_BUSY, loraSpi);

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, PIN_OLED_RST,
                                         PIN_OLED_SCL, PIN_OLED_SDA);

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

/** Buffer de recepcao — alocado UMA vez. */
AthenasPacket rxPacket;

/**
 * Buffer do JSON de saida.
 *
 * DIMENSIONADO COM FOLGA REAL, e isso ja custou caro: com 512 bytes, o quadro
 * completo do contrato v2.1 (com o bloco `link`) passava de 512 caracteres. O
 * `snprintf` truncava, devolvia o tamanho NECESSARIO — maior que o buffer — e a
 * guarda `n < sizeof(jsonBuffer)` descartava o quadro EM SILENCIO.
 *
 * O sintoma foi cruel de diagnosticar: o radio recebia normalmente (RX subindo,
 * zero perda), o WebSocket aceitava conexoes, e mesmo assim o painel nunca
 * recebia um unico quadro. Nada no log indicava o problema.
 *
 * 1024 bytes dao o dobro do necessario. E, mais importante que o tamanho: a
 * falha de truncamento agora GRITA no log em vez de sumir (ver enviarJson).
 *
 * Global e reaproveitado: montar uma String por quadro fragmentaria o heap em
 * minutos de prova.
 */
char jsonBuffer[1024];

// ============================================================================
//  5) ESTADO
// ============================================================================

volatile bool receivedFlag = false;

/** true = criou a propria rede (campo); false = entrou na rede da bancada. */
bool      g_modoAp = false;
/** IP efetivo, seja do AP ou atribuido pelo roteador. */
IPAddress g_ip;

unsigned long ultimoPacoteMs = 0;
unsigned long ultimaOledMs = 0;
unsigned long ultimaStatusMs = 0;
unsigned long ultimoPingMs = 0;

// --- Qualidade do enlace ---
float    g_rssi = -999.0f;   // dBm
float    g_snr  = 0.0f;      // dB
uint32_t g_recebidos = 0;
uint32_t g_perdidos = 0;     // perdidos NO AR, deduzidos do `seq` do barco
uint32_t g_corrompidos = 0;  // CRC invalido ou magic errado
int32_t  g_ultimoSeq = -1;

/**
 * Contador PROPRIO do mestre, incrementado a cada quadro repassado.
 *
 * E ele que vai no campo `seq` do JSON — nao o contador do barco. A razao e
 * separar dois enlaces independentes que falham por motivos diferentes:
 *
 *   `link.lost`  = pacotes perdidos NO AR (LoRa) — problema de alcance/antena
 *   lacunas em `seq` = quadros perdidos entre MESTRE e PC (WiFi/WebSocket)
 *
 * Se repassassemos o seq do barco, o dashboard contaria as perdas do radio de
 * novo e os dois numeros diriam a mesma coisa — inutil para diagnosticar de
 * qual lado esta o problema.
 */
uint16_t g_encaminhados = 0;

void IRAM_ATTR onLoRaRxDone() {
  receivedFlag = true;
}

// ============================================================================
//  6) REMONTAGEM DO CONTRATO JSON v2.1
//
//  Aqui o pacote binario de 39 bytes vira exatamente o JSON que o dashboard
//  espera. Escrito com snprintf em vez de ArduinoJson de proposito: e um
//  layout fixo e conhecido, snprintf nao aloca nada, e o custo e uma fracao
//  do de construir uma arvore de documento a 5 Hz.
//
//  Os campos `accel_*` da IMU nao trafegam pelo radio (custariam 6 bytes que
//  ninguem consome no painel) — vao zerados, com accel_z = 1 g, que e o valor
//  de um casco nivelado em repouso.
// ============================================================================

size_t montarJson(const AthenasPacket& p) {
  const bool fix        = (p.flags & ATH_FLAG_FIX) != 0;
  const bool algae      = (p.flags & ATH_FLAG_ALGAE) != 0;
  const bool overheat   = (p.flags & ATH_FLAG_OVERHEAT) != 0;
  const bool battLow    = (p.flags & ATH_FLAG_BATTERY_LOW) != 0;
  const bool faultGps   = (p.flags & ATH_FLAG_FAULT_GPS) != 0;
  const bool faultImu   = (p.flags & ATH_FLAG_FAULT_IMU) != 0;
  const bool faultTemp  = (p.flags & ATH_FLAG_FAULT_TEMP) != 0;
  const bool faultAmb   = (p.flags & ATH_FLAG_FAULT_AMB) != 0;

  // cm/s -> km/h : * 0,036
  const double speed_kmh = p.speed_cms * 0.036;
  const double hdop = (p.hdop_d == ATH_HDOP_INVALID) ? 99.0 : p.hdop_d / 10.0;

  return snprintf(
      jsonBuffer, sizeof(jsonBuffer),
      "{"
        "\"gps\":{"
          "\"lat\":%.7f,\"lng\":%.7f,\"speed_kmh\":%.2f,\"cog\":%.1f,"
          "\"fix\":%s,\"sats\":%u,\"hdop\":%.1f"
        "},"
        "\"imu\":{"
          "\"roll\":%.1f,\"pitch\":%.1f,\"yaw\":%.1f,"
          "\"accel_x\":0,\"accel_y\":0,\"accel_z\":1"
        "},"
        "\"sensors\":{"
          "\"current_a\":%.2f,\"voltage_v\":%.2f,\"temp_c\":%.1f,"
          "\"rudder_deg\":%d"
        "},"
        "\"ambient\":{\"temp_c\":%.1f,\"humidity\":%u},"
        "\"status\":{"
          "\"algae_alert\":%s,\"overheat_alert\":%s,\"battery_low\":%s"
        "},"
        "\"faults\":{"
          "\"gps\":%s,\"imu\":%s,\"motor_temp\":%s,\"ambient\":%s"
        "},"
        "\"link\":{"
          "\"rssi\":%.0f,\"snr\":%.1f,\"lost\":%lu,\"corrupt\":%lu,"
          "\"boat_seq\":%u"
        "},"
        "\"seq\":%u,\"uptime_ms\":%lu"
      "}",
      p.lat_e7 / 1e7, p.lng_e7 / 1e7, speed_kmh, p.cog_ddeg / 10.0,
      fix ? "true" : "false", (unsigned)p.sats, hdop,
      p.roll_ddeg / 10.0, p.pitch_ddeg / 10.0, p.yaw_ddeg / 10.0,
      p.current_ca / 100.0, p.voltage_cv / 100.0, p.temp_ddeg / 10.0,
      (int)p.rudder_deg,
      p.amb_temp_ddeg / 10.0, (unsigned)p.humidity,
      algae ? "true" : "false", overheat ? "true" : "false",
      battLow ? "true" : "false",
      faultGps ? "true" : "false", faultImu ? "true" : "false",
      faultTemp ? "true" : "false", faultAmb ? "true" : "false",
      g_rssi, g_snr, (unsigned long)g_perdidos, (unsigned long)g_corrompidos,
      (unsigned)p.seq,                       // link.boat_seq (contador do barco)
      (unsigned)g_encaminhados++,            // seq (contador do mestre)
      (unsigned long)p.uptime_s * 1000UL);
}

// ============================================================================
//  7) PROCESSAMENTO DE UM PACOTE RECEBIDO
// ============================================================================

void processarPacote() {
  const size_t tamanho = radio.getPacketLength();
  const int estado = radio.readData((uint8_t*)&rxPacket, ATHENAS_PACKET_SIZE);

  if (estado != RADIOLIB_ERR_NONE) {
    g_corrompidos++;
    return;
  }

  // Valida magic, versao e CRC. O CRC do proprio LoRa cobre erro de modulacao;
  // este cobre pacote alheio que passou pelo sync word e corrupcao no SPI.
  if (!athenas_packet_valid(&rxPacket, tamanho)) {
    g_corrompidos++;
    return;
  }

  g_rssi = radio.getRSSI();
  g_snr  = radio.getSNR();
  g_recebidos++;
  ultimoPacoteMs = millis();

  // --- Contagem de perdas pelo campo `seq` ---
  // O LoRa nao tem retransmissao: um pacote perdido some para sempre. Contar a
  // lacuna e o que permite a equipe julgar se a antena precisa ser reapontada.
  if (g_ultimoSeq >= 0) {
    const int32_t seq = (int32_t)rxPacket.seq;
    int32_t delta = seq - g_ultimoSeq;
    if (delta < 0) delta += 65536;        // rollover do uint16
    if (delta > 1 && delta < 1000) {
      g_perdidos += (uint32_t)(delta - 1);
    } else if (delta >= 1000) {
      // Salto grande demais: o escravo reiniciou. Re-sincroniza sem inflar a
      // estatistica com milhares de perdas fantasma.
      g_ultimoSeq = -1;
    }
  }
  g_ultimoSeq = (int32_t)rxPacket.seq;

  // --- Publica ---
  const size_t n = montarJson(rxPacket);

  // TRUNCAMENTO TEM QUE GRITAR, NAO SUMIR.
  // A versao anterior apenas ignorava o quadro quando ele nao cabia — e o
  // sistema inteiro ficava mudo sem nenhuma pista do motivo. Se isso voltar a
  // acontecer (por um campo novo no contrato, por exemplo), o log diz na hora
  // exatamente o que aumentar.
  if (n >= sizeof(jsonBuffer)) {
    static unsigned long ultimoAvisoMs = 0;
    if (millis() - ultimoAvisoMs > 5000) {   // nao inunda o console a 5 Hz
      ultimoAvisoMs = millis();
      Serial.printf("[JSON] ERRO: quadro precisa de %u bytes mas o buffer tem "
                    "%u. Aumente jsonBuffer. NENHUM dado esta sendo enviado.\n",
                    (unsigned)n, (unsigned)sizeof(jsonBuffer));
    }
    return;
  }

  if (n > 0) {
    // ENVIO INCONDICIONAL — e esta linha ja teve uma guarda, que foi removida.
    //
    // A versao anterior so transmitia se `availableForWriteAll()` fosse true,
    // na ideia de nao enfileirar para socket morto. Na bancada isso se mostrou
    // ERRADO: a funcao nunca devolvia true, nem para um cliente recem-conectado
    // e saudavel. Resultado observado no log:
    //
    //   [WS] Cliente #11 conectado (192.168.30.50)
    //   [WS] 1 cliente(s) sem aceitar dados ha 5001 ms. Derrubando todos
    //
    // Ou seja: o painel conectava, nao recebia nada, era derrubado pelo proprio
    // watchdog, reconectava, e repetia para sempre. A protecao contra zumbi
    // ficou restritiva a ponto de bloquear clientes bons.
    //
    // A biblioteca ja descarta internamente mensagens para clientes com fila
    // cheia. A higiene contra sockets mortos fica por conta do ping periodico
    // e do cleanupClients(), que atacam a causa sem penalizar quem esta bem.
    if (ws.count() > 0) {
      ws.textAll(jsonBuffer, n);
    }
    // Espelho na USB serial: fallback de bancada e diagnostico.
    Serial.println(jsonBuffer);
  }
}

// ============================================================================
//  8) WEBSOCKET
// ============================================================================

void onWsEvent(AsyncWebSocket* servidor, AsyncWebSocketClient* cliente,
               AwsEventType tipo, void* arg, uint8_t* dados, size_t tam) {
  switch (tipo) {
    case WS_EVT_CONNECT:
      Serial.printf("[WS] Cliente #%u conectado (%s)\n",
                    cliente->id(), cliente->remoteIP().toString().c_str());
      break;
    case WS_EVT_DISCONNECT:
      Serial.printf("[WS] Cliente #%u desconectado\n", cliente->id());
      break;
    default:
      // Estacao SOMENTE LEITURA: nao processamos comandos do cliente.
      break;
  }
}

// ============================================================================
//  9) OLED — painel de campo
//
//  E aqui que a equipe julga a qualidade do enlace ao apontar a antena. O RSSI
//  atualizando em tempo real vale mais que qualquer log.
// ============================================================================

void atualizarOled() {
  const bool online = (millis() - ultimoPacoteMs) < LINK_TIMEOUT_MS;
  char linha[24];

  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);

  oled.drawStr(0, 8, "ATHENAS MESTRE");
  oled.drawHLine(0, 11, 128);

  if (!online) {
    oled.setFont(u8g2_font_7x14B_tf);
    oled.drawStr(0, 30, "SEM ENLACE");
    oled.setFont(u8g2_font_6x10_tf);
    oled.drawStr(0, 44, "aguardando barco...");
  } else {
    snprintf(linha, sizeof(linha), "RSSI %.0f dBm", g_rssi);
    oled.drawStr(0, 23, linha);

    snprintf(linha, sizeof(linha), "SNR  %.1f dB", g_snr);
    oled.drawStr(0, 34, linha);

    // Percentual de perda: a metrica que decide se o alcance esta no limite.
    const uint32_t total = g_recebidos + g_perdidos;
    const float perdaPct = total > 0 ? (100.0f * g_perdidos / total) : 0.0f;
    snprintf(linha, sizeof(linha), "RX %lu  perda %.1f%%",
             (unsigned long)g_recebidos, perdaPct);
    oled.drawStr(0, 45, linha);
  }

  // Modo e IP: e por aqui que a equipe sabe onde apontar o painel, sem cabo.
  snprintf(linha, sizeof(linha), "%s WS%u %s",
           g_modoAp ? "AP" : "ST", ws.count(), g_ip.toString().c_str());
  oled.drawStr(0, 56, linha);

  oled.sendBuffer();
}

// ============================================================================
//  10) SETUP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[Athenas v2.2] MESTRE — Heltec V3 (ESP32-S3 + SX1262)");

  // --- Vext ON: alimenta o OLED ---
  pinMode(PIN_VEXT, OUTPUT);
  digitalWrite(PIN_VEXT, LOW);
  delay(50);

  oled.begin();
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 20, "ATHENAS MESTRE");
  oled.drawStr(0, 32, "iniciando...");
  oled.sendBuffer();

  // --- REDE: tenta entrar na rede da bancada; se falhar, cria a propria ---
  //
  // Sem power save em nenhum dos modos: o WebSocket a 5 Hz precisa de latencia
  // estavel, e o modo de economia do radio introduz picos de centenas de ms.
  WiFi.setSleep(false);

  WiFi.mode(WIFI_STA);
  WiFi.begin(STA_SSID, STA_PASSWORD);
  Serial.printf("[WiFi] Tentando entrar na rede \"%s\"", STA_SSID);

  const unsigned long inicioSta = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - inicioSta < STA_TIMEOUT_MS) {
    delay(250);           // permitido: setup, ainda nao ha loop de telemetria
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    // ---- MODO BANCADA ----
    g_modoAp = false;
    g_ip = WiFi.localIP();
    Serial.printf("[WiFi] MODO ESTACAO — conectado em \"%s\"\n", STA_SSID);
    Serial.printf("[WiFi] Dashboard em ws://%s/ws\n", g_ip.toString().c_str());

    // mDNS: o painel tambem encontra o mestre por nome, util porque o IP
    // atribuido pelo roteador muda a cada reconexao.
    if (MDNS.begin(MDNS_HOSTNAME)) {
      MDNS.addService("http", "tcp", 80);
      Serial.printf("[mDNS] tambem acessivel em ws://%s.local/ws\n",
                    MDNS_HOSTNAME);
    }
  } else {
    // ---- MODO CAMPO ----
    // A rede da bancada nao existe aqui: e a prova. Cria a propria.
    g_modoAp = true;
    WiFi.mode(WIFI_AP);
    WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
    WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL);
    g_ip = WiFi.softAPIP();

    Serial.printf("[WiFi] Rede \"%s\" nao encontrada — MODO PONTO DE ACESSO\n",
                  STA_SSID);
    Serial.printf("[WiFi] AP \"%s\"  senha \"%s\"\n", AP_SSID, AP_PASSWORD);
    Serial.printf("[WiFi] Dashboard em ws://%s/ws\n", g_ip.toString().c_str());

    // mDNS TAMBEM no modo de campo. Assim `athenas.local` funciona nos DOIS
    // modos, e o painel pode usar sempre o mesmo endereco — sem a equipe
    // precisar descobrir e digitar IP nenhum na beira do rio.
    if (MDNS.begin(MDNS_HOSTNAME)) {
      MDNS.addService("http", "tcp", 80);
      Serial.printf("[mDNS] tambem acessivel em ws://%s.local/ws\n",
                    MDNS_HOSTNAME);
    }
  }

  // --- WebSocket + HTTP ---
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // Diagnostico rapido pelo navegador, sem cabo serial.
  server.on("/health", HTTP_GET, [](AsyncWebServerRequest* req) {
    char buf[256];
    const bool online = (millis() - ultimoPacoteMs) < LINK_TIMEOUT_MS;
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"link\":%s,\"rssi\":%.0f,\"snr\":%.1f,"
             "\"rx\":%lu,\"lost\":%lu,\"corrupt\":%lu,"
             "\"clients\":%u,\"heap\":%u,\"modo\":\"%s\",\"ip\":\"%s\"}",
             online ? "true" : "false", g_rssi, g_snr,
             (unsigned long)g_recebidos, (unsigned long)g_perdidos,
             (unsigned long)g_corrompidos, ws.count(), ESP.getFreeHeap(),
             g_modoAp ? "ap" : "estacao", g_ip.toString().c_str());
    req->send(200, "application/json", buf);
  });

  server.begin();

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
    while (true) delay(1000);
  }

  // DIO2 controla o switch de RF na Heltec V3.
  radio.setDio2AsRfSwitch(true);
  radio.setPacketReceivedAction(onLoRaRxDone);

  // Escuta continua. A partir daqui o radio avisa por interrupcao.
  estado = radio.startReceive();
  if (estado != RADIOLIB_ERR_NONE) {
    Serial.printf("[LoRa] FALHA ao entrar em recepcao: %d\n", estado);
    while (true) delay(1000);
  }

  Serial.printf("[LoRa] Escutando em %.1f MHz  SF%d  BW%.0f kHz\n",
                LORA_FREQ_MHZ, LORA_SF, LORA_BW_KHZ);
  Serial.println("[Athenas] Mestre pronto.");
}

// ============================================================================
//  11) LOOP — 100% nao bloqueante
// ============================================================================

void loop() {
  // --- Pacote recebido? ---
  if (receivedFlag) {
    receivedFlag = false;
    processarPacote();
    // Volta a escutar imediatamente: cada milissegundo fora de recepcao e um
    // pacote do barco que pode passar despercebido.
    radio.startReceive();
  }

  const unsigned long agora = millis();

  // --- OLED ---
  if (agora - ultimaOledMs >= INTERVALO_OLED_MS) {
    ultimaOledMs = agora;
    atualizarOled();
  }

  // --- Batimento de status ---
  if (agora - ultimaStatusMs >= INTERVALO_STATUS_MS) {
    ultimaStatusMs = agora;

    // `escutando` confirma que o radio esta REALMENTE em modo de recepcao.
    // Sem esta checagem, um SX1262 que caiu para standby por um erro de SPI
    // pareceria identico a um enlace sem sinal — e mandaria a equipe procurar
    // problema na antena quando o defeito e de software.
    const int estadoRadio = radio.getPacketLength(true);

    Serial.printf(
        "[STATUS] RX ok=%lu perdidos=%lu corrompidos=%lu | RSSI %.0f dBm | "
        "clientes WS=%u | radio=%s | heap=%u\n",
        (unsigned long)g_recebidos, (unsigned long)g_perdidos,
        (unsigned long)g_corrompidos,
        g_recebidos > 0 ? g_rssi : 0.0f, ws.count(),
        estadoRadio >= 0 ? "ok" : "ERRO",
        ESP.getFreeHeap());

    if (g_recebidos == 0) {
      Serial.println("[STATUS]   Nenhum pacote recebido ate agora. Confira: "
                     "(1) antenas conectadas nas DUAS placas; "
                     "(2) o escravo esta ligado e com TX ok subindo; "
                     "(3) mesma frequencia/SF/BW nos dois firmwares.");
    }
  }

  // --- Ping: forca a deteccao de conexoes meio abertas ---
  // Um socket cortado sem FIN (troca de rede WiFi) so e descoberto quando
  // alguem tenta escrever nele. O ping provoca essa escrita a cada 3 s, em vez
  // de esperar o timeout do TCP, que leva minutos.
  if (agora - ultimoPingMs >= INTERVALO_PING_MS) {
    ultimoPingMs = agora;
    if (ws.count() > 0) ws.pingAll();
  }

  // Teto baixo de clientes: derruba os mais antigos alem do limite, entao um
  // zumbi e expulso assim que um painel novo chega.
  ws.cleanupClients(MAX_WS_CLIENTS);
}
