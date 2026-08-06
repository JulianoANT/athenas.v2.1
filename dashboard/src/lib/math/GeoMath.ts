// =============================================================================
//  GeoMath — Problema Direto da Geodesia (vetor de predicao de rota)
//
//  A Terra nao e um plano: projetar a posicao futura do barco tracando uma reta
//  na tela acumula erro de curvatura. Resolvemos o Problema Direto em geometria
//  esferica — dado (phi1, lambda1), uma distancia percorrida d e um rumo theta,
//  achar (phi2, lambda2):
//
//      phi2    = arcsin( sin(phi1)·cos(delta) + cos(phi1)·sin(delta)·cos(theta) )
//      lambda2 = lambda1 + atan2( sin(theta)·sin(delta)·cos(phi1),
//                                 cos(delta) − sin(phi1)·sin(phi2) )
//
//  onde delta = d / R e a distancia angular e R = 6.371.000 m.
//
//  Todas as funcoes sao PURAS: nenhuma toca o DOM, nenhuma aloca fora do
//  necessario. Sao chamadas a 5 Hz, entao a alocacao importa.
// =============================================================================

const EARTH_RADIUS_METERS = 6371000;
const KNOTS_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Tempo de predicao padrao, em segundos (configuravel na UI). */
export const DEFAULT_PREDICT_SECONDS = 15;

export type LatLon = [lat: number, lon: number];

/**
 * Projeta a posicao futura da embarcacao resolvendo o Problema Direto da
 * Geodesia.
 *
 * @param lat                Latitude atual em graus.
 * @param lon                Longitude atual em graus.
 * @param speedKnots         Velocidade sobre o solo em nos.
 * @param headingDegrees     Rumo verdadeiro em graus (0 = Norte, horario).
 * @param predictTimeSeconds Horizonte de predicao em segundos.
 * @returns                  Coordenada futura [lat, lon] em graus. Se qualquer
 *                           entrada for invalida, devolve a posicao atual —
 *                           nunca NaN, que quebraria o Leaflet.
 */
export const calculatePredictiveCoordinate = (
  lat: number,
  lon: number,
  speedKnots: number,
  headingDegrees: number,
  predictTimeSeconds: number = DEFAULT_PREDICT_SECONDS,
): LatLon => {
  // --- Guardas de entrada (early returns; nada de NaN saindo daqui). ---
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [lat, lon];
  if (!Number.isFinite(speedKnots) || speedKnots <= 0) return [lat, lon];
  if (!Number.isFinite(headingDegrees)) return [lat, lon];
  if (!Number.isFinite(predictTimeSeconds) || predictTimeSeconds <= 0) {
    return [lat, lon];
  }

  // 1. Converter variaveis para unidades adequadas (SI).
  const distanceMeters = speedKnots * KNOTS_TO_MS * predictTimeSeconds;
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;

  const lat1Rad = lat * DEG_TO_RAD;
  const lon1Rad = lon * DEG_TO_RAD;
  const headingRad = headingDegrees * DEG_TO_RAD;

  const sinLat1 = Math.sin(lat1Rad);
  const cosLat1 = Math.cos(lat1Rad);
  const sinDelta = Math.sin(angularDistance);
  const cosDelta = Math.cos(angularDistance);

  // 2. Aplicar a Projecao Esferica (Problema Direto).
  const lat2Rad = Math.asin(
    sinLat1 * cosDelta + cosLat1 * sinDelta * Math.cos(headingRad),
  );

  const lon2Rad =
    lon1Rad +
    Math.atan2(
      Math.sin(headingRad) * sinDelta * cosLat1,
      cosDelta - sinLat1 * Math.sin(lat2Rad),
    );

  // 3. Converter de volta para graus, normalizando a longitude em [-180, 180].
  const finalLat = lat2Rad * RAD_TO_DEG;
  const finalLon = (((lon2Rad * RAD_TO_DEG + 540) % 360) - 180);

  if (!Number.isFinite(finalLat) || !Number.isFinite(finalLon)) {
    return [lat, lon];
  }

  return [finalLat, finalLon];
};

/**
 * Rumo inicial (forward azimuth) do ponto A para o ponto B, em graus.
 * Usado para orientar a seta fantasma na ponta do vetor de predicao.
 */
export const initialBearing = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = (lon2 - lon1) * DEG_TO_RAD;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  const bearing = Math.atan2(y, x) * RAD_TO_DEG;
  return (bearing + 360) % 360;
};

/**
 * Gera a polilinha do vetor de predicao com `steps` segmentos intermediarios.
 *
 * Um unico segmento reto ja seria visualmente aceitavel nos 15 s padrao, mas
 * amostrar a geodesica deixa a curva correta se a equipe aumentar o horizonte
 * de predicao (ex.: 60 s em alta velocidade), quando a curvatura ja aparece.
 */
export const buildPredictionPath = (
  lat: number,
  lon: number,
  speedKnots: number,
  headingDegrees: number,
  predictTimeSeconds: number = DEFAULT_PREDICT_SECONDS,
  steps = 6,
): LatLon[] => {
  if (!Number.isFinite(speedKnots) || speedKnots <= 0) return [];

  const path: LatLon[] = [[lat, lon]];
  const n = Math.max(1, Math.floor(steps));

  for (let i = 1; i <= n; i++) {
    const t = (predictTimeSeconds * i) / n;
    path.push(
      calculatePredictiveCoordinate(lat, lon, speedKnots, headingDegrees, t),
    );
  }

  return path;
};
