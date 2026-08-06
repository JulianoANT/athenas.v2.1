# Athenas v2.2 — Firmware (enlace LoRa)

Dois firmwares, duas placas **Heltec WiFi LoRa 32 (V3)**.

```
┌──────────────────┐    LoRa 915 MHz     ┌──────────────────┐   WiFi AP    ┌──────────┐
│     ESCRAVO      │   39 bytes @ 5 Hz   │      MESTRE      │  WebSocket   │    PC    │
│   (no barco)     │ ──────────────────▶ │    (em terra)    │ ───────────▶ │ Athenas  │
│ firmware/onboard │                     │firmware/receiver │              │    OS    │
└──────────────────┘                     └──────────────────┘              └──────────┘
     lê sensores                          valida CRC, remonta               dashboard
   empacota binário                      o contrato JSON v2.1               sem alteração
```

| Pasta | Papel | Onde fica |
|---|---|---|
| [`onboard/`](onboard) | **Escravo** — lê os sensores e transmite por LoRa | Dentro do barco |
| [`receiver/`](receiver) | **Mestre** — recebe, remonta o JSON e serve o WebSocket | Com a equipe, na margem |
| [`shared/`](shared) | Protocolo binário compartilhado pelos dois | — |

---

## Por que binário no ar, e não JSON

O contrato JSON do dashboard tem **~400 bytes**. A 5 Hz são 16 kbps. O LoRa em
SF7/BW125 entrega **5,4 kbps brutos** — um pacote de 400 bytes levaria ~700 ms
de airtime, ou seja, menos de 1,5 quadros por segundo.

Empacotando em campos de largura fixa, o mesmo quadro cabe em **39 bytes**. O
mestre remonta o JSON completo em terra, então **o dashboard não sabe que existe
um rádio no caminho** — o contrato com o software é byte a byte o mesmo.

O protocolo está em [`shared/athenas_link.h`](shared/athenas_link.h), incluído
pelos dois firmwares. Um `static_assert` quebra a compilação se o layout mudar
sem a versão ser incrementada — exatamente o tipo de divergência silenciosa que
deixaria o mestre decodificando lixo.

---

## Alcance × taxa: a decisão de engenharia

Airtime de um pacote de 39 bytes e alcance típico com visada livre sobre água:

| SF | BW | Airtime | Máx. Hz | Ciclo @ 5 Hz | Alcance |
|---|---|---|---|---|---|
| **SF7** | **125 kHz** | **82 ms** | 12 Hz | **41%** | **~2–3 km** ← padrão |
| SF7 | 250 kHz | 41 ms | 24 Hz | 21% | ~1,5–2 km |
| SF8 | 125 kHz | 144 ms | 6 Hz | 72% | ~3–4 km |
| SF9 | 125 kHz | 267 ms | 3 Hz | não cabe | ~5 km |
| SF10 | 125 kHz | 493 ms | 2 Hz | não cabe | ~7 km |

**5 Hz custa alcance.** Se o rio for mais longo do que o SF7 cobre, o caminho
certo é **baixar a taxa**, não forçar o rádio:

```cpp
// onboard/src/main.cpp
static const unsigned long INTERVALO_TX_MS = 500;  // 2 Hz
static const uint8_t LORA_SF = 9;                  // ~5 km
```

E o mesmo `LORA_SF` em `receiver/src/main.cpp`.

> **Nada no software assume 5 Hz.** O dashboard mede a cadência real e a exibe no
> badge de conexão; o filtro de Kalman e o gêmeo térmico integram com o `dt`
> medido. Baixar a taxa degrada a suavidade, não a correção.

**Frequência: 915 MHz.** No Brasil a ANATEL libera 902–907,5 e 915–928 MHz para
uso sem licença. **Não use 868 MHz** (faixa europeia).

---

## Mapa de pinos — Heltec V3 (ESP32-S3)

⚠️ **Esta placa não é um ESP32 clássico.** GPIO 22, 23, 25, 27 e 32 **não
existem** no ESP32-S3. Sobram exatamente **dez** pinos livres:

> GPIO **1, 2, 4, 5, 6, 7, 19, 20, 47, 48**

Tudo o mais está ocupado: SX1262 (8–14), OLED (17, 18, 21), flash (33–38),
USB-serial (43, 44).

### Escravo — ligação dos sensores

