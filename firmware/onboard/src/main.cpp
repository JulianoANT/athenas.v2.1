// ============================================================================
//  Athenas v2.0 - Firmware de bordo (onboard)
//  Alvo: ESP32 DevKit  |  Framework: Arduino  |  Build: PlatformIO
//
//  Evolucao do "Athenas Motor 2026" (que so lia o DS18B20 via polling HTTP).
//  Agora implementa o CONTRATO COMPLETO da Diretriz Athenas v2.0:
//    - Telemetria assincrona via WebSocket (5 Hz, ws.textAll()).
//    - GPS Neo-6M @5Hz (Serial2 + TinyGPS++).
//    - Corrente (ACS758 +-50A) com filtro de media movel.
//    - Tensao da bateria (divisor resistivo, chumbo-acido 0-15V).
//    - Temperatura (DS18B20).
//    - Leme: interceptacao PASSIVA do PWM por interrupcao (largura de pulso).
//    - Alertas: alga (algae), superaquecimento, bateria baixa.
//
//  ARQUITETURA: 100% NAO BLOQUEANTE no loop de telemetria (sem delay()).
//               Tudo e cadenciado por temporizadores baseados em millis().
// ============================================================================

#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPS++.h>
// Para servir o frontend do LittleFS, descomente a linha abaixo.
// #include <LittleFS.h>

// ============================================================================
//  1) CONFIGURACOES DE REDE (WiFi STA)
// ============================================================================

// Credenciais da rede (constantes; ajuste conforme o ambiente do barco/doca).
const char* WIFI_SSID     = "Graest-TI";
const char* WIFI_PASSWORD = "!gra.3st#";

// IP ESTATICO (recomendado para a estacao de bordo):
// Um IP fixo evita que o dashboard precise "descobrir" o ESP32 a cada boot.
// Para ativar, descomente o bloco abaixo e chame WiFi.config(...) no setup().
//   IPAddress ip(192, 168, 0, 50);       // IP fixo desejado para o ESP32
//   IPAddress gateway(192, 168, 0, 1);   // Gateway da rede (roteador)
//   IPAddress subnet(255, 255, 255, 0);  // Mascara de sub-rede
//   IPAddress dns(192, 168, 0, 1);       // DNS (pode ser o proprio gateway)

// ============================================================================
//  2) MAPA DE PINOS (GPIOs) - veja tambem o README.md
// ============================================================================

// --- DS18B20 (temperatura) ---
const int PINO_DS18B20 = 4;     // 1-Wire (precisa de resistor pull-up 4.7k)

// --- GPS Neo-6M (UART) ---
const int PINO_GPS_RX = 16;     // RX2 do ESP32  <- TX do GPS
const int PINO_GPS_TX = 17;     // TX2 do ESP32  -> RX do GPS

// --- ACS758 (sensor de corrente +-50A, saida analogica) ---
const int PINO_ACS758 = 34;     // ADC1_CH6 (apenas entrada; sem pull interno)

// --- Voltimetro (divisor resistivo da bateria) ---
const int PINO_TENSAO = 35;     // ADC1_CH7 (apenas entrada)

// --- Leme: tap PASSIVO de ALTA IMPEDANCIA no fio de sinal do servo/PWM ---
const int PINO_LEME_PWM = 27;   // entrada digital com interrupcao (CHANGE)

// ============================================================================
//  3) CONSTANTES DE CALIBRACAO E LIMIARES (Diretriz v2.0)
// ============================================================================

// --- ADC do ESP32 ---
const float ADC_VREF   = 3.3f;    // tensao de referencia da entrada analogica
const int   ADC_MAX    = 4095;    // resolucao de 12 bits (0..4095)

// --- ACS758 (-50A .. +50A, alimentado em 5V) ---
// Sensibilidade tipica do ACS758 +-50A: 40 mV/A = 0.040 V/A.
// Offset de corrente zero: Vcc/2. ATENCAO: o sensor opera em 5V, mas a entrada
// do ESP32 e 3.3V -> use um divisor para condicionar a saida ate ~3.3V e
// ajuste ACS758_OFFSET_V de acordo com o que CHEGA no pino do ADC.
const float ACS758_SENS_V_POR_A = 0.040f;  // V/A (40 mV/A)
const float ACS758_OFFSET_V     = 1.65f;   // tensao de 0A vista pelo ADC (Vcc/2)
const int   FILTRO_JANELA       = 12;      // tamanho da janela da media movel

