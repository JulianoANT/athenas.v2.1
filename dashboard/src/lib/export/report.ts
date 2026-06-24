// Relatório técnico em PDF (client-side) da Equipe Athenas.
// Usa jsPDF + jspdf-autotable. Inclui marca d'água "ATHENAS" em TODAS as
// páginas (opacidade 10%) via saveGraphicsState/setGState/restoreGraphicsState.

import { jsPDF, GState } from "jspdf";
import autoTable from "jspdf-autotable";
import type { VesselHealth } from "@/types/telemetry";
import type { SessionMetrics } from "./metrics";
import { formatDuration } from "./metrics";
import { OVERHEAT_C } from "@/lib/telemetry/contract";

// Paleta institucional (HEX puro — seguro para o renderer do jsPDF).
const NAVY = "#0B132B";
const CYAN = "#48CAE4";
const ORANGE = "#FF9E2C";
const GRAY = "#5B6472";

const HEALTH_LABEL: Record<VesselHealth, string> = {
  serena: "SERENA (Nominal)",
  tatica: "TATICA (Alto arrasto)",
  alerta: "ALERTA (Critico)",
};

/** Conclusão automatizada sobre a saúde da embarcação a partir das métricas. */
export function buildConclusion(
  m: SessionMetrics,
  health: VesselHealth,
): string {
  if (m.samples === 0) {
    return "Sessao sem amostras registradas; nao ha dados suficientes para diagnostico.";
  }
  const parts: string[] = [];

  if (m.tempMax >= OVERHEAT_C) {
    parts.push(
      `A temperatura do estator atingiu ${m.tempMax.toFixed(1)} C, acima do limite de seguranca de ${OVERHEAT_C} C, indicando estresse termico do conjunto motriz.`,
    );
  } else {
    parts.push(
      `Temperatura maxima do estator de ${m.tempMax.toFixed(1)} C, dentro da faixa segura (< ${OVERHEAT_C} C).`,
    );
  }

  parts.push(
    `Corrente de pico do ESC Hobbywing 1060 de ${m.peakCurrent.toFixed(1)} A (media ${m.avgCurrent.toFixed(1)} A).`,
  );

  if (m.distance_m > 0) {
    parts.push(
      `A embarcacao percorreu ${m.distance_m.toFixed(0)} m com Consumo Especifico de Energia de ${m.sec_wh_per_m.toFixed(2)} Wh/m, consumindo ${m.energy_wh.toFixed(1)} Wh no total.`,
    );
  } else {
    parts.push(
      "Nao houve deslocamento valido (sem fix de GPS continuo); SEC nao calculado.",
    );
  }

  switch (health) {
    case "serena":
      parts.push(
        "Diagnostico final: sistema eletrico e termico nominais. Embarcacao apta para operacao.",
      );
      break;
    case "tatica":
      parts.push(
        "Diagnostico final: regime de alto arrasto detectado (leme ou corrente elevados). Recomenda-se revisao do plano de navegacao para otimizar eficiencia.",
      );
      break;
    case "alerta":
      parts.push(
        "Diagnostico final: condicao critica registrada (sobrecarga, superaquecimento ou bateria baixa). Inspecao tecnica obrigatoria antes da proxima operacao.",
      );
      break;
  }

  return parts.join(" ");
}

/** Desenha a marca d'água "ATHENAS" rotacionada e com 10% de opacidade. */
function drawWatermark(doc: jsPDF): void {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.1 }));
  doc.setTextColor(CYAN);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(72);
  // Texto centralizado, rotacionado 45° no centro da página.
  doc.text("ATHENAS", w / 2, h / 2, {
    align: "center",
    baseline: "middle",
    angle: 45,
  });
  // Seta/silhueta da proa apontando para frente, abaixo do texto.
  doc.setDrawColor(CYAN);
  doc.setLineWidth(2);
  const cx = w / 2;
  const cy = h / 2 + 38;
  doc.lines(
    [
      [40, 12],
      [-40, 12],
    ],
    cx,
    cy - 24,
    [1, 1],
    "S",
    false,
  );
  doc.restoreGraphicsState();
}

