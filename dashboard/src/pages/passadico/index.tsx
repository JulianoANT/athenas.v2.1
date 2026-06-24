import * as React from "react";
import * as L from "leaflet";
import {
  IconCompass,
  IconCurrentLocation,
  IconMapPin,
  IconRoute,
  IconRulerMeasure,
  IconSatellite,
} from "@tabler/icons-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MetricCard } from "@/components/metric-card";
import { useTelemetry } from "@/lib/telemetry/provider";
import { toKnots } from "@/lib/telemetry/contract";
import { cn } from "@/lib/utils";
import { createVesselIcon, rotateVesselMarker } from "./vessel-icon";
import { CronometroNautico } from "./cronometro";

// =============================================================================
// ABA 1 — Passadiço & Navegação
// Mapa hidrográfico (Leaflet) com marcador de embarcação vista de cima e rumo
// dinâmico, trilha do percurso, distância Haversine até a estação de controle,
// velocidade em nós e cronômetro náutico. Sem gating (público e tripulação).
// =============================================================================

// Centro de fallback: Parque Expoville, Joinville/SC (sede da regata Athenas).
const EXPOVILLE_CENTER: L.LatLngTuple = [-26.2731, -48.852];
const INITIAL_ZOOM = 16;

// Rosa dos ventos (rótulo do rumo).
function compassLabel(deg: number): string {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function fmtCoord(v: number, axis: "lat" | "lng"): string {
  const hemi =
    axis === "lat" ? (v >= 0 ? "N" : "S") : v >= 0 ? "E" : "W";
  return `${Math.abs(v).toFixed(5)}° ${hemi}`;
}

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

export default function Passadico() {
  const { frame, history, station, distance_m, requestStation } =
    useTelemetry();

  // Refs do Leaflet (criados uma única vez).
  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const markerRef = React.useRef<L.Marker | null>(null);
  const trackRef = React.useRef<L.Polyline | null>(null);
  const stationMarkerRef = React.useRef<L.Marker | null>(null);
  const linkLineRef = React.useRef<L.Polyline | null>(null);
  const didCenterRef = React.useRef(false);

  // -------------------------------------------------------------------------
  // 1) Cria o mapa UMA vez. Tiles OpenStreetMap; marcador da embarcação e
  //    polyline da trilha são instanciados aqui e atualizados nos efeitos
  //    seguintes. Cleanup com map.remove().
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: EXPOVILLE_CENTER,
      zoom: INITIAL_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });

    // TODO(offline): pré-cachear (service worker / tiles empacotados) a área do
    // Parque Expoville para operação sem internet durante a regata. Avaliar
    // leaflet.offline ou um TileLayer customizado com IndexedDB para os níveis
    // de zoom 14–18 do bounding box da raia de prova.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // Trilha do percurso.
    trackRef.current = L.polyline([], {
      color: "#22d3ee",
      weight: 3,
      opacity: 0.85,
      lineJoin: "round",
    }).addTo(map);

    // Marcador da embarcação vista de cima (divIcon, nunca o pin padrão).
    markerRef.current = L.marker(EXPOVILLE_CENTER, {
      icon: createVesselIcon(),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      trackRef.current = null;
      stationMarkerRef.current = null;
      linkLineRef.current = null;
      didCenterRef.current = false;
    };
  }, []);

  // -------------------------------------------------------------------------
  // 2) A cada quadro: reposiciona o marcador (lat/lng) e rotaciona o SVG pelo
  //    rumo (cog). Centraliza no barco no primeiro fix válido.
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !frame || !frame.gps.fix) return;

    const pos: L.LatLngTuple = [frame.gps.lat, frame.gps.lng];
    marker.setLatLng(pos);
    rotateVesselMarker(marker, frame.gps.cog);

    if (!didCenterRef.current) {
      map.setView(pos, INITIAL_ZOOM);
      didCenterRef.current = true;
    }
  }, [frame]);

  // -------------------------------------------------------------------------
  // 3) Trilha: acumula posições do history com gps.fix === true.
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const pts: L.LatLngTuple[] = history
      .filter((s) => s.gps.fix)
      .map((s) => [s.gps.lat, s.gps.lng]);
    track.setLatLngs(pts);
  }, [history]);

  // -------------------------------------------------------------------------
  // 4) Estação de controle: marcador + linha estação↔barco (Haversine).
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!station) {
      stationMarkerRef.current?.remove();
      stationMarkerRef.current = null;
      linkLineRef.current?.remove();
      linkLineRef.current = null;
      return;
    }

    const sPos: L.LatLngTuple = [station.lat, station.lng];
    const stationIcon = L.divIcon({
      className: "athenas-station",
      html: `<div style="width:14px;height:14px;border-radius:50%;
              background:var(--warn);border:2px solid #1a1205;
              box-shadow:0 0 8px var(--warn)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    if (!stationMarkerRef.current) {
      stationMarkerRef.current = L.marker(sPos, {
        icon: stationIcon,
        interactive: false,
      }).addTo(map);
    } else {
      stationMarkerRef.current.setLatLng(sPos);
    }

    if (frame?.gps.fix) {
      const link: L.LatLngTuple[] = [
        sPos,
        [frame.gps.lat, frame.gps.lng],
      ];
      if (!linkLineRef.current) {
        linkLineRef.current = L.polyline(link, {
          color: "#f59e0b",
          weight: 2,
          dashArray: "6 6",
          opacity: 0.8,
        }).addTo(map);
      } else {
        linkLineRef.current.setLatLngs(link);
      }
    }
  }, [station, frame]);

  // -------------------------------------------------------------------------
  // Valores derivados para o painel.
  // -------------------------------------------------------------------------
  const fix = frame?.gps.fix ?? false;
  const knots = frame ? toKnots(frame.gps.speed_kmh) : 0;
  const cog = frame?.gps.cog ?? 0;
  const kmh = frame?.gps.speed_kmh ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-lg font-semibold">
            Passadiço &amp; Navegação
          </h1>
          <p className="text-xs text-muted-foreground">
            Carta hidrográfica ao vivo, rumo dinâmico e cronometragem de prova.
          </p>
        </div>
        <Badge variant={fix ? "ok" : "muted"}>
          <IconSatellite className="size-3" />
          {fix ? "GPS Fixado" : "Sem fix"}
        </Badge>
      </div>

      {/* Mapa grande + painel lateral */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Mapa */}
        <Card className="overflow-hidden p-0">
          <div className="relative">
            <div
              ref={mapContainerRef}
              className="h-[420px] w-full lg:h-[560px]"
              style={{ background: "#0a1822" }}
              aria-label="Mapa hidrográfico da embarcação"
            />
            {/* Selo de velocidade sobreposto */}
            <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-md bg-card/85 px-3 py-2 ring-1 ring-foreground/10 backdrop-blur">
              <div className="flex items-baseline gap-1 font-tech">
                <span
                  className="text-2xl font-semibold"
                  style={{ color: "var(--cyan)" }}
                >
                  {knots.toFixed(1)}
                </span>
                <span className="text-xs text-muted-foreground">kn</span>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {kmh.toFixed(1)} km/h
              </div>
            </div>
            {/* Selo de rumo sobreposto */}
            <div className="pointer-events-none absolute right-3 top-3 z-[500] flex items-center gap-2 rounded-md bg-card/85 px-3 py-2 ring-1 ring-foreground/10 backdrop-blur">
              <IconCompass
                className="size-5"
                style={{
                  color: "var(--cyan)",
                  transform: `rotate(${cog}deg)`,
                  transition: "transform 180ms linear",
                }}
              />
              <div className="leading-tight">
                <div className="font-tech text-lg font-semibold">
                  {Math.round(cog)}°
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {compassLabel(cog)}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Painel lateral */}
        <div className="flex flex-col gap-4">
          {/* Navegação */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Velocidade"
              value={knots.toFixed(1)}
              unit="kn"
              icon={<IconRoute className="size-3.5" />}
              valueColor="var(--cyan)"
              hint={`${kmh.toFixed(1)} km/h`}
            />
            <MetricCard
              label="Rumo (COG)"
              value={`${Math.round(cog)}°`}
              icon={<IconCompass className="size-3.5" />}
              hint={compassLabel(cog)}
            />
          </div>

          {/* Distância / Estação */}
          <Card className="gap-3">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <IconRulerMeasure className="size-4" />
                Distância da Estação
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div
                className="font-tech text-3xl font-semibold leading-none"
                style={{
                  color:
                    distance_m == null ? "var(--muted-foreground)" : "var(--primary)",
                }}
              >
                {distance_m == null ? "—" : fmtDistance(distance_m)}
              </div>

              <Separator />

              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <IconCurrentLocation className="size-3.5" />
                    Estação
                  </span>
                  <span className="font-tech tabular-nums">
                    {station
                      ? `${fmtCoord(station.lat, "lat")}, ${fmtCoord(station.lng, "lng")}`
                      : "não definida"}
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
                    {frame && fix
                      ? `${fmtCoord(frame.gps.lat, "lat")}, ${fmtCoord(frame.gps.lng, "lng")}`
                      : "aguardando fix"}
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                size="lg"
                className="h-10 w-full text-sm font-medium"
                onClick={requestStation}
              >
                <IconCurrentLocation />
                {station ? "Redefinir estação" : "Definir estação"}
              </Button>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Usa a geolocalização do navegador como ponto de controle. A
                distância é calculada pela fórmula de Haversine.
              </p>
            </CardContent>
          </Card>

          {/* Cronômetro náutico */}
          <CronometroNautico />
        </div>
      </div>
    </div>
  );
}
