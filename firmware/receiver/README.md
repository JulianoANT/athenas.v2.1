# Firmware — MESTRE (estação de terra)

**Placa:** Heltec WiFi LoRa 32 (V3) — ESP32-S3 + SX1262 + OLED

Recebe os pacotes binários do barco por LoRa 915 MHz, valida o CRC, remonta o
**contrato JSON v2.1** e serve aos clientes por WebSocket.

> Visão geral do enlace, tabela de alcance × taxa, mapa de pinos e roteiro de
> teste no [README do firmware](../README.md).

---

## O que este firmware faz

1. **Escuta** em 915 MHz, SF7/BW125, com recepção assíncrona por interrupção.
2. **Valida** cada pacote: magic, versão e CRC16-CCITT. Pacote suspeito é
   descartado e contabilizado, nunca publicado.
3. **Remonta** o JSON do contrato v2.1 com `snprintf` num buffer global — sem
   `String`, sem alocação dinâmica, sem fragmentar heap durante a prova.
4. **Publica** em `ws://192.168.4.1/ws` e espelha na USB serial.
5. **Mostra** RSSI, SNR e percentual de perda no OLED — é assim que a equipe
   aponta a antena em campo.

---

## Rede criada pelo mestre

| | |
|---|---|
| SSID | `Athenas-Base` |
| Senha | `athenas2026` |
| IP | `192.168.4.1` |
| WebSocket | `ws://192.168.4.1/ws` |
| Diagnóstico | `http://192.168.4.1/health` |

O mestre cria o **próprio Access Point**. Isso elimina toda a infraestrutura:
não depende de roteador, não depende da rede do evento e não precisa de cabo
USB. Conecte o notebook nessa rede e o dashboard acha o receptor sozinho.

Para trocar SSID/senha, edite o topo de [`src/main.cpp`](src/main.cpp):

```cpp
static const char* AP_SSID     = "Athenas-Base";
static const char* AP_PASSWORD = "athenas2026";  // mínimo 8 caracteres (WPA2)
```

---

## Gravar

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

---

## O OLED em campo

```
ATHENAS MESTRE
────────────────
RSSI -78 dBm
SNR  9.5 dB
RX 1420  perda 0.7%
WS 1  192.168.4.1
```

| Linha | Significado |
|---|---|
| `RSSI` | Potência recebida. Acima de −100 dBm há folga; abaixo de −115 dBm a perda é iminente. |
| `SNR` | Relação sinal-ruído. Abaixo de −7 dB o SF7 deixa de demodular. |
| `RX / perda` | Pacotes recebidos e percentual perdido no ar. |
| `WS` | Clientes WebSocket conectados, e o IP do AP. |

`SEM ENLACE` aparece após 3 s sem receber nada do barco.

---

## ⚠️ Os parâmetros de rádio têm que bater com os do escravo

Frequência, spreading factor, largura de banda, coding rate e sync word
**diferentes = silêncio absoluto**, sem nenhuma mensagem de erro. É o modo de
falha mais frustrante do LoRa, e a primeira coisa a conferir se o mestre não
recebe nada.

```cpp
static const float   LORA_FREQ_MHZ = 915.0f;
static const float   LORA_BW_KHZ   = 125.0f;
static const uint8_t LORA_SF       = 7;
static const uint8_t LORA_CR       = 5;
```

Se mudar qualquer um destes, mude **nos dois firmwares** e regrave **as duas
placas**.

---

## Campos que o mestre acrescenta ao contrato

O JSON publicado é o contrato v2.1 mais um bloco `link`, que **não vem do
barco** — é medido aqui, ao demodular cada pacote:

```json
"link": { "rssi": -78, "snr": 9.5, "lost": 12, "corrupt": 0, "boat_seq": 4821 }
```

E o campo `seq` de nível superior é o **contador do próprio mestre**, não o do
barco. Os dois medem enlaces diferentes:

- `link.lost` → perdas **no ar** (LoRa): alcance, antena, obstrução.
- lacunas em `seq` → perdas entre **mestre e PC** (WiFi da margem).

Repassar o `seq` do barco faria o dashboard contar as perdas do rádio de novo, e
os dois números diriam a mesma coisa — inútil para diagnosticar de que lado está
o problema.