| Sensor | Interface | Pino | Observação |
|---|---|---|---|
| **MPU6050** | I2C | **SDA 17 · SCL 18** | **Compartilha o barramento do OLED.** Endereços diferentes (OLED 0x3C, MPU 0x68) convivem sem conflito e isso poupa os dois pinos que não temos de sobra. |
| **GPS Neo-6M** | UART1 | **RX 47 · TX 48** | RX do ESP ↔ TX do GPS (cruzado). |
| **ACS758** | Analógico | **GPIO 6** | ADC1. Precisa de divisor: o sensor sai em 5 V, a entrada é 3,3 V. |
| **Divisor de tensão** | Analógico | **GPIO 7** | ADC1. Dimensione para 15 V → 3,3 V. |
| **DS18B20** | 1-Wire | **GPIO 5** | **Pull-up de 4,7 kΩ obrigatório** entre dados e VCC. |
| **DHT22** | Digital | **GPIO 4** | — |
| **Leme (tap PWM)** | Digital + IRQ | **GPIO 2** | Tap de alta impedância no fio de sinal do servo. |

Sobram GPIO 1 (divisor da bateria da placa), 19 e 20 (USB nativo do S3). O
mestre não usa nenhum pino externo.

---

## Gravar as duas placas

### ⚠️ Desconecte uma placa antes de gravar a outra

As duas Heltec saem de fábrica com o **mesmo número de série USB** (`0001`), e o
Linux **renumera as portas** a cada reconexão — `ttyUSB0` vira `ttyUSB1`, e assim
por diante. Com as duas ligadas, não existe forma confiável de dizer ao
PlatformIO qual é qual, e é muito fácil gravar o firmware do mestre por cima do
escravo.

O sintoma disso é silencioso e confunde: o mestre acusa `rx: 0` e ninguém
transmite, porque **as duas placas viraram mestre**.

**Como conferir em 2 segundos:** olhe os OLEDs. Um tem que dizer
`ATHENAS ESCRAVO` e o outro `ATHENAS MESTRE`. Se os dois disserem a mesma coisa,
foi isso que aconteceu.

**A regra:** deixe **só uma placa conectada** durante cada gravação.

```bash
# 1. Conecte SÓ a placa do barco
cd firmware/onboard  && ~/.local/bin/pio run -t upload

# 2. Desconecte-a. Conecte SÓ a placa de terra
cd firmware/receiver && ~/.local/bin/pio run -t upload
```

Se precisar mesmo gravar com as duas ligadas, confira a porta antes e passe-a
explicitamente:

```bash
ls /dev/ttyUSB*
~/.local/bin/pio run -t upload --upload-port /dev/ttyUSB0
```

Cada placa tem seu próprio projeto PlatformIO.

### 1. Escravo (o que vai no barco)

```bash
cd firmware/onboard && ~/.local/bin/pio run -t upload && ~/.local/bin/pio device monitor
```

Esperado no monitor serial:

```
[Athenas v2.2] ESCRAVO — Heltec V3 (ESP32-S3 + SX1262)
[IMU] MPU6050 ok (I2C 17/18, compartilhado com o OLED)
[1-Wire] 1 sensor(es) DS18B20
[LoRa] 915.0 MHz  SF7  BW125 kHz  20 dBm  (39 bytes/pacote)
[Athenas] Pronto. Transmitindo a 5.0 Hz.
```

O OLED da placa mostra contadores de TX, estado do GPS e quais sensores estão em
falha (`G` GPS, `I` IMU, `T` temperatura, `A` ambiente).

### 2. Mestre (o que fica com você)

```bash
cd firmware/receiver && ~/.local/bin/pio run -t upload && ~/.local/bin/pio device monitor
```

Esperado:

```
[Athenas v2.2] MESTRE — Heltec V3 (ESP32-S3 + SX1262)
[WiFi] AP "Athenas-Base"  senha "athenas2026"
[WiFi] Dashboard em ws://192.168.4.1/ws
[LoRa] Escutando em 915.0 MHz  SF7  BW125 kHz
[Athenas] Mestre pronto.
```

### 3. Conectar o dashboard

1. No notebook, conecte-se à rede WiFi **`Athenas-Base`** (senha `athenas2026`).
2. Suba o painel:

```bash
cd dashboard && npm run dev -- --host
```

3. O endereço padrão já é `ws://192.168.4.1/ws`. Não precisa configurar nada.

> ⚠️ **Se o upload falhar**, baixe a velocidade em `platformio.ini`:
> `upload_speed = 460800`. Se ainda falhar, segure o botão **PRG/BOOT** da placa
> enquanto o upload começa.

---

## Ligue as antenas ANTES de energizar

**Transmitir sem antena danifica o SX1262.** A energia que deveria irradiar
volta para o estágio de saída. Confira as duas antenas conectadas antes de
ligar qualquer uma das placas.

---

## Roteiro de teste

### Passo 1 — Enlace de rádio, na bancada