/** Aplica a marca d'água em todas as páginas já existentes do documento. */
function stampAllPages(doc: jsPDF): void {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    drawWatermark(doc);
  }
}

interface AutoTableResult {
  finalY: number;
}

/** Lê o finalY do último autoTable de forma tipada (augmentação v3). */
function lastFinalY(doc: jsPDF, fallback: number): number {
  const t = (doc as unknown as { lastAutoTable?: AutoTableResult })
    .lastAutoTable;
  return t && typeof t.finalY === "number" ? t.finalY : fallback;
}

/**
 * Gera e baixa o relatório técnico em PDF.
 * @param m métricas calculadas da sessão
 * @param health estado de saúde da embarcação (Sereia)
 * @param sessionStart epoch ms do início da sessão
 */
export function exportReport(
  m: SessionMetrics,
  health: VesselHealth,
  sessionStart: number,
  filename = "athenas-relatorio.pdf",
): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const margin = 48;

  // --- Cabeçalho ---
  doc.setFillColor(NAVY);
  doc.rect(0, 0, w, 84, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("EQUIPE ATHENAS — RELATORIO TECNICO", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(CYAN);
  doc.text("Athenas OS v2.0 · Telemetria de Embarcacao Autonoma", margin, 62);

  const generatedAt = new Date();
  doc.setTextColor("#FFFFFF");
  doc.setFontSize(8);
  doc.text(
    `Inicio da sessao: ${new Date(sessionStart).toLocaleString("pt-BR")}`,
    margin,
    76,
  );
  doc.text(
    `Emitido em: ${generatedAt.toLocaleString("pt-BR")}`,
    w - margin,
    76,
    { align: "right" },
  );

  // --- Seção: Saúde da embarcação ---
  let y = 110;
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Estado da Embarcacao (Sereia Athenas)", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(health === "alerta" ? ORANGE : NAVY);
  doc.text(HEALTH_LABEL[health], margin, y + 18);
  y += 40;

  // --- Tabela de métricas ---
  autoTable(doc, {
    startY: y,
    head: [["Metrica", "Valor"]],
    body: [
      ["Velocidade Maxima", `${m.maxKnots.toFixed(2)} nos (${m.maxKmh.toFixed(1)} km/h)`],
      ["Corrente de Pico (ESC Hobbywing 1060)", `${m.peakCurrent.toFixed(2)} A`],
      ["Corrente Media", `${m.avgCurrent.toFixed(2)} A`],
      ["Energia Consumida", `${m.energy_wh.toFixed(2)} Wh`],
      ["Consumo Especifico (SEC)", `${m.sec_wh_per_m.toFixed(3)} Wh/m`],
      ["Temperatura Maxima do Estator", `${m.tempMax.toFixed(1)} C`],
      ["Distancia Percorrida", `${m.distance_m.toFixed(1)} m`],
      ["Duracao da Sessao", `${formatDuration(m.duration_s)} (${m.duration_s.toFixed(0)} s)`],
      ["Amostras (1 Hz)", `${m.samples}`],
    ],
    theme: "striped",
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: NAVY, textColor: "#FFFFFF", fontStyle: "bold" },
    alternateRowStyles: { fillColor: "#EAF6FB" },
    margin: { left: margin, right: margin },
  });

  // --- Conclusão automatizada ---
  y = lastFinalY(doc, y) + 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(NAVY);
  doc.text("Conclusao Tecnica", margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(GRAY);
  const conclusion = buildConclusion(m, health);
  const lines = doc.splitTextToSize(conclusion, w - margin * 2);
  doc.text(lines, margin, y);

  // --- Marca d'água em todas as páginas ---
  stampAllPages(doc);

  doc.save(filename);
}
