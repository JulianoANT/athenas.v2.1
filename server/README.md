# Servidor (relay de telemetria)

Diretório reservado para um eventual servidor que receba a telemetria do barco e
a retransmita aos clientes conectados.

> **Athenas v2.1:** o papel de **servidor relay não é um serviço à parte**. Ele é
> cumprido pelo **WebSocket servido diretamente pelo ESP32** a bordo (WiFi STA —
> ver [`firmware/onboard`](../firmware/onboard)), em `ws://<ip-do-esp32>/ws`.
>
> O **mock-server foi removido** nesta versão. O Athenas OS v2.1 não possui modo
> de simulação: todo valor exibido no painel vem diretamente do hardware. Se
> precisar dele para algum teste de bancada, ele continua no histórico do git
> (`git log -- mock-server/`).

Este diretório fica como reserva caso um relay autônomo se torne necessário no
futuro — por exemplo para agregar múltiplas embarcações, persistir sessões em
banco, ou fazer a ponte TLS (`wss://`) que permitiria servir o painel por HTTPS
sem esbarrar na regra de *mixed content* dos navegadores.
