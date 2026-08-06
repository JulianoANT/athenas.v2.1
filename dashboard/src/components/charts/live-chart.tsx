// =============================================================================
//  LiveChart — series temporais criticas em CANVAS (uPlot)
//
//  POR QUE NAO RECHARTS AQUI:
//  Recharts (e Chart.js em modo SVG) cria um NO DO DOM POR PONTO. A 5 Hz, uma
//  prova de 30 minutos gera 9.000 pontos por serie. Com quatro series o
//  navegador tenta manter ~36.000 elementos SVG vivos e o layout engasga muito
//  antes disso — o barco fica na agua e o painel congela.
//
//  O uPlot desenha tudo em um unico <canvas>: o custo e proporcional aos
//  pixels, nao aos pontos. 100.000 amostras cabem no mesmo orcamento de quadro.
//
//  ZERO RE-RENDER: o componente monta o grafico UMA vez e depois se inscreve
//  no store fora do ciclo do React. Cada quadro novo vira uma chamada
//  `setData()` imperativa — o React nem fica sabendo que houve dado.
//
//  Recharts continua sendo usado nas visualizacoes de baixa cadencia, onde a
//  ergonomia declarativa compensa e o volume de pontos e irrelevante.
// =============================================================================

import * as React from "react";
import uPlot from "uplot";

import { useTelemetryStore } from "@/lib/telemetry/store";
import { history, SERIES, type SeriesName } from "@/lib/telemetry/history";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface ChartSeries {
  /** Coluna do buffer historico a plotar. */
  key: SeriesName;
  label: string;
  /** Cor CSS. Variaveis `var(--x)` sao resolvidas para o canvas. */
  color: string;
  unit?: string;
  /** Eixo Y. Series em unidades diferentes devem usar eixos diferentes. */
  axis?: "left" | "right";
  /** Faixa fixa do eixo; omita para escala automatica. */
  range?: [number, number];
  /** Espessura do traco. */
  width?: number;
  /** Traco pontilhado (usado para grandezas previstas, nao medidas). */
  dash?: number[];
}

export interface LiveChartProps {
  series: ChartSeries[];
  height?: number;
  /** Quantas amostras manter na janela visivel (padrao 900 = 3 min a 5 Hz). */
  windowPoints?: number;
  className?: string;
}

/**
 * Resolve `var(--cyan)` para o valor computado. Obrigatorio: o Canvas 2D nao
 * entende custom properties do CSS, so cores literais.
 */
function resolveColor(color: string): string {
  if (!color.startsWith("var(")) return color;
  const name = color.slice(4, -1).trim();
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || "#48CAE4";
}

/** Aplica transparencia a uma cor hex de 6 digitos (para o preenchimento). */
function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

const COLUMN_INDEX: Record<SeriesName, number> = SERIES.reduce(
  (acc, name, i) => {
    acc[name] = i;
    return acc;
  },
  {} as Record<SeriesName, number>,
);

export function LiveChart({
  series,
  height = 220,
  windowPoints = 900,
  className,
}: LiveChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<uPlot | null>(null);
  const { theme } = useTheme();

  // Uma "assinatura" das series: o grafico so e reconstruido quando a
  // CONFIGURACAO muda de verdade, nao a cada render do componente pai.
  const signature = React.useMemo(
    () => JSON.stringify(series) + `|${theme}|${height}`,
    [series, theme, height],
  );

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const axisColor = resolveColor("var(--muted-foreground)");
    const gridColor = resolveColor("var(--border)");
    const hasRight = series.some((s) => s.axis === "right");

    const uSeries: uPlot.Series[] = [
      // Serie 0 e sempre o eixo X.
      {
        value: (_u, ts) =>
          ts == null
            ? "--"
            : new Date(ts * 1000).toLocaleTimeString("pt-BR", {
                minute: "2-digit",
                second: "2-digit",
              }),
      },
      ...series.map<uPlot.Series>((s) => {
        const stroke = resolveColor(s.color);
        return {
          label: s.label,
          stroke,
          width: s.width ?? 1.8,
          scale: s.axis === "right" ? "y2" : "y",
          dash: s.dash,
          // `points.show: false` e essencial: desenhar um circulo por amostra
          // anularia boa parte da vantagem do canvas.
          points: { show: false },
          // NaN vira lacuna em vez de linha reta ate o zero (importante para o
          // consumo especifico, indefinido com o barco parado).
          spanGaps: false,
          value: (_u, v) =>
            v == null || Number.isNaN(v)
              ? "--"
              : `${v.toFixed(1)}${s.unit ? " " + s.unit : ""}`,
          fill:
            series.length === 1 ? withAlpha(stroke, 0.14) : undefined,
        };
      }),
    ];

    const axes: uPlot.Axis[] = [
      {
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor },
        font: "10px ui-monospace, monospace",
      },
      {
        scale: "y",
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor },
        font: "10px ui-monospace, monospace",
        size: 44,
      },
    ];

    if (hasRight) {
      axes.push({
        scale: "y2",
        side: 1,
        stroke: axisColor,
        grid: { show: false },
        ticks: { stroke: gridColor },
        font: "10px ui-monospace, monospace",
        size: 44,
      });
    }

    const leftRange = series.find((s) => s.axis !== "right")?.range;
    const rightRange = series.find((s) => s.axis === "right")?.range;

    const opts: uPlot.Options = {
      width: container.clientWidth || 600,
      height,
      // `pxAlign: 0` deixa o traco continuo em telas HiDPI de tablet.
      pxAlign: 0,
      cursor: {
        // Sem arrasto de zoom: em campo, com luva molhada, isso so atrapalha.
        drag: { x: false, y: false },
        points: { size: 6 },
      },
      legend: { live: true },
      scales: {
        x: { time: true },
        y: leftRange
          ? { range: leftRange }
          : { auto: true },
        ...(hasRight
          ? { y2: rightRange ? { range: rightRange } : { auto: true } }
          : {}),
      },
      axes,
      series: uSeries,
    };

    const plot = new uPlot(opts, [[]] as unknown as uPlot.AlignedData, container);
    plotRef.current = plot;

    // --- Alimentacao imperativa: nenhuma re-renderizacao do React ---
    const indices = series.map((s) => COLUMN_INDEX[s.key]);

    const draw = () => {
      const cols = history.read(windowPoints);
      if (cols[0].length === 0) return;
      const data = [cols[0], ...indices.map((i) => cols[i])];
      plot.setData(data as unknown as uPlot.AlignedData, true);
    };

    draw();
    const unsubscribe = useTelemetryStore.subscribe(
      (s) => s.historyVersion,
      draw,
    );

    // --- Responsividade: o uPlot precisa ser redimensionado explicitamente ---
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) plot.setSize({ width, height });
    });
    observer.observe(container);

    return () => {
      unsubscribe();
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // `signature` cobre series/theme/height; as demais deps sao estaveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, windowPoints]);

  return (
    <div
      ref={containerRef}
      className={cn("w-full overflow-hidden", className)}
      style={{ height }}
    />
  );
}
