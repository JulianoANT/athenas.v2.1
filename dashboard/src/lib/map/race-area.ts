// =============================================================================
//  Área da prova — Lagoas do Complexo Expoville, Joinville/SC
//
//  Coordenadas verificadas no OpenStreetMap (Nominatim + Overpass), não
//  estimadas. As duas lagoas do complexo somam uma raia compacta:
//
//    Lagoa norte:  -26.297905, -48.882673   (82 m L-O × 66 m N-S)
//    Lagoa sul:    -26.299747, -48.882311   (92 m L-O × 58 m N-S)
//    Complexo:     -26.299348, -48.881810
//
//  ATENÇÃO — ESTE ARQUIVO É A FONTE ÚNICA DA LOCALIZAÇÃO.
//  O centro do mapa E o bounding box do cache de tiles saem daqui. Se a prova
//  mudar de lugar, altere SÓ este arquivo e rode `npm run tiles` de novo.
//
//  (A versão anterior tinha o centro em -26.2731, -48.852 — cerca de 3,5 km
//  fora do local real. O mapa abria no lugar errado até o primeiro fix de GPS.)
// =============================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Centro da raia: ponto médio entre as duas lagoas. */
export const RACE_CENTER: LatLng = {
  lat: -26.298826,
  lng: -48.882492,
};

/** Zoom inicial. Em 17 as duas lagoas cabem na tela com folga. */
export const RACE_ZOOM = 17;

/**
 * Área coberta pelo cache offline de tiles: ~1 km em cada direção a partir do
 * centro. Cobre as duas lagoas, o complexo inteiro e a margem de acesso, com
 * folga suficiente para a equipe navegar o mapa sem cair em área sem tile.
 */
export const RACE_BBOX: BoundingBox = {
  minLat: -26.307809,
  minLng: -48.892517,
  maxLat: -26.289843,
  maxLng: -48.872467,
};

/**
 * Faixa de zoom cacheada.
 *
 * 13 dá o contexto da cidade (útil para se localizar); 19 é o detalhe máximo do
 * OpenStreetMap, necessário porque as lagoas têm menos de 100 m — em zoom baixo
 * a embarcação e o vetor de predição ficariam empilhados em poucos pixels.
 */
export const TILE_MIN_ZOOM = 13;
export const TILE_MAX_ZOOM = 19;

// NOTA: deliberadamente NÃO travamos a navegação do mapa nestes limites.
// Seria tentador aplicar `maxBounds` para manter a equipe dentro da área
// cacheada, mas isso se voltaria contra nós: se a embarcação derivar para fora
// do bbox, o mapa ficaria impedido de segui-la — escondendo o barco justamente
// na situação em que vê-lo mais importa. Fora da área cacheada a camada cai
// para o servidor online, e o selo no canto avisa que a fonte mudou.
