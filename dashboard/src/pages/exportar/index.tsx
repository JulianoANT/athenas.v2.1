// =============================================================================
//  ABA 4 — Athenas Log (exportacao)
//
//  Geracao de relatorios e planilhas 100% client-side (sem nenhuma chamada de
//  rede) a partir do log da sessao decimado a 1 Hz.
// =============================================================================

import * as React from "react";
import html2canvas from "html2canvas";
import {
  IconFileSpreadsheet,
  IconFileTypeCsv,
  IconFileTypePdf,
  IconPhoto,
  IconDatabaseOff,
  IconDownload,
  IconTrash,
} from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MetricCard } from "@/components/metric-card";
import { AlertBanner } from "@/components/alert-banner";
import { SereiaAvatar } from "@/components/sereia";
import { HEALTH_LABEL, HEALTH_DESC } from "@/lib/health";
import { ATHENAS_LOGO, ATHENAS_LOGO_ALT } from "@/assets/logo";
import { useTelemetryStore } from "@/lib/telemetry/store";
import { sessionLog } from "@/lib/telemetry/history";
import {
  computeSessionMetrics,
  formatDuration,
  type SessionMetrics,
} from "@/lib/export/metrics";
import { exportCsv, exportXlsx } from "@/lib/export/spreadsheet";
import { exportReport, buildConclusion } from "@/lib/export/report";

// Paleta HEX pura para captura via html2canvas (v1 nao suporta oklch/color-mix).
const HEX = {
  navy: "#0B132B",
  cyan: "#48CAE4",
  white: "#ffffff",
  orange: "#ff9e2c",
} as const;

