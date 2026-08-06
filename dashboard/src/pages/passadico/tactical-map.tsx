// =============================================================================
//  TacticalMap — carta hidrografica com VETOR DE PREDICAO DE ROTA
//
//  O mapa nao mostra so ONDE O BARCO ESTA, mas ONDE ELE ESTARA. A linha
//  tracejada vermelha projeta a posicao daqui a N segundos resolvendo o
//  Problema Direto da Geodesia (ver @/lib/math/GeoMath).
//
//  Para a equipe em terra isso muda a natureza da informacao: em vez de reagir
//  a uma colisao com a margem, da para ver o raio de giro e o tempo de impacto
//  ANTES de acontecer, e chamar a correcao no radio.
//
//  ARQUITETURA DE PERFORMANCE:
//  O react-leaflet monta o container e as camadas estaticas (tiles), como pede
//  a Diretriz. Mas TUDO que muda a 5 Hz — marcador, trilha, vetor de predicao —
//  e mutado imperativamente por `VesselLayer`, que se inscreve no store fora do
//  ciclo de render. Se essas camadas fossem <Polyline> declarativos, cada
//  quadro reconciliaria a arvore e o mapa travaria sob carga.
// =============================================================================

import * as React from "react";
import * as L from "leaflet";
import { MapContainer, useMap } from "react-leaflet";

import { useTelemetryStore } from "@/lib/telemetry/store";
import { history } from "@/lib/telemetry/history";
import {
  buildPredictionPath,
  DEFAULT_PREDICT_SECONDS,
  initialBearing,
} from "@/lib/math/GeoMath";
import {
  OfflineTileLayer,
  hasLocalTileCache,
  tileIndexFor,
  type TileSourceStats,
} from "@/lib/map/offline-tile-layer";
import {
  RACE_CENTER,
  RACE_ZOOM,
  TILE_MIN_ZOOM,
} from "@/lib/map/race-area";
import { createVesselIcon, rotateVesselMarker } from "./vessel-icon";

// Centro de fallback: Lagoas do Complexo Expoville, Joinville/SC.
// Coordenadas verificadas no OpenStreetMap — ver @/lib/map/race-area.
const FALLBACK_CENTER: L.LatLngTuple = [RACE_CENTER.lat, RACE_CENTER.lng];
const INITIAL_ZOOM = RACE_ZOOM;

// --- Identidade visual das camadas ---
const TRACK_COLOR = "#48CAE4"; // trilha percorrida (azul ciano)
const PREDICT_COLOR = "#EF476F"; // vetor de predicao (vermelho tatico)
const STATION_COLOR = "#f59e0b";

/** Amostras da trilha desenhada. 1.800 = 6 min a 5 Hz. */
const TRACK_POINTS = 1800;

