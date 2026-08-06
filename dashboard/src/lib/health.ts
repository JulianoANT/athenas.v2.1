// =============================================================================
//  Rótulos e cores dos estados de saúde da embarcação (Sereia Athenas).
//
//  Ficam num módulo só de dados, separados do componente, por dois motivos:
//
//   1. o Fast Refresh do Vite só funciona em arquivos que exportam APENAS
//      componentes — misturar constantes ali forçava recarga total da página a
//      cada edição;
//   2. o gerador de PDF (`lib/export/report.ts`) precisa dos rótulos e roda
//      fora do React. Importar um módulo de componente para pegar uma string
//      arrastaria a árvore de UI para dentro do relatório sem necessidade.
// =============================================================================

import type { VesselHealth } from "@/types/telemetry";

export const HEALTH_COLOR_VAR: Record<VesselHealth, string> = {
  serena: "var(--ok)",
  tatica: "var(--warn)",
  alerta: "var(--alert)",
};

export const HEALTH_LABEL: Record<VesselHealth, string> = {
  serena: "Serena",
  tatica: "Tática",
  alerta: "Alerta",
};

export const HEALTH_DESC: Record<VesselHealth, string> = {
  serena: "Sistema nominal estável",
  tatica: "Alto arrasto detectado",
  alerta: "Sobrecarga crítica",
};