// --- Voltimetro (divisor resistivo) ---
// Mapeia 0..3.3V no ADC para 0..15.0V da bateria de chumbo-acido.
// Dimensione o divisor (R1/R2) para que 15V reais resultem em ~3.3V no ADC.
const float TENSAO_BATERIA_MAX = 15.0f;    // fundo de escala (chumbo-acido)

// --- Leme (mapeamento do PWM tipo servo) ---
// 1000us -> -45 graus | 1500us -> 0 graus | 2000us -> +45 graus.
const long LEME_PULSO_MIN_US = 1000;
const long LEME_PULSO_MID_US = 1500;  // (referencia/centro; documental)
const long LEME_PULSO_MAX_US = 2000;
const int  LEME_ANGULO_MIN   = -45;
const int  LEME_ANGULO_MAX   = +45;

// --- Limiares de alerta ---
const float LIMIAR_TEMP_OVERHEAT_C = 70.0f;   // >= 70C -> superaquecimento
const float LIMIAR_BATERIA_BAIXA_V = 11.8f;   // <= 11.8V -> bateria baixa
const float LIMIAR_ALGA_CORRENTE_A = 25.0f;   // corrente alta sustentada
const float LIMIAR_ALGA_VELOC_KMH  = 2.0f;    // velocidade baixa
const unsigned long LIMIAR_ALGA_TEMPO_MS = 1500; // por > 1.5s

// --- Cadencia da telemetria ---
const unsigned long INTERVALO_TELEMETRIA_MS = 200;  // 200ms = 5 Hz
const unsigned long INTERVALO_TEMP_MS       = 1000; // DS18B20 e lento; 1Hz basta

// ============================================================================
//  4) OBJETOS GLOBAIS (servidor, sensores)
// ============================================================================

AsyncWebServer server(80);          // servidor HTTP na porta 80
AsyncWebSocket ws("/ws");           // canal WebSocket em "/ws"

OneWire oneWire(PINO_DS18B20);          // barramento 1-Wire
DallasTemperature sensorTemp(&oneWire); // driver do DS18B20

TinyGPSPlus gps;                    // parser NMEA do Neo-6M

// ============================================================================
//  5) ESTADO GLOBAL DA TELEMETRIA
// ============================================================================

// --- GPS ---
double  g_lat = 0.0;
double  g_lng = 0.0;
double  g_speed_kmh = 0.0;
double  g_cog = 0.0;        // course over ground (rumo) em graus
bool    g_fix = false;      // location.isValid()

// --- Sensores ---
float   g_current_a = 0.0;  // corrente em Amperes (apos filtro + conversao)
float   g_voltage_v = 0.0;  // tensao da bateria em Volts
float   g_temp_c     = 0.0; // temperatura em graus Celsius
int     g_rudder_deg = 0;   // angulo do leme em graus (-45..+45)

// --- Status / alertas ---
bool    g_algae_alert    = false;
bool    g_overheat_alert = false;
bool    g_battery_low    = false;

// --- Media movel do ACS758 (buffer circular) ---
int     bufCorrente[FILTRO_JANELA] = {0};
int     idxCorrente = 0;
long    somaCorrente = 0;     // soma corrente do buffer (atualizada incremental)
bool    bufCheio = false;     // indica se a janela ja foi preenchida 1x

// --- Detector do alerta de alga (maquina de tempo via millis) ---
unsigned long algaInicioMs = 0;   // instante em que a condicao comecou
bool          algaContando = false;

// --- Temporizadores nao bloqueantes ---
unsigned long ultimaTelemetriaMs = 0;
unsigned long ultimaTempMs       = 0;

// ============================================================================
//  6) LEME - INTERCEPTACAO PASSIVA DO PWM POR INTERRUPCAO
// ============================================================================
//  Medimos a LARGURA do pulso (us) na borda de subida/descida.
//  As variaveis sao 'volatile' pois sao compartilhadas com a ISR.

volatile unsigned long lemeInicioPulsoUs = 0;  // timestamp da borda de subida
volatile unsigned long lemeLarguraUs     = LEME_PULSO_MID_US; // ultima largura
volatile bool          lemeNovoPulso     = false; // sinaliza pulso novo

