// =============================================================================
//  ABA 1 — Passadico & Navegacao
//
//  O posto de comando: carta hidrografica com vetor de predicao de rota,
//  bussola vetorial com correcao de declinacao magnetica, horizonte artificial
//  3D com a atitude do casco e cronometragem de prova.
//
//  Sem gating (publico e tripulacao).
// =============================================================================

import * as React from "react";
import {
  IconCurrentLocation,
  IconMapPin,
  IconRoute,
  IconRulerMeasure,
  IconSatellite,
  IconCrosshair,
  IconPropeller,
  IconAlertTriangle,
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
import { CompassRose } from "@/components/nav/compass-rose";
import { ArtificialHorizon } from "@/components/nav/artificial-horizon-lazy";
import { AttitudeReadout } from "@/components/nav/attitude-readout";
import { useTelemetryStore } from "@/lib/telemetry/store";
import {
  useSpeedKnots,
  useFix,
  useDistance,
  useGpsFault,
} from "@/lib/telemetry/selectors";
import { KMH_PER_KNOT } from "@/lib/telemetry/contract";
import { DEFAULT_PREDICT_SECONDS } from "@/lib/math/GeoMath";
import { cn } from "@/lib/utils";
import { TacticalMap } from "./tactical-map";
import { CronometroNautico } from "./cronometro";

const PREDICT_OPTIONS = [5, 10, 15, 30, 60] as const;

function fmtCoord(v: number, axis: "lat" | "lng"): string {
  const hemi = axis === "lat" ? (v >= 0 ? "N" : "S") : v >= 0 ? "L" : "O";
  return `${Math.abs(v).toFixed(5)}° ${hemi}`;
}

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

// -----------------------------------------------------------------------------
//  Qualidade do sinal GPS. Assina apenas os primitivos de que precisa, entao
//  nao re-renderiza quando a corrente do motor muda.
// -----------------------------------------------------------------------------
function GpsQuality() {
  const fix = useFix();
  const sats = useTelemetryStore((s) => s.frame?.gps.sats ?? 0);
  const hdop = useTelemetryStore((s) => s.frame?.gps.hdop ?? 99);

  // HDOP e a diluicao horizontal de precisao: quanto MENOR, melhor a geometria
  // dos satelites. Abaixo de 2 e excelente; acima de 5 a posicao balanca.
  const quality =
    !fix ? "muted" : hdop <= 2 ? "ok" : hdop <= 5 ? "warn" : "alert";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={fix ? "ok" : "muted"}>
        <IconSatellite className="size-3" />
        {fix ? "GPS Fixado" : "Sem fix"}
      </Badge>
      <Badge variant={quality}>
        {sats} sat · HDOP {hdop >= 99 ? "--" : hdop.toFixed(1)}
      </Badge>
    </div>
  );
}