// -----------------------------------------------------------------------------
//  Icone fantasma do fim do vetor: marca a posicao projetada.
// -----------------------------------------------------------------------------
function createGhostIcon(bearingDeg: number): L.DivIcon {
  return L.divIcon({
    className: "athenas-ghost",
    html: `
      <div style="transform: rotate(${bearingDeg}deg); transform-origin: 50% 50%;">
        <svg viewBox="0 0 24 24" width="24" height="24" style="overflow:visible">
          <path d="M12 2 L18 16 L12 12.5 L6 16 Z"
                fill="${PREDICT_COLOR}" fill-opacity="0.55"
                stroke="${PREDICT_COLOR}" stroke-width="1.4"
                stroke-linejoin="round"/>
        </svg>
      </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export interface VesselLayerProps {
  /** Horizonte de predicao em segundos. */
  predictSeconds: number;
  /** Manter o mapa centralizado na embarcacao. */
  followVessel: boolean;
}

/**
 * Camada dinamica. Nao renderiza JSX: instancia as camadas do Leaflet uma vez
 * e as atualiza por assinatura direta no store.
 */
function VesselLayer({ predictSeconds, followVessel }: VesselLayerProps) {
  const map = useMap();

  // Refs para as opcoes volateis, para que a assinatura do store nao precise
  // ser recriada (e o listener re-registrado) a cada mudanca de configuracao.
  // A escrita acontece em efeito, nunca durante o render: mutar ref no corpo do
  // componente quebra as garantias do modo concorrente do React.
  const predictRef = React.useRef(predictSeconds);
  const followRef = React.useRef(followVessel);

  React.useEffect(() => {
    predictRef.current = predictSeconds;
  }, [predictSeconds]);

  React.useEffect(() => {
    followRef.current = followVessel;
  }, [followVessel]);

  React.useEffect(() => {
    // --- Camadas criadas UMA vez ---
    const track = L.polyline([], {
      color: TRACK_COLOR,
      weight: 3,
      opacity: 0.85,
      lineJoin: "round",
    }).addTo(map);

    const prediction = L.polyline([], {
      color: PREDICT_COLOR,
      weight: 3,
      opacity: 0.9,
      dashArray: "10, 10",
      lineCap: "butt",
    }).addTo(map);

    const ghost = L.marker(FALLBACK_CENTER, {
      icon: createGhostIcon(0),
      interactive: false,
      keyboard: false,
      opacity: 0,
    }).addTo(map);

    const vessel = L.marker(FALLBACK_CENTER, {
      icon: createVesselIcon(),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);

    let stationMarker: L.Marker | null = null;
    let linkLine: L.Polyline | null = null;
    let didCenter = false;
    let lastGhostBearing = -1;

    // --- Atualizacao de alta frequencia ---------------------------------
    const update = () => {
      const s = useTelemetryStore.getState();
      if (!s.frame) return;

      const lat = s.lat;
      const lng = s.lng;
      const hasFix = s.fix && Number.isFinite(lat) && Number.isFinite(lng);

      if (hasFix) {
        const pos: L.LatLngTuple = [lat, lng];
        vessel.setLatLng(pos);
        rotateVesselMarker(vessel, s.cog);

        if (!didCenter) {
          map.setView(pos, INITIAL_ZOOM);
          didCenter = true;
        } else if (followRef.current && !map.getBounds().contains(pos)) {
          // So recentraliza quando o barco sai do enquadramento: recentralizar
          // a cada quadro impediria a equipe de arrastar o mapa para inspecionar
          // outra parte da raia.
          map.panTo(pos, { animate: true, duration: 0.4 });
        }

        // --- VETOR DE PREDICAO ---
        const path = buildPredictionPath(
          lat,
          lng,
          s.speedKnots,
          s.cog,
          predictRef.current,
        );

        if (path.length > 1) {
          prediction.setLatLngs(path as L.LatLngTuple[]);
          const end = path[path.length - 1];
          ghost.setLatLng(end as L.LatLngTuple);
          ghost.setOpacity(1);

          // Reconstruir o divIcon e caro; so refazemos quando o rumo muda o
          // suficiente para o olho perceber.
          const bearing = initialBearing(lat, lng, end[0], end[1]);
          if (Math.abs(bearing - lastGhostBearing) > 2) {
            ghost.setIcon(createGhostIcon(bearing));
            lastGhostBearing = bearing;
          }
        } else {
          // Barco parado: sem vetor. Uma seta de comprimento zero apontando
          // para um rumo antigo seria pior que informacao nenhuma.
          prediction.setLatLngs([]);
          ghost.setOpacity(0);
        }
      }

      // --- Trilha percorrida (posicoes ja filtradas por Kalman) ---
      const cols = history.read(TRACK_POINTS);
      const lats = cols[12];
      const lngs = cols[13];
      const pts: L.LatLngTuple[] = [];
      for (let i = 0; i < lats.length; i++) {
        const la = lats[i];
        const ln = lngs[i];
        if (Number.isFinite(la) && Number.isFinite(ln)) pts.push([la, ln]);
      }
      track.setLatLngs(pts);

      // --- Estacao de controle ---
      if (s.station) {
        const sPos: L.LatLngTuple = [s.station.lat, s.station.lng];
        if (!stationMarker) {
          stationMarker = L.marker(sPos, {
            icon: L.divIcon({
              className: "athenas-station",
              html: `<div style="width:14px;height:14px;border-radius:50%;
                      background:${STATION_COLOR};border:2px solid #1a1205;
                      box-shadow:0 0 8px ${STATION_COLOR}"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            }),
            interactive: false,
          }).addTo(map);
        } else {
          stationMarker.setLatLng(sPos);
        }

        if (hasFix) {
          const link: L.LatLngTuple[] = [sPos, [lat, lng]];
          if (!linkLine) {
            linkLine = L.polyline(link, {
              color: STATION_COLOR,
              weight: 2,
              dashArray: "6 6",
              opacity: 0.8,
            }).addTo(map);
          } else {
            linkLine.setLatLngs(link);
          }
        }
      } else {
        stationMarker?.remove();
        stationMarker = null;
        linkLine?.remove();
        linkLine = null;
      }
    };

    update();
    const unsubscribe = useTelemetryStore.subscribe(
      (s) => s.historyVersion,
      update,
    );
    const unsubscribeStation = useTelemetryStore.subscribe(
      (s) => s.station,
      update,
    );

    return () => {
      unsubscribe();
      unsubscribeStation();
      track.remove();
      prediction.remove();
      ghost.remove();
      vessel.remove();
      stationMarker?.remove();
      linkLine?.remove();
    };
  }, [map]);

  return null;
}

/**
 * Camada base offline-first.
 *
 * Nao e um `<TileLayer>` do react-leaflet porque precisamos da logica de
 * fallback POR TILE (cache local -> online), que exige sobrescrever
 * `createTile`. Ver @/lib/map/offline-tile-layer.
 */
function BaseTileLayer({
  onStats,
}: {
  onStats: (stats: TileSourceStats) => void;
}) {
  const map = useMap();
  const onStatsRef = React.useRef(onStats);

  React.useEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);

  React.useEffect(() => {
    const layer = new OfflineTileLayer({
      maxZoom: 19,
      // As estatisticas chegam por tile; repassamos por ref para nao recriar a
      // camada (e rebaixar tudo) quando o callback do pai muda de identidade.
      onStats: (s) => onStatsRef.current(s),
    });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map]);

  return null;
}

