## Dashboard
#### Visão geral consolidada do sistema, focada em operação em tempo real.

### Monitoramento em tempo real de:
Temperatura do motor (com indicação de faixa segura/alerta/crítica)
Nível da bateria (percentual + tensão)
Velocidade atual
Status da conexão (ex: LoRa ativo/inativo)

### Gráficos:
Histórico de velocidade (GPS)
Temperatura ao longo do tempo
Consumo de bateria (queda ao longo da sessão)

### Indicadores rápidos (KPIs):
Velocidade máxima da sessão
Temperatura máxima registrada
Autonomia estimada restante
Tempo de sessão

### Alertas visuais:
Destaque imediato para:
superaquecimento
bateria crítica
perda de sinal
---

## Monitoramento da Temperatura do Motor

#### Tela dedicada à análise térmica.

### Exibição:
Temperatura atual em destaque
Indicador visual de faixa (normal / alerta / crítica)

### Gráficos:
Histórico de temperatura
Correlação com velocidade (opcional, mas muito útil) ou outros dados

### Eventos:
Registro de picos de temperatura
Alertas com timestamp

### Recursos adicionais:
Notificações automáticas
Identificação de padrões (ex: aquecimento rápido sob carga)
---

## Monitoramento da Localização via GPS
#### Foco em navegação e análise de trajeto.

### Mapa em tempo real:
Posição atual da embarcação
Direção e velocidade

### Histórico de trajeto:
Linha do percurso realizado
Diferenciação por velocidade (ex: cor)

### Replay de sessão:
Reproduzir trajeto após execução
Navegação por timeline

### Dados adicionais:
Velocidade instantânea, média e máxima
Distância percorrida

### Extras:
Marcação de pontos relevantes (ex: curvas, perda de desempenho)
---

## Monitoramento do Nível da Bateria
#### Análise energética e autonomia.

### Exibição:
Percentual de carga
Tensão atual
Corr1ente (se disponível)

### Gráficos:
Curva de descarga ao longo do tempo
Consumo em relação à velocidade

### Estimativas:
Autonomia restante (tempo estimado)
Consumo médio

### Alertas:
Bateria baixa
Queda abrupta de tensão

### Recursos adicionais:
Configuração de limites críticos
Histórico de uso por sessão
---

## Monitoramento da Unidade de Medição Inercial (IMU)
#### Foco em estabilidade e comportamento dinâmico.

### Dados em tempo real:
Aceleração (eixos X, Y, Z)
Inclinação (pitch, roll)
Rotação (giroscópio)

### Visualizações:
Gráficos por eixo
Indicador de inclinação do barco

### Eventos:
Detecção de instabilidade
Possível capotamento
Vibração excessiva

### Análise:
Correlação com velocidade
Identificação de trechos críticos

### Extras:
Score de estabilidade da sessão
Detecção de padrões anormais
---

## Autenticação e Autorização
#### Controle de acesso ao sistema.

### Autenticação:
Login com e-mail/senha
(Opcional) autenticação via token/API para integração com dispositivos

### Autorização:
Perfis de usuário:
Administrador (acesso total)
Membro (monitoramento e controle)
Visualização (somente leitura)

### Segurança:
Proteção de rotas
Expiração de sessão
Registro de acessos