// -----------------------------------------------------------------------------
//  Selo de velocidade sobreposto ao mapa.
// -----------------------------------------------------------------------------
function SpeedBadge() {
  const knots = useSpeedKnots();
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-md bg-card/85 px-2.5 py-1.5 ring-1 ring-foreground/10 backdrop-blur sm:px-3 sm:py-2">
      <div className="flex items-baseline gap-1 font-tech">
        <span
          className="text-xl font-semibold sm:text-2xl"
          style={{ color: "var(--cyan)" }}
        >
          {knots.toFixed(1)}
        </span>
        <span className="text-[10px] text-muted-foreground sm:text-xs">kn</span>
      </div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">
        {(knots * KMH_PER_KNOT).toFixed(1)} km/h
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
//  Coordenadas e distancia ate a estacao de controle.
// -----------------------------------------------------------------------------
function StationPanel() {
  const station = useTelemetryStore((s) => s.station);
  const requestStation = useTelemetryStore((s) => s.requestStation);
  const distance_m = useDistance();
  const lat = useTelemetryStore((s) => s.lat);
  const lng = useTelemetryStore((s) => s.lng);
  const fix = useFix();

  return (
    <Card className="gap-3">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <IconRulerMeasure className="size-4" />
          Distancia da Estacao
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="font-tech text-2xl font-semibold leading-none sm:text-3xl"
          style={{
            color:
              distance_m == null
                ? "var(--muted-foreground)"
                : "var(--primary)",
          }}
        >
          {distance_m == null ? "—" : fmtDistance(distance_m)}
        </div>

        <Separator />

        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-muted-foreground">
              <IconCurrentLocation className="size-3.5" />
              Estacao
            </span>
            <span className="font-tech tabular-nums">
              {station
                ? `${fmtCoord(station.lat, "lat")}, ${fmtCoord(station.lng, "lng")}`
                : "nao definida"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-muted-foreground">
              <IconMapPin className="size-3.5" />
              Barco
            </span>
            <span
              className={cn(
                "font-tech tabular-nums",
                !fix && "text-muted-foreground",
              )}
            >
              {fix
                ? `${fmtCoord(lat, "lat")}, ${fmtCoord(lng, "lng")}`
                : "aguardando fix"}
            </span>
          </div>
        </div>

        <Button
          variant="outline"
          size="lg"
          className="h-11 w-full text-sm font-medium"
          onClick={requestStation}
        >
          <IconCurrentLocation />
          {station ? "Redefinir estacao" : "Definir estacao"}
        </Button>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Usa a geolocalizacao do navegador como ponto de controle. A distancia
          e calculada pela formula de Haversine sobre a posicao ja suavizada
          pelo Filtro de Kalman.
        </p>
      </CardContent>
    </Card>
  );
}

export default function Passadico() {
  const [predictSeconds, setPredictSeconds] = React.useState<number>(
    DEFAULT_PREDICT_SECONDS,
  );
  const [followVessel, setFollowVessel] = React.useState(true);
  const knots = useSpeedKnots();
  const gpsFault = useGpsFault();

  return (
    <div className="flex flex-col gap-4">
      {/* Cabecalho */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-base font-semibold sm:text-lg">
            Passadico &amp; Navegacao
          </h1>
          <p className="text-xs text-muted-foreground">
            Carta hidrografica ao vivo, vetor de predicao de rota e atitude do
            casco.
          </p>
        </div>
        <GpsQuality />
      </div>

      {gpsFault && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--warn)",
            background: "color-mix(in oklab, var(--warn) 10%, transparent)",
            color: "var(--warn)",
          }}
        >
          <IconAlertTriangle className="size-4 shrink-0" />
          <span>
            Sem fix de GPS valido (ou dado com mais de 1,5 s). A posicao exibida
            e a ultima conhecida — nao ha vetor de predicao.
          </span>
        </div>
      )}

      {/* Mapa + painel lateral.
          Mobile: coluna unica. Desktop (lg+): mapa flexivel + coluna fixa. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* --- Mapa tatico --- */}
        <Card className="overflow-hidden p-0">
          <div className="relative">
            <div className="h-[340px] w-full sm:h-[440px] lg:h-[560px]">
              <TacticalMap
                predictSeconds={predictSeconds}
                followVessel={followVessel}
              />
            </div>
            <SpeedBadge />
          </div>

          {/* Controles do vetor de predicao */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <IconCrosshair className="size-4" style={{ color: "#EF476F" }} />
              Predicao
            </span>
            <div className="flex flex-wrap gap-1">
              {PREDICT_OPTIONS.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={predictSeconds === s ? "default" : "outline"}
                  className="h-8 min-w-11 px-2 font-tech text-xs"
                  onClick={() => setPredictSeconds(s)}
                >
                  {s}s
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant={followVessel ? "secondary" : "outline"}
              className="ml-auto h-8 text-xs"
              onClick={() => setFollowVessel((v) => !v)}
            >
              <IconCrosshair className="size-3.5" />
              {followVessel ? "Seguindo" : "Livre"}
            </Button>
          </div>
        </Card>

        {/* --- Painel lateral --- */}
        <div className="flex flex-col gap-4">
          {/* Bussola vetorial */}
          <Card className="gap-2">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <IconPropeller className="size-4" />
                Rosa dos Ventos
              </CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center pt-1">
              <CompassRose />
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Velocidade"
              value={knots.toFixed(1)}
              unit="kn"
              icon={<IconRoute className="size-3.5" />}
              valueColor="var(--cyan)"
              hint={`${(knots * KMH_PER_KNOT).toFixed(1)} km/h`}
            />
            <MetricCard
              label="Predicao"
              value={`${predictSeconds}`}
              unit="s"
              icon={<IconCrosshair className="size-3.5" />}
              hint={`~${(knots * 0.514444 * predictSeconds).toFixed(0)} m a frente`}
            />
          </div>

          <StationPanel />
        </div>
      </div>

      {/* --- Horizonte artificial 3D --- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Horizonte Artificial — Atitude do Casco
            </CardTitle>
            <CardDescription>
              Modelo 3D em WebGL acionado pelos angulos de Euler do MPU6050.
              Arraste para girar a camera.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] sm:h-[320px]">
              <ArtificialHorizon />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <AttitudeReadout />
          <CronometroNautico />
        </div>
      </div>
    </div>
  );
}