/** Corrige o tamanho do mapa quando o container muda (sidebar, rotacao). */
function ResizeHandler() {
  const map = useMap();

  React.useEffect(() => {
    const container = map.getContainer();
    // O Leaflet calcula o tamanho no momento da montagem. Em um layout
    // responsivo (sidebar colapsando, tablet girando) o container muda depois,
    // e sem invalidateSize os tiles ficam cortados.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

/**
 * Selo da fonte da cartografia.
 *
 * Informacao operacional, nao decoracao: uma area em branco no mapa significa
 * coisas diferentes conforme a fonte. Com o cache local, significa "a equipe
 * navegou para fora da raia baixada". Com a internet, significa "a rede caiu".
 */
function TileSourceBadge({
  stats,
  cacheAusente,
}: {
  stats: TileSourceStats;
  cacheAusente: boolean;
}) {
  // AVISO DE PREPARO — o modo de falha mais traiçoeiro deste recurso:
  // a equipe testa na bancada COM internet, ve o mapa perfeito, e so descobre
  // que o cache esta vazio na beira do rio, quando nao ha mais o que fazer.
  // Este aviso torna isso impossivel de passar despercebido.
  if (cacheAusente) {
    return (
      <div
        className="absolute bottom-6 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-md px-2.5 py-1.5 text-[10px] ring-1 backdrop-blur"
        style={{
          background: "color-mix(in oklab, var(--warn) 18%, var(--card))",
          color: "var(--warn)",
        }}
      >
        <div className="font-tech font-bold uppercase tracking-wide">
          Carta offline ausente
        </div>
        <div className="mt-0.5 text-foreground/80">
          Rode <code className="font-tech">npm run tiles</code> antes da prova —
          na rede do receptor nao ha internet e o mapa ficara em branco.
        </div>
      </div>
    );
  }

  const total = stats.local + stats.online;
  if (total === 0) return null;

  const soLocal = stats.online === 0;
  const cor = soLocal ? "var(--ok)" : "var(--cyan)";

  return (
    <div
      className="pointer-events-none absolute bottom-6 left-3 z-[500] rounded-md bg-card/85 px-2 py-1 text-[10px] ring-1 ring-foreground/10 backdrop-blur"
      title={
        `Tiles do cache local: ${stats.local} · online: ${stats.online}` +
        (stats.missing > 0 ? ` · sem cobertura: ${stats.missing}` : "")
      }
    >
      <span className="font-tech uppercase tracking-wide" style={{ color: cor }}>
        {soLocal ? "Carta offline" : "Carta online"}
      </span>
      {stats.missing > 0 && (
        <span className="ml-1.5" style={{ color: "var(--warn)" }}>
          {stats.missing} sem cobertura
        </span>
      )}
    </div>
  );
}

export interface TacticalMapProps {
  /** Horizonte de predicao em segundos (padrao 15 s). */
  predictSeconds?: number;
  followVessel?: boolean;
  className?: string;
}

export function TacticalMap({
  predictSeconds = DEFAULT_PREDICT_SECONDS,
  followVessel = true,
  className,
}: TacticalMapProps) {
  const [tileStats, setTileStats] = React.useState<TileSourceStats>({
    local: 0,
    online: 0,
    missing: 0,
  });

  // As estatisticas chegam a cada tile carregado — dezenas de vezes ao arrastar
  // o mapa. Atualizamos o estado no maximo 2x por segundo para nao transformar
  // a rolagem do mapa numa cascata de re-renders.
  const pendenteRef = React.useRef<TileSourceStats | null>(null);
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (pendenteRef.current) {
        setTileStats(pendenteRef.current);
        pendenteRef.current = null;
      }
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const onStats = React.useCallback((s: TileSourceStats) => {
    pendenteRef.current = s;
  }, []);

  // Verificacao de preparo: o cache local existe neste build?
  // Uma unica requisicao HEAD ao tile de zoom minimo, que sempre existe se o
  // cache foi gerado. `null` = ainda checando (nao mostra nada).
  const [cacheAusente, setCacheAusente] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let cancelado = false;
    const { x, y } = tileIndexFor(RACE_CENTER.lat, RACE_CENTER.lng, TILE_MIN_ZOOM);
    hasLocalTileCache(TILE_MIN_ZOOM, x, y).then((tem) => {
      if (!cancelado) setCacheAusente(!tem);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={FALLBACK_CENTER}
        zoom={INITIAL_ZOOM}
        className={className}
        style={{ height: "100%", width: "100%", background: "#0a1822" }}
        zoomControl
        attributionControl
      >
        {/* Cartografia offline-first: o cache embutido pelo `npm run tiles`
            atende primeiro; a internet e apenas fallback. E isso que permite a
            prova rodar conectada ao AP do receptor, que nao tem internet. */}
        <BaseTileLayer onStats={onStats} />
        <ResizeHandler />
        <VesselLayer
          predictSeconds={predictSeconds}
          followVessel={followVessel}
        />
      </MapContainer>
      <TileSourceBadge stats={tileStats} cacheAusente={cacheAusente === true} />
    </div>
  );
}
