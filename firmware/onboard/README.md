# Firmware — ESCRAVO (a bordo da embarcação)

**Placa:** Heltec WiFi LoRa 32 (V3) — ESP32-S3 + SX1262 + OLED

Lê todos os sensores de bordo e transmite por **LoRa 915 MHz** para o mestre em
terra. **Não há WiFi aqui**: o barco fica a centenas de metros no rio, fora do
alcance de 2,4 GHz.

> Visão geral do enlace, tabela de alcance × taxa e roteiro de teste no
> [README do firmware](../README.md).

---

## Ligação dos sensores

⚠️ **Esta placa não é um ESP32 clássico.** GPIO 22, 23, 25, 27 e 32 **não
existem** no ESP32-S3. Sobram exatamente dez pinos livres — 1, 2, 4, 5, 6, 7,
19, 20, 47, 48 — e usamos sete deles.

| Sensor | Interface | Pino | Observação |
|---|---|---|---|
| **MPU6050** | I2C | **SDA 17 · SCL 18** | **Compartilha o barramento do OLED.** Endereços diferentes (OLED 0x3C, MPU 0x68) convivem sem conflito, e isso poupa os dois pinos que não temos de sobra. |
| **GPS Neo-6M** | UART1 | **RX 47 · TX 48** | Cruzado: RX do ESP ↔ TX do GPS. |
| **ACS758** | Analógico | **GPIO 6** | ADC1. Precisa de divisor — o sensor sai em 5 V, a entrada é 3,3 V. |
| **Divisor de tensão** | Analógico | **GPIO 7** | ADC1. Dimensione para 15 V → 3,3 V. |
| **DS18B20** | 1-Wire | **GPIO 5** | **Pull-up de 4,7 kΩ obrigatório** entre dados e VCC, senão retorna −127,00 sempre. |
| **DHT22** | Digital | **GPIO 4** | Datasheet exige ≥ 2 s entre leituras. |
| **Leme (tap PWM)** | Digital + IRQ | **GPIO 2** | Tap **passivo** de alta impedância no fio de sinal do servo. |

Reservados: GPIO 1 (divisor da bateria da placa), 19 e 20 (USB nativo do S3).

---

## Blindagem de código implementada

| Defesa | Onde | Por quê |
|---|---|---|
| **Oversampling 16× + filtro EMA** no ACS758 | `lerCorrente()` | O ADC tem ruído térmico alto. Ler uma vez por ciclo geraria picos irreais de potência e falsos alertas no modelo termodinâmico do painel. |
| **Rejeição de −127,00 / 85,00** no DS18B20 | `atualizarTempMotor()` | São códigos de **erro** do 1-Wire, não temperaturas. O firmware retém o último valor válido e levanta a flag de falha. |
| **Rejeição de NaN** no DHT22 | `atualizarDht()` | Falha de timing por vibração do casco. Mesmo tratamento. |
| **Validação de idade do GPS** (`age() < 1500 ms`) | `atualizarGps()` | Sem isso, um GPS que perdeu o fix reportaria a última posição para sempre e o painel mostraria o barco parado no lugar errado, sem indício de problema. |
| **Transmissão LoRa assíncrona** | `transmitirPacote()` | Um `transmit()` bloqueante travaria o loop por ~82 ms a cada quadro — 41% da CPU parada, e o GPS perderia bytes da UART. |
| **Quadro atrasado é descartado** | `transmitirPacote()` | Se o rádio ainda está transmitindo, o quadro é pulado em vez de enfileirado. Melhor perder um quadro do que reportar posição de segundos atrás. |
| **Zero alocação dinâmica** | todo o arquivo | Nenhum `String`, nenhum `new`. O pacote é um struct global reaproveitado. |
| **Zero `delay()` no loop** | `loop()` | Tudo cadenciado por `millis()`. Os únicos `delay()` estão no `setup()`. |
| **Filtro complementar** (α = 0,98) na IMU | `mpuAtualizar()` | Integra o giroscópio (rápido, imune a vibração) e corrige a deriva pelo acelerômetro. É o que impede o horizonte artificial de tremer com o motor ligado. |
| **WiFi e Bluetooth desligados** | `setup()` | Ninguém para conectar no meio do rio. Economiza energia e tira uma fonte de ruído de 2,4 GHz de perto da antena de 915 MHz. |

---

## Gravar

```bash
cd firmware/onboard && ~/.local/bin/pio run -t upload && ~/.local/bin/pio device monitor
```

Esperado:

```
[Athenas v2.2] ESCRAVO — Heltec V3 (ESP32-S3 + SX1262)
[IMU] MPU6050 ok (I2C 17/18, compartilhado com o OLED)
[1-Wire] 1 sensor(es) DS18B20
[LoRa] 915.0 MHz  SF7  BW125 kHz  20 dBm  (39 bytes/pacote)
[Athenas] Pronto. Transmitindo a 5.0 Hz.
```

---

## Diagnóstico do barramento I2C

O firmware **varre o I2C no boot** e imprime tudo o que responder:

```
[I2C] Varrendo o barramento (SDA 17 / SCL 18)...
[I2C]   0x3C  <- OLED da placa
[I2C]   0x68  <- MPU6050 (AD0 em GND)
[IMU] MPU6050 em 0x68 (WHO_AM_I = 0x68)
```

Leia assim:

| O que aparece | Significado |
|---|---|
| `0x3C` **e** `0x68` (ou `0x69`) | Tudo certo. |
| Só `0x3C` | O barramento está bom (o OLED responde) — o problema é a **ligação do MPU6050**. |
| `NADA no barramento` | Problema de SDA/SCL, alimentação ou GND. |

O endereço do MPU é **detectado automaticamente** (0x68 com AD0 em GND ou solto,
0x69 com AD0 em VCC) — não é preciso configurar nada.

### Se a IMU não responder

O barco **continua transmitindo normalmente**: o painel marca o sensor como em
falha e todo o resto opera. A retentativa acontece a cada 3 s, então o sensor
volta sozinho se for reconectado com o barco na água.

> **Erro `i2cWriteReadNonStop returned Error -1` repetindo sem parar** significa
> firmware antigo. A versão atual sonda de forma silenciosa e só tenta a cada
> 3 s quando o sensor está ausente. Regrave.

---

## O OLED em campo

```
ATHENAS ESCRAVO
────────────────
TX 1420  ERR 0
GPS FIX 9 sat
18.2A 12.40V 54.1C
FALHA --T-
```

A última linha marca uma letra por sensor em falha: **G**ps, **I**mu,
**T**emperatura do motor, **A**mbiente. Traço = sensor nominal.

---

## Ajustar a taxa para ganhar alcance

Se o rio for mais longo do que o SF7 cobre, **baixe a taxa** em vez de forçar o
rádio:

```cpp
static const unsigned long INTERVALO_TX_MS = 500;  // 2 Hz
static const uint8_t LORA_SF = 9;                  // ~5 km
```

Faça a **mesma** mudança de `LORA_SF` em `receiver/src/main.cpp` e regrave as
duas placas. Nada no software assume 5 Hz — o dashboard mede a cadência real.

---

## Calibrações pendentes

### Zero do ACS758

Com o motor **desligado**, veja quanto o painel marca em *Corrente*. Se não for
≈ 0 A: meça com multímetro a tensão que chega **no GPIO 6** (após o divisor),
coloque esse valor em `ACS758_OFFSET_V` e regrave.

### Gêmeo térmico (α e β)

Os coeficientes do modelo `dT/dt = α·I² − β·(T − T_amb)` são propriedades
físicas do **seu** conjunto motriz. Os valores de fábrica são estimativas.

Ajuste na tela **Prontuário → Calibração do Gêmeo Térmico** (sem recompilar):

1. **β** — aqueça o motor, **desligue** e cronometre quanto tempo `t` a diferença
   `(T − T_amb)` leva para cair a **37%** do valor inicial. Então **β = 1/t**.
2. **α** — rode com corrente **constante** conhecida `I` até estabilizar em
   `T_eq`. Então **α = β·(T_eq − T_amb)/I²**.

**Critério de acerto:** numa arrancada, a curva **laranja** (núcleo virtual) sobe
**antes** da **branca** (sensor físico), e as duas **convergem** em regime.

---

## Pacote transmitido

39 bytes binários, definidos em
[`../shared/athenas_link.h`](../shared/athenas_link.h). O mestre remonta o
contrato JSON v2.1 completo em terra — o dashboard não sabe que existe um rádio
no caminho.

Escalas de ponto fixo (não há float no ar):

| Grandeza | Escala | Resolução |
|---|---|---|
| latitude / longitude | ×1e7 | ~1 cm |
| velocidade | cm/s | 0,01 m/s |
| rumo e atitude | 0,1° | 0,1° |
| corrente e tensão | 0,01 | 0,01 A / 0,01 V |
| temperaturas | 0,1 °C | 0,1 °C |

Oito booleanos (fix, algas, superaquecimento, bateria baixa e as quatro flags de
falha de sensor) cabem em **um** byte de `flags` — cada bit economiza airtime.