function tstamp(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export default function Exportar() {
  const distance_m = useTelemetryStore((s) => s.distance_m);
  const sessionStart = useTelemetryStore((s) => s.sessionStart);
  const health = useTelemetryStore((s) => s.health);
  const resetSession = useTelemetryStore((s) => s.resetSession);

  // O log vive fora do React (buffer circular). `sessionVersion` sobe uma vez
  // por segundo, quando o log recebe uma amostra — nao 5x por segundo.
  const sessionVersion = useTelemetryStore((s) => s.sessionVersion);

  const { samples, virtualTemps } = React.useMemo(
    () => ({
      samples: sessionLog.samples,
      virtualTemps: sessionLog.virtualTemps,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionVersion],
  );

  const metrics = React.useMemo<SessionMetrics>(
    () => computeSessionMetrics(samples, virtualTemps),
    [samples, virtualTemps],
  );

  // Prefere a distancia ao vivo (estacao->barco) quando maior que a distancia
  // percorrida integrada do log.
  const reportMetrics = React.useMemo<SessionMetrics>(() => {
    if (distance_m != null && distance_m > metrics.distance_m) {
      return {
        ...metrics,
        distance_m,
        sec_wh_per_m: distance_m > 0 ? metrics.energy_wh / distance_m : 0,
      };
    }
    return metrics;
  }, [metrics, distance_m]);

  const empty = samples.length === 0;
  const pngRef = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const onXlsx = () =>
    exportXlsx(samples, `athenas-${tstamp()}.xlsx`, virtualTemps);
  const onCsv = () =>
    exportCsv(samples, `athenas-${tstamp()}.csv`, virtualTemps);
  const onPdf = () =>
    exportReport(reportMetrics, health, sessionStart, `athenas-${tstamp()}.pdf`);

  const onPng = async () => {
    if (!pngRef.current) return;
    setBusy("png");
    try {
      const canvas = await html2canvas(pngRef.current, {
        backgroundColor: HEX.navy,
        scale: 2,
        logging: false,
        useCORS: true,
      });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `athenas-${tstamp()}.png`;
      a.click();
    } finally {
      setBusy(null);
    }
  };

  const onReset = () => {
    if (
      window.confirm(
        "Zerar a sessao? Todo o historico e o log acumulado serao descartados. Esta acao nao pode ser desfeita — exporte antes se precisar dos dados.",
      )
    ) {
      resetSession();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconDownload className="size-4 text-[var(--cyan)]" />
            Athenas Log — Exportacao
          </CardTitle>
          <CardDescription>
            Relatorios e planilhas gerados 100% no navegador, sem nenhuma
            chamada de rede.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={empty ? "muted" : "ok"}>
              {samples.length} amostras
            </Badge>
            <Badge variant="outline">
              Inicio: {new Date(sessionStart).toLocaleString("pt-BR")}
            </Badge>
            <Badge variant="outline">
              Duracao: {formatDuration(metrics.duration_s)}
            </Badge>
            {metrics.faultySamples > 0 && (
              <Badge variant="warn">
                {metrics.faultySamples} com sensor em falha
              </Badge>
            )}
          </div>

          {empty && (
            <AlertBanner
              variant="warn"
              icon={<IconDatabaseOff className="size-5" />}
              title="Sessao sem amostras"
              message="O log so acumula com o ESP32 transmitindo. Verifique o estado da conexao no topo do painel."
            />
          )}

          {/* Botoes em grid no celular (alvos de toque grandes), em linha no
              desktop. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button size="lg" className="h-11" onClick={onXlsx} disabled={empty}>
              <IconFileSpreadsheet />
              Planilha (.xlsx)
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11"
              onClick={onCsv}
              disabled={empty}
            >
              <IconFileTypeCsv />
              CSV
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11"
              onClick={onPdf}
              disabled={empty}
            >
              <IconFileTypePdf />
              Relatorio (PDF)
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11"
              onClick={onPng}
              disabled={empty || busy === "png"}
            >
              <IconPhoto />
              {busy === "png" ? "Gerando…" : "PNG"}
            </Button>
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Zerar a sessao reinicia o cronometro, o historico dos graficos, a
              trilha do mapa e o gemeo termico.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={onReset}
              className="h-9"
            >
              <IconTrash className="size-4" />
              Zerar sessao
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Previa das metricas */}
      <Card>
        <CardHeader>
          <CardTitle>Previa das Metricas</CardTitle>
          <CardDescription>
            Calculadas a partir de {samples.length} amostras da sessao corrente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <MetricCard
              label="Velocidade Max"
              value={metrics.maxKnots.toFixed(2)}
              unit="nos"
              valueColor="var(--cyan)"
              hint={`${metrics.maxKmh.toFixed(1)} km/h`}
            />
            <MetricCard
              label="Corrente de Pico"
              value={metrics.peakCurrent.toFixed(1)}
              unit="A"
              valueColor="var(--warn)"
              hint={`media ${metrics.avgCurrent.toFixed(1)} A`}
            />
            <MetricCard
              label="Temp. Max (sensor)"
              value={metrics.tempMax.toFixed(1)}
              unit="°C"
              valueColor="var(--alert)"
            />
            <MetricCard
              label="Temp. Max (virtual)"
              value={metrics.virtualTempMax.toFixed(1)}
              unit="°C"
              valueColor="#ff9e2c"
              hint="gemeo digital"
            />
            <MetricCard
              label="Distancia"
              value={reportMetrics.distance_m.toFixed(0)}
              unit="m"
            />
            <MetricCard
              label="Energia"
              value={metrics.energy_wh.toFixed(1)}
              unit="Wh"
            />
            <MetricCard
              label="SEC"
              value={reportMetrics.sec_wh_per_m.toFixed(3)}
              unit="Wh/m"
              valueColor="var(--chart-1)"
            />
            <MetricCard
              label="Adernamento Max"
              value={metrics.maxRoll.toFixed(1)}
              unit="°"
              hint={`caturro ${metrics.maxPitch.toFixed(1)}°`}
            />
            <MetricCard
              label="Estabilidade"
              value={metrics.stabilityScore.toFixed(0)}
              unit="/100"
              valueColor={
                metrics.stabilityScore < 60 ? "var(--warn)" : "var(--ok)"
              }
            />
            <MetricCard
              label="Duracao"
              value={formatDuration(metrics.duration_s)}
            />
          </div>

          <Separator />

          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <SereiaAvatar health={health} size={64} showLabel />
            <div className="min-w-0 text-sm text-muted-foreground">
              <div className="mb-1 font-tech uppercase tracking-wide text-foreground">
                Diagnostico — {HEALTH_LABEL[health]}
              </div>
              {buildConclusion(reportMetrics, health)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Elemento DEDICADO offscreen para o PNG — SOMENTE cores HEX inline.
          O html2canvas v1 nao entende oklch()/color-mix(), entao esse painel
          duplica o conteudo com uma paleta literal em vez de reaproveitar os
          componentes da tela. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -10000,
          top: 0,
          pointerEvents: "none",
        }}
      >
        <div
          ref={pngRef}
          style={{
            width: 760,
            padding: 32,
            background: HEX.navy,
            color: HEX.white,
            fontFamily: "Arial, Helvetica, sans-serif",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              borderBottom: `2px solid ${HEX.cyan}`,
              paddingBottom: 12,
              marginBottom: 20,
            }}
          >
            <img
              src={ATHENAS_LOGO}
              alt={ATHENAS_LOGO_ALT}
              style={{ width: 56, height: 56, objectFit: "contain" }}
              crossOrigin="anonymous"
            />
            <div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: HEX.white,
                  letterSpacing: 1,
                }}
              >
                ATHENAS - CENTRAL DE TELEMETRIA
              </div>
              <div style={{ fontSize: 12, color: HEX.cyan, marginTop: 4 }}>
                Relatorio Tecnico · Equipe Athenas ·{" "}
                {new Date(sessionStart).toLocaleString("pt-BR")}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {(
              [
                ["Velocidade Max", `${metrics.maxKnots.toFixed(2)} nos`],
                ["Corrente Pico", `${metrics.peakCurrent.toFixed(1)} A`],
                ["Temp. Max Sensor", `${metrics.tempMax.toFixed(1)} C`],
                ["Temp. Max Virtual", `${metrics.virtualTempMax.toFixed(1)} C`],
                ["Distancia", `${reportMetrics.distance_m.toFixed(0)} m`],
                ["Energia", `${metrics.energy_wh.toFixed(1)} Wh`],
                ["SEC", `${reportMetrics.sec_wh_per_m.toFixed(3)} Wh/m`],
                ["Adernamento Max", `${metrics.maxRoll.toFixed(1)} graus`],
                ["Estabilidade", `${metrics.stabilityScore.toFixed(0)}/100`],
                ["Duracao", formatDuration(metrics.duration_s)],
                ["Amostras", `${metrics.samples}`],
                ["Sensores em falha", `${metrics.faultySamples}`],
              ] as const
            ).map(([k, v]) => (
              <div
                key={k}
                style={{
                  width: 168,
                  border: `1px solid ${HEX.cyan}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: HEX.navy,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: HEX.cyan,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{ fontSize: 19, fontWeight: 700, color: HEX.white }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 22,
              padding: 14,
              border: `1px solid ${HEX.orange}`,
              borderRadius: 8,
              background: HEX.navy,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: HEX.orange,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Diagnostico — {HEALTH_LABEL[health]} ({HEALTH_DESC[health]})
            </div>
            <div style={{ fontSize: 12, color: HEX.white, lineHeight: 1.5 }}>
              {buildConclusion(reportMetrics, health)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