// ISR (Interrupt Service Routine) na borda CHANGE.
// IRAM_ATTR mantem a rotina na RAM interna (execucao rapida e segura).
void IRAM_ATTR isrLeme() {
  unsigned long agoraUs = micros();
  if (digitalRead(PINO_LEME_PWM) == HIGH) {
    // Borda de SUBIDA: marca o inicio do pulso.
    lemeInicioPulsoUs = agoraUs;
  } else {
    // Borda de DESCIDA: largura = agora - inicio.
    unsigned long largura = agoraUs - lemeInicioPulsoUs;
    // Filtro de sanidade: ignora ruidos fora da faixa de um servo (~0.5-2.5ms).
    if (largura >= 500 && largura <= 2500) {
      lemeLarguraUs = largura;
      lemeNovoPulso = true;
    }
  }
}

// ============================================================================
//  7) LEITURA DOS SENSORES (funcoes auxiliares nao bloqueantes)
// ============================================================================

// --- 7.1) Corrente (ACS758) com media movel de janela circular ---
void lerCorrente() {
  // Le a amostra bruta do ADC.
  int amostra = analogRead(PINO_ACS758);

  // Atualiza o buffer circular de forma incremental (O(1)):
  // remove a amostra antiga da soma e adiciona a nova.
  somaCorrente -= bufCorrente[idxCorrente];
  bufCorrente[idxCorrente] = amostra;
  somaCorrente += amostra;

  // Avanca o indice circular; marca quando a janela completou 1 volta.
  idxCorrente++;
  if (idxCorrente >= FILTRO_JANELA) {
    idxCorrente = 0;
    bufCheio = true;
  }

  // Quantidade efetiva de amostras (evita media errada antes de encher).
  int n = bufCheio ? FILTRO_JANELA : (idxCorrente == 0 ? FILTRO_JANELA : idxCorrente);
  if (n < 1) n = 1;

  // Media das amostras (ADC) -> tensao -> corrente.
  float mediaAdc = (float)somaCorrente / (float)n;
  float tensao   = (mediaAdc / ADC_MAX) * ADC_VREF;   // ADC -> Volts
  // Conversao: I = (Vmedido - Voffset) / sensibilidade.
  g_current_a = (tensao - ACS758_OFFSET_V) / ACS758_SENS_V_POR_A;
}

// --- 7.2) Tensao da bateria (divisor resistivo -> 0..15V) ---
void lerTensao() {
  int amostra = analogRead(PINO_TENSAO);
  // Mapeia 0..3.3V (ADC) para 0..15.0V (bateria chumbo-acido).
  float tensaoAdc = (amostra / (float)ADC_MAX) * ADC_VREF;
  g_voltage_v = (tensaoAdc / ADC_VREF) * TENSAO_BATERIA_MAX;
}

// --- 7.3) Angulo do leme a partir da largura do pulso PWM ---
void atualizarLeme() {
  if (!lemeNovoPulso) return;       // nada novo desde a ultima leitura

  // Copia segura do valor volatile (rapida; sem desabilitar interrupcao
  // por muito tempo). A leitura de unsigned long no ESP32 e atomica o
  // suficiente para este caso de monitoramento.
  unsigned long largura = lemeLarguraUs;
  lemeNovoPulso = false;

  // Mapeia 1000us->-45 ; 1500us->0 ; 2000us->+45 e limita a faixa.
  long ang = map((long)largura, LEME_PULSO_MIN_US, LEME_PULSO_MAX_US,
                 LEME_ANGULO_MIN, LEME_ANGULO_MAX);
  ang = constrain(ang, LEME_ANGULO_MIN, LEME_ANGULO_MAX);
  g_rudder_deg = (int)ang;
}

// --- 7.4) GPS: drena o Serial2 e atualiza o estado quando ha dado valido ---
void atualizarGps() {
  // Le todos os bytes disponiveis (nao bloqueante: while sobre available()).
  while (Serial2.available() > 0) {
    gps.encode(Serial2.read());
  }

  // Posicao.
  if (gps.location.isValid()) {
    g_lat = gps.location.lat();
    g_lng = gps.location.lng();
    g_fix = true;
  } else {
    g_fix = false;
  }

  // Velocidade sobre o solo (km/h).
  if (gps.speed.isValid()) {
    g_speed_kmh = gps.speed.kmph();
  }

  // Rumo / curso sobre o solo (graus).
  if (gps.course.isValid()) {
    g_cog = gps.course.deg();
  }
}