Ligue as duas placas lado a lado. O OLED do **mestre** deve sair de
`SEM ENLACE` para:

```
ATHENAS MESTRE
RSSI -35 dBm
SNR  9.5 dB
RX 142  perda 0.0%
WS 0  192.168.4.1
```

Com as placas a um metro, o RSSI fica em torno de **−30 a −45 dBm** e a perda
em **0%**. Se continuar em `SEM ENLACE`, veja a tabela de problemas abaixo.

### Passo 2 — Sensores

Com o dashboard conectado, abra **Prontuário & Diagnósticos → Saúde dos
Sensores** e valide um a um:

| Sensor | O que fazer | O que deve acontecer |
|---|---|---|
| **MPU6050** | Incline a placa do barco | O casco 3D no Horizonte Artificial acompanha. **Roll** muda ao inclinar de lado, **Pitch** ao inclinar de frente. Se trocarem, gire o sensor 90° na montagem. |
| **DS18B20** | Segure o sensor com a mão | Sensor físico sobe em segundos. |
| **DHT22** | Sopre no sensor | Umidade sobe rápido. |
| **ACS758** | Ligue o motor devagar | Corrente sai de ~0 A. Parado deve marcar ~0 A. |
| **Divisor** | Meça a bateria com multímetro | O valor no painel bate. |
| **Leme** | Mova o manche de um extremo a outro | O leme varre −45° a +45°. |
| **GPS** | Leve a placa para **fora**, céu aberto | Badge muda para **GPS Fixado**; o barco aparece no mapa. |

### Passo 3 — Alcance real (faça ANTES da prova)

Este é o teste que não dá para pular. Leve o escravo caminhando enquanto alguém
observa o OLED do mestre e anota o RSSI:

| RSSI | Situação |
|---|---|
| **acima de −100 dBm** | Folga confortável |
| **−100 a −115 dBm** | Funciona, mas no limite — perda começa a aparecer |
| **abaixo de −115 dBm** | Perda de pacotes iminente |

Anote a distância em que a perda passa de **5%**. Essa é a sua distância útil
real, e ela decide se dá para manter 5 Hz ou se é preciso subir o SF.

**Ganho fácil de alcance:** eleve as duas antenas. LoRa sobre água é dominado
pela zona de Fresnel — uma antena a 2 m do chão alcança muito mais que a mesma
antena apoiada na grama.

---

## Solução de problemas

| Sintoma | Causa provável | Correção |
|---|---|---|
| Mestre fica em **SEM ENLACE** | Parâmetros de rádio diferentes entre as placas | Confira que `LORA_FREQ_MHZ`, `LORA_SF`, `LORA_BW_KHZ` e `LORA_CR` são **idênticos** nos dois `main.cpp`. Divergir = silêncio absoluto, sem mensagem de erro. É o modo de falha mais frustrante do LoRa. |
| `[LoRa] FALHA na inicializacao` | TCXO não configurado | A Heltec V3 exige `LORA_TCXO_V = 1.8`. Sem isso o rádio não sai do reset. |
| Transmite mas ninguém recebe | Switch de RF | `radio.setDio2AsRfSwitch(true)` é obrigatório na V3 — sem ele o sinal não chega à antena. |
| Perda alta em pouca distância | Antena solta ou obstrução | Verifique os conectores SMA e eleve as antenas. |
| **IMU offline** | SDA/SCL trocados, ou AD0 em VCC | Confira a fiação; se AD0 = VCC, use `MPU6050_ADDR = 0x69`. |
| Temperatura do motor sempre `--` | Falta o pull-up de 4,7 kΩ | Instale o resistor entre dados e VCC. |
| GPS nunca fixa | Testando dentro de prédio | O Neo-6M precisa de céu aberto; o primeiro fix leva minutos. |
| Placa reinicia sozinha | Alimentação insuficiente | O pico de TX do LoRa puxa corrente. Use fonte de 5 V ≥ 1 A. |
| PC não acha a rede `Athenas-Base` | Mestre não subiu | Veja o OLED: o IP `192.168.4.1` aparece na última linha. |

---

## Dois contadores de perda, dois significados

O painel mostra dois números que **não medem a mesma coisa**:

- **Pacotes perdidos no ar** (`link.lost`) — medido pelo **mestre** pelas lacunas
  no contador do barco. É perda de **rádio**: alcance, antena, obstrução.
- **Quadros perdidos (WebSocket)** — medido pelo **dashboard** pelas lacunas no
  contador do mestre. É perda entre o **mestre e o PC**: WiFi da margem.

Separar os dois é o que permite saber de que lado está o problema. Por isso o
mestre emite um contador próprio em `seq` em vez de repassar o do barco.
