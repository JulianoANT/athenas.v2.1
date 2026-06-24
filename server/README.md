# Servidor (relay de telemetria)

Diretório reservado para o servidor que recebe a telemetria do barco e a
retransmite aos clientes conectados.

> **Diretriz Athenas v2.0:** o papel de **servidor relay não é mais um serviço à
> parte**. Em produção ele é cumprido pelo **WebSocket servido diretamente pelo
> ESP32** a bordo (WiFi STA — ver [`firmware/onboard`](../firmware/onboard)). Em
> desenvolvimento e demonstração, o relay é o **mock-server** Node.

Para subir um relay localmente, use o **mock-server**, que emite o contrato de
telemetria a 5 Hz e permite rodar o dashboard sem o ESP32:

➡️ [`mock-server/`](../mock-server) — `ws://localhost:8080`

Este diretório fica como reserva caso seja necessário um relay autônomo no
futuro (ex.: agregar múltiplas embarcações ou persistir sessões).