// --- 7.5) Avaliacao dos alertas de status ---
void avaliarStatus() {
  // Superaquecimento: temperatura >= 70C.
  g_overheat_alert = (g_temp_c >= LIMIAR_TEMP_OVERHEAT_C);

  // Bateria baixa: tensao <= limiar.
  g_battery_low = (g_voltage_v <= LIMIAR_BATERIA_BAIXA_V);

  // Alga: corrente alta E velocidade baixa, sustentado por > 1.5s.
  // (Helice presa em algas -> esforco sobe, mas o barco quase nao anda.)
  bool condicaoAlga = (g_current_a > LIMIAR_ALGA_CORRENTE_A) &&
                      (g_speed_kmh < LIMIAR_ALGA_VELOC_KMH);

  unsigned long agora = millis();
  if (condicaoAlga) {
    if (!algaContando) {
      // Comecou a condicao: inicia o cronometro.
      algaContando = true;
      algaInicioMs = agora;
    }
    // Dispara o alerta apenas se a condicao persistir alem do limiar.
    g_algae_alert = (agora - algaInicioMs) >= LIMIAR_ALGA_TEMPO_MS;
  } else {
    // Condicao cessou: reseta o cronometro e o alerta.
    algaContando = false;
    g_algae_alert = false;
  }
}

// ============================================================================
//  8) MONTAGEM E ENVIO DO JSON DE TELEMETRIA (contrato v2.0)
// ============================================================================
//  JSON EXATO:
//  {
//    "gps":{lat,lng,speed_kmh,cog,fix},
//    "sensors":{current_a,voltage_v,temp_c,rudder_deg},
//    "status":{algae_alert,overheat_alert,battery_low}
//  }
void enviarTelemetria() {
  // Documento fixo na pilha: suficiente para esse payload pequeno.
  StaticJsonDocument<384> doc;

  JsonObject gpsObj = doc.createNestedObject("gps");
  gpsObj["lat"]       = g_lat;
  gpsObj["lng"]       = g_lng;
  gpsObj["speed_kmh"] = g_speed_kmh;
  gpsObj["cog"]       = g_cog;
  gpsObj["fix"]       = g_fix;

  JsonObject sensObj = doc.createNestedObject("sensors");
  sensObj["current_a"]  = g_current_a;
  sensObj["voltage_v"]  = g_voltage_v;
  sensObj["temp_c"]     = g_temp_c;
  sensObj["rudder_deg"] = g_rudder_deg;

  JsonObject stObj = doc.createNestedObject("status");
  stObj["algae_alert"]    = g_algae_alert;
  stObj["overheat_alert"] = g_overheat_alert;
  stObj["battery_low"]    = g_battery_low;

  // Serializa e transmite para TODOS os clientes WebSocket conectados.
  String payload;
  serializeJson(doc, payload);
  ws.textAll(payload);
}

// ============================================================================
//  9) EVENTOS DO WEBSOCKET
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
    case WS_EVT_DATA:
    case WS_EVT_PONG:
    case WS_EVT_ERROR:
      // Esta estacao e somente leitura: nao processamos comandos do cliente.
      break;
  }
}

