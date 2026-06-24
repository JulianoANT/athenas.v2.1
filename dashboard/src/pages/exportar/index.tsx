import * as React from "react";
import html2canvas from "html2canvas";
import {
  IconFileSpreadsheet,
  IconFileTypeCsv,
  IconFileTypePdf,
  IconPhoto,
  IconDatabaseOff,
  IconDownload,
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
import { SereiaAvatar, HEALTH_LABEL, HEALTH_DESC } from "@/components/sereia";
import { useTelemetry } from "@/lib/telemetry/provider";
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
  const { sessionLog, distance_m, sessionStart, health } = useTelemetry();

  const metrics = React.useMemo<SessionMetrics>(
    () => computeSessionMetrics(sessionLog),
    [sessionLog],
  );

  // Prefere a distancia ao vivo (estacao->barco) quando maior que a
  // distancia percorrida integrada do log.
  const reportMetrics = React.useMemo<SessionMetrics>(() => {
    if (distance_m != null && distance_m > metrics.distance_m) {
      const d = distance_m;
      return {
        ...metrics,
        distance_m: d,
        sec_wh_per_m: d > 0 ? metrics.energy_wh / d : 0,
      };
    }
    return metrics;
  }, [metrics, distance_m]);

  const empty = sessionLog.length === 0;
  const pngRef = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const onXlsx = () => exportXlsx(sessionLog, `athenas-${tstamp()}.xlsx`);
  const onCsv = () => exportCsv(sessionLog, `athenas-${tstamp()}.csv`);
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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconDownload className="size-4 text-[var(--cyan)]" />
            Athenas Log — Exportacao
          </CardTitle>
          <CardDescription>
            Geracao de relatorios e planilhas 100% client-side (sem rede) a
            partir do log da sessao decimado a 1 Hz.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={empty ? "muted" : "ok"}>
              {sessionLog.length} amostras
            </Badge>
            <Badge variant="outline">
              Inicio: {new Date(sessionStart).toLocaleString("pt-BR")}
            </Badge>
            <Badge variant="outline">
              Duracao: {formatDuration(metrics.duration_s)}
            </Badge>
          </div>

          {empty && (
            <AlertBanner
              variant="warn"
              icon={<IconDatabaseOff className="size-5" />}
              title="Sessao sem amostras"
              message="Aguarde a telemetria acumular dados (1 Hz) antes de exportar. Verifique se o modo de dados esta ativo no Passadico."
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={onXlsx} disabled={empty}>
              <IconFileSpreadsheet />
              Planilha (.xlsx)
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onCsv}
              disabled={empty}
            >
              <IconFileTypeCsv />
              CSV
            </Button>
            <Button size="lg" variant="outline" onClick={onPdf} disabled={empty}>
              <IconFileTypePdf />
              Relatorio (PDF)
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onPng}
              disabled={empty || busy === "png"}
            >
              <IconPhoto />
              {busy === "png" ? "Gerando PNG…" : "PNG"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Previa das metricas */}
      <Card>
        <CardHeader>
          <CardTitle>Previa das Metricas</CardTitle>
          <CardDescription>
            Calculadas a partir de {sessionLog.length} amostras da sessao
            corrente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
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
              hint="ESC Hobbywing 1060"
            />
            <MetricCard
              label="Corrente Media"
              value={metrics.avgCurrent.toFixed(1)}
              unit="A"
            />
            <MetricCard
              label="Temp. Max"
              value={metrics.tempMax.toFixed(1)}
              unit="°C"
              valueColor="var(--alert)"
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
              label="Duracao"
              value={formatDuration(metrics.duration_s)}
            />
          </div>

          <Separator />

          <div className="flex items-start gap-4">
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

      {/* Elemento DEDICADO offscreen para o PNG — SOMENTE cores HEX inline. */}
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
            width: 720,
            padding: 32,
            background: HEX.navy,
            color: HEX.white,
            fontFamily: "Arial, Helvetica, sans-serif",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              borderBottom: `2px solid ${HEX.cyan}`,
              paddingBottom: 12,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: HEX.white,
                letterSpacing: 1,
              }}
            >
              EQUIPE ATHENAS — RELATORIO TECNICO
            </div>
            <div style={{ fontSize: 12, color: HEX.cyan, marginTop: 4 }}>
              Athenas OS v2.0 · {new Date(sessionStart).toLocaleString("pt-BR")}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {(
              [
                ["Velocidade Max", `${metrics.maxKnots.toFixed(2)} nos`],
                ["Corrente Pico", `${metrics.peakCurrent.toFixed(1)} A`],
                ["Temp. Max", `${metrics.tempMax.toFixed(1)} C`],
                ["Distancia", `${reportMetrics.distance_m.toFixed(0)} m`],
                ["Energia", `${metrics.energy_wh.toFixed(1)} Wh`],
                ["SEC", `${reportMetrics.sec_wh_per_m.toFixed(3)} Wh/m`],
                ["Duracao", formatDuration(metrics.duration_s)],
                ["Amostras", `${metrics.samples}`],
              ] as const
            ).map(([k, v]) => (
              <div
                key={k}
                style={{
                  width: 150,
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
                  style={{ fontSize: 20, fontWeight: 700, color: HEX.white }}
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
