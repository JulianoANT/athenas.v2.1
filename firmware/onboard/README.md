# Athenas v2.0 — Firmware de bordo (onboard)

Firmware para **ESP32 DevKit** que coleta a telemetria do barco e a transmite
em tempo real (5 Hz) para o dashboard via **WebSocket**. É a evolução do
"Athenas Motor 2026" (que só lia o DS18B20 por polling HTTP) para o **contrato
completo da Diretriz Athenas v2.0**.

> **Filosofia de segurança:** o ESP32 é **somente leitura**. Ele **NÃO** comanda
> motor, leme ou qualquer atuador. O sinal do leme é interceptado por um *tap*
> **passivo de alta impedância** — apenas observa, não interfere.

---

## Sumário

- [Sensores e funcionalidades](#sensores-e-funcionalidades)
- [Pinagem sugerida (GPIOs)](#pinagem-sugerida-gpios)
- [Contrato JSON da telemetria](#contrato-json-da-telemetria)
- [Lógica dos alertas](#lógica-dos-alertas)
- [Como compilar e gravar (PlatformIO)](#como-compilar-e-gravar-platformio)
- [Frontend no LittleFS](#frontend-no-littlefs)
- [Notas de segurança](#notas-de-segurança)
- [Calibração](#calibração)

---

## Sensores e funcionalidades

| Recurso | Hardware | Observação |
|---|---|---|
| Posição / velocidade / rumo | GPS **Neo-6M** @ 5 Hz | `Serial2`, parsing com TinyGPS++ |
| Corrente do motor | **ACS758** (-50A..+50A) | filtro de **média móvel** (12 amostras) |
| Tensão da bateria | divisor resistivo | chumbo-ácido, 0–15 V |
| Temperatura | **DS18B20** (1-Wire) | leitura não bloqueante (~1 Hz) |
| Ângulo do leme | **tap passivo** do PWM | interrupção `CHANGE`, mede largura do pulso |
| Transporte | **AsyncWebServer + WebSocket** | `ws.textAll()` a cada 200 ms (5 Hz) |

A arquitetura do `loop()` é **100% não bloqueante**: nenhuma chamada a `delay()`
no caminho da telemetria. Toda a cadência é feita por temporizadores `millis()`.

---

## Pinagem sugerida (GPIOs)

| Sinal | GPIO | Tipo | Notas |
|---|---|---|---|
| DS18B20 (dados, 1-Wire) | **GPIO 4** | I/O | pull-up **4.7 kΩ** entre dado e 3.3 V |
| GPS RX (ESP32 ← TX do GPS) | **GPIO 16** | UART2 RX | |
| GPS TX (ESP32 → RX do GPS) | **GPIO 17** | UART2 TX | |
| ACS758 (saída analógica) | **GPIO 34** | ADC1_CH6 (só entrada) | condicionar saída de 5 V → ≤3.3 V |
| Voltímetro (divisor) | **GPIO 35** | ADC1_CH7 (só entrada) | dimensionar para 15 V → ~3.3 V |
| Leme (tap PWM passivo) | **GPIO 27** | entrada digital + IRQ | **alta impedância**, `INPUT` |

> **Dica ADC:** use **somente pinos do ADC1** (GPIO 32–39) para leitura
> analógica. O ADC2 conflita com o WiFi e dá leituras instáveis quando a rede
> está ativa. GPIO 34/35/36/39 são **entrada apenas** (sem pull interno).

**Alimentação**
- ESP32: 3.3 V (regulado pela placa, alimentada via 5 V/USB ou conversor DC-DC).
- ACS758: 5 V. O GPS Neo-6M costuma aceitar 3.3–5 V (veja sua placa).
- **Aterramento comum (GND)** entre ESP32, sensores e a eletrônica do barco.

---

## Contrato JSON da telemetria

Enviado por WebSocket (`/ws`) a **5 Hz**. Formato **exato**:

```json
{
  "gps":     { "lat": 0.0, "lng": 0.0, "speed_kmh": 0.0, "cog": 0.0, "fix": false },
  "sensors": { "current_a": 0.0, "voltage_v": 0.0, "temp_c": 0.0, "rudder_deg": 0 },
  "status":  { "algae_alert": false, "overheat_alert": false, "battery_low": false }
}
```

| Campo | Origem | Unidade |
|---|---|---|
| `gps.lat`, `gps.lng` | TinyGPS++ `location` | graus decimais |
| `gps.speed_kmh` | `gps.speed.kmph()` | km/h |
| `gps.cog` | `gps.course.deg()` | graus (rumo / *course over ground*) |
| `gps.fix` | `gps.location.isValid()` | booleano (tem *fix*?) |
| `sensors.current_a` | ACS758 (filtrado) | Ampères (±) |
| `sensors.voltage_v` | divisor resistivo | Volts (0–15) |
| `sensors.temp_c` | DS18B20 | °C |
| `sensors.rudder_deg` | largura do pulso PWM | graus (−45..+45) |
| `status.*` | lógica de alertas | booleano |

---

## Lógica dos alertas

- **`overheat_alert`** — `temp_c >= 70 °C`.
- **`battery_low`** — `voltage_v <= 11.8 V` (limiar de chumbo-ácido; ajuste no código).
- **`algae_alert`** (hélice presa em algas) — disparado quando
  `current_a > 25 A` **E** `speed_kmh < 2 km/h`, **sustentado por > 1.5 s**.
  O detector usa um cronômetro `millis()`: a condição precisa **persistir**
  para evitar falsos positivos em transientes (ex.: partida do motor).

---

## Como compilar e gravar (PlatformIO)

Pré-requisitos: [PlatformIO](https://platformio.org/) (CLI ou extensão do VS Code).

```bash
# A partir da pasta firmware/onboard/

# Compilar
pio run

# Compilar + gravar no ESP32 (detecta a porta automaticamente)
pio run --target upload

# Abrir o monitor serial (115200 baud)
pio device monitor
```

Ambiente em `platformio.ini`: `env:esp32dev`, framework `arduino`,
`monitor_speed = 115200`.

**Dependências** (resolvidas automaticamente pelo PlatformIO):

```ini
ottowinter/ESPAsyncWebServer-esphome @ ^3.0.0   ; HTTP + WebSocket assíncronos
bblanchon/ArduinoJson @ ^6.21.3                 ; serialização do JSON
paulstoffregen/OneWire @ ^2.3.7                 ; barramento 1-Wire (DS18B20)
milesburton/DallasTemperature @ ^3.11.0         ; driver do DS18B20
mikalhart/TinyGPSPlus @ ^1.0.3                  ; parsing NMEA do Neo-6M
```

---

## Frontend no LittleFS

O dashboard (HTML/JS/CSS) é servido a partir do **LittleFS** (não fica embutido
no `.cpp`). Para habilitar:

1. Coloque os arquivos do frontend em `firmware/onboard/data/` (com `index.html`).
2. No `platformio.ini`, descomente `board_build.filesystem = littlefs`.
3. No `src/main.cpp`, descomente o bloco do `LittleFS.begin()` e
   `server.serveStatic(...)` dentro do `setup()`.
4. Grave a imagem do filesystem:

```bash
pio run --target uploadfs
```

O cliente web abre uma conexão em `ws://<IP-do-ESP32>/ws` e recebe o JSON a 5 Hz.

### IP estático (recomendado)

Para o dashboard achar o ESP32 sempre no mesmo endereço, descomente as
constantes de IP no topo do `main.cpp` e a chamada `WiFi.config(...)` no
`setup()`. Sem isso, descubra o IP no monitor serial após o boot.

---

## Notas de segurança

- **Leitura passiva, nunca controle.** O ESP32 **não** aciona motor, leme ou
  qualquer atuador. Ele apenas **observa**.
- **Tap de ALTA IMPEDÂNCIA no fio do leme.** O pino do PWM é configurado como
  `INPUT` (alta impedância), ligado **em paralelo** ao fio de sinal do
  servo/atuador. Assim ele **não carrega** nem distorce o sinal de controle
  original — o leme continua respondendo exatamente como sem o ESP32.
- **Não interromper o fio de sinal.** O *tap* é uma derivação; o sinal segue
  intacto do controlador para o atuador. Em caso de falha do ESP32, o controle
  do barco **não** é afetado.
- **Aterramento comum** é obrigatório para a medição do PWM e dos ADCs.
- **Isolamento da corrente:** o ACS758 já isola a medição (efeito Hall), mas a
  sua saída (5 V) precisa ser condicionada para ≤3.3 V antes do ADC do ESP32.
- **Proteção do ADC:** nunca aplique tensão > 3.3 V nos GPIOs analógicos.
  Dimensione corretamente o divisor do voltímetro e o condicionamento do ACS758.

---

## Calibração

Ajuste estas constantes no `src/main.cpp` conforme seu hardware:

| Constante | Função |
|---|---|
| `ACS758_SENS_V_POR_A` | sensibilidade do ACS758 (0.040 V/A no modelo ±50 A) |
| `ACS758_OFFSET_V` | tensão de **0 A** vista pelo ADC (≈ Vcc/2 condicionado) |
| `FILTRO_JANELA` | tamanho da média móvel da corrente (padrão 12) |
| `TENSAO_BATERIA_MAX` | fundo de escala do voltímetro (15 V) |
| `LEME_PULSO_MIN/MID/MAX_US` | calibração do PWM do leme (1000/1500/2000 µs) |
| `LIMIAR_*` | limiares dos alertas (temperatura, bateria, alga) |

> **Offset do ACS758:** com **0 A** circulando, leia a tensão no pino do ADC e
> ajuste `ACS758_OFFSET_V` para esse valor — isso elimina o erro de zero.