// ============================================================================
//  10) SETUP
// ============================================================================
void setup() {
  // --- Serial de debug ---
  Serial.begin(115200);
  Serial.println("\n[Athenas v2.0] Iniciando firmware de bordo...");

  // --- ADC: 12 bits e atenuacao para faixa de ~0..3.3V ---
  analogReadResolution(12);
  analogSetPinAttenuation(PINO_ACS758, ADC_11db);
  analogSetPinAttenuation(PINO_TENSAO, ADC_11db);

  // --- DS18B20 ---
  sensorTemp.begin();
  // Modo nao bloqueante: nao esperamos a conversao terminar (waitForConversion
  // = false). Lemos o resultado na proxima passada do loop de temperatura.
  sensorTemp.setWaitForConversion(false);
  sensorTemp.requestTemperatures();   // dispara a primeira conversao

  // --- Leme: tap PASSIVO + interrupcao na borda CHANGE ---
  pinMode(PINO_LEME_PWM, INPUT);      // alta impedancia (nao carrega o sinal)
  attachInterrupt(digitalPinToInterrupt(PINO_LEME_PWM), isrLeme, CHANGE);

  // --- GPS Neo-6M no Serial2 (UART2) ---
  // Comecamos em 9600 (default de fabrica do Neo-6M) para enviar os comandos
  // de configuracao; depois passamos a operar a 5 Hz.
  Serial2.begin(9600, SERIAL_8N1, PINO_GPS_RX, PINO_GPS_TX);
  delay(100);  // pequena espera SO no boot (fora do loop de telemetria)

  // ----- Configuracao do GPS para 5 Hz -----
  // O Neo-6M aceita comandos UBX (binarios). Enviamos:
  //   1) CFG-RATE: taxa de medicao = 200ms (5 Hz).
  //   2) (Opcional) reduzir as sentencas NMEA para aliviar a UART.
  //
  // UBX CFG-RATE (classe 0x06, id 0x08), payload de 6 bytes:
  //   measRate=200ms (0xC8 0x00), navRate=1, timeRef=1 (GPS).
  // Os dois ultimos bytes sao o checksum Fletcher (CK_A, CK_B).
  const uint8_t UBX_CFG_RATE_5HZ[] = {
    0xB5, 0x62,             // header UBX (sync chars)
    0x06, 0x08,             // class=CFG, id=RATE
    0x06, 0x00,             // length = 6
    0xC8, 0x00,             // measRate = 200 ms (0x00C8)
    0x01, 0x00,             // navRate  = 1
    0x01, 0x00,             // timeRef  = 1 (GPS time)
    0xDE, 0x6A              // checksum (CK_A, CK_B)
  };
  Serial2.write(UBX_CFG_RATE_5HZ, sizeof(UBX_CFG_RATE_5HZ));
  Serial2.flush();

  // Alternativa MTK (caso o modulo seja MTK, p.ex. PA6H):
  //   PMTK220 define o intervalo de fix em ms. 200ms = 5 Hz.
  //   Serial2.println("$PMTK220,200*2C");
  //   Serial2.flush();

  // --- WiFi STA ---
  WiFi.mode(WIFI_STA);
  // Para IP estatico, descomente as constantes no topo e a linha abaixo:
  //   WiFi.config(ip, gateway, subnet, dns);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Conectando");
  // Espera de conexao SO no boot (aceitavel; nao e o loop de telemetria).
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("[WiFi] Conectado! IP: ");
  Serial.println(WiFi.localIP());

  // --- LittleFS / Frontend ---
  // O dashboard (HTML/JS/CSS) e servido a partir do LittleFS.
  // Descomente para montar o FS e servir o "index.html" gravado em /data:
  //   if (!LittleFS.begin(true)) {
  //     Serial.println("[FS] Falha ao montar LittleFS");
  //   } else {
  //     // Serve qualquer arquivo estatico; "/" cai em index.html.
  //     server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  //   }

  // --- WebSocket ---
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // --- Servidor HTTP ---
  server.begin();
  Serial.println("[HTTP] Servidor na porta 80 | WebSocket em /ws");
  Serial.println("[Athenas v2.0] Pronto. Telemetria a 5 Hz.");
}

// ============================================================================
//  11) LOOP - 100% NAO BLOQUEANTE (sem delay() aqui dentro)
// ============================================================================
void loop() {
  unsigned long agora = millis();

  // --- (a) GPS: drenar a UART o tempo todo (alta frequencia) ---
  atualizarGps();

  // --- (b) Leme: aplicar o ultimo pulso medido pela ISR ---
  atualizarLeme();

  // --- (c) Corrente: amostrar a cada passada para alimentar o filtro ---
  lerCorrente();

  // --- (d) Tensao: leitura leve, pode ser a cada passada ---
  lerTensao();

  // --- (e) Temperatura: DS18B20 e lento -> ler a ~1 Hz (nao bloqueante) ---
  if (agora - ultimaTempMs >= INTERVALO_TEMP_MS) {
    ultimaTempMs = agora;
    float t = sensorTemp.getTempCByIndex(0);  // le a conversao ja pronta
    if (t != DEVICE_DISCONNECTED_C) {
      g_temp_c = t;
    }
    sensorTemp.requestTemperatures();  // dispara a proxima conversao (assinc.)
  }

  // --- (f) Telemetria: montar e enviar o JSON a cada 200ms (5 Hz) ---
  if (agora - ultimaTelemetriaMs >= INTERVALO_TELEMETRIA_MS) {
    ultimaTelemetriaMs = agora;
    avaliarStatus();      // recalcula alertas com os valores mais recentes
    enviarTelemetria();   // ws.textAll(JSON)
    ws.cleanupClients();  // libera recursos de clientes WS desconectados
  }
}
