# Firmware — Receptor LoRa (LEGADO / futuro)

Receptor ESP LoRa separado, destinado a um **link de longo alcance** (long-range)
entre a embarcação e a estação de terra.

> **Diretriz Athenas v2.0:** este receptor **não está no caminho ativo**. Na v2.0
> o ESP32 a bordo opera em **WiFi STA** e **serve o WebSocket diretamente** ao
> dashboard (ver [`firmware/onboard`](../onboard)). O receptor LoRa fica como
> **legado/futuro**, para cenários em que o WiFi não alcança o barco.

Sem uso em produção atualmente. Manter como referência para evolução futura do
enlace de rádio.
