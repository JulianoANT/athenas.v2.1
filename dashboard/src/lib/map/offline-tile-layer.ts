// =============================================================================
//  Camada de tiles OFFLINE-FIRST
//
//  ---------------------------------------------------------------------------
//  O PROBLEMA QUE ISTO RESOLVE
//  ---------------------------------------------------------------------------
//  Na prova o notebook fica conectado ao Access Point do receptor LoRa, que NÃO
//  TEM INTERNET. Um TileLayer comum apontando para o OpenStreetMap abriria o
//  mapa em branco — a posição, a trilha e o vetor de predição continuariam
//  corretos (é tudo calculado no cliente), mas sem fundo cartográfico ninguém
//  relaciona o barco com a margem.
//
//  ---------------------------------------------------------------------------
//  ESTRATÉGIA
//  ---------------------------------------------------------------------------
//  Cada tile é tentado primeiro no CACHE LOCAL (`/tiles/{z}/{x}/{y}.png`,
//  embutido no build por `npm run tiles`). Se não existir ali — porque a equipe
//  navegou para fora da raia, ou pediu um zoom não cacheado — cai para o
//  servidor online.
//
//  A ordem importa: local primeiro significa que a prova funciona com zero
//  infraestrutura, e a internet vira um bônus para a bancada, não um requisito.
//
//  O componente também informa QUAL fonte está sendo usada, para a equipe saber
//  se está vendo o mapa cacheado ou o online — informação que muda a
//  interpretação de uma área em branco.
// =============================================================================

import * as L from "leaflet";

/** Caminho do cache local, relativo à base do deploy. */
const LOCAL_TILE_URL = `${import.meta.env.BASE_URL}tiles/{z}/{x}/{y}.png`;

const ONLINE_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export type TileSource = "local" | "online";

export interface TileSourceStats {
  /** Tiles servidos do cache embutido no build. */
  local: number;
  /** Tiles buscados do servidor online. */
  online: number;
  /** Tiles que falharam nas duas fontes (área sem cobertura e sem internet). */
  missing: number;
}

export interface OfflineTileLayerOptions extends L.TileLayerOptions {
  /** Chamado quando as estatísticas de origem mudam. */
  onStats?: (stats: TileSourceStats) => void;
}

/**
 * TileLayer que tenta o cache local e cai para o online.
 *
 * Estende `L.TileLayer` sobrescrevendo `createTile`, em vez de empilhar duas
 * camadas com opacidade. Duas camadas baixariam TODOS os tiles online mesmo
 * quando o cache atende — desperdiçando a banda que justamente não existe em
 * campo.
 */
export class OfflineTileLayer extends L.TileLayer {
  private stats: TileSourceStats = { local: 0, online: 0, missing: 0 };
  private readonly onStats?: (stats: TileSourceStats) => void;

  constructor(options: OfflineTileLayerOptions = {}) {
    // A URL base é a LOCAL; o fallback é aplicado por tile em createTile().
    super(LOCAL_TILE_URL, {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      ...options,
    });
    this.onStats = options.onStats;
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement("img");
    tile.alt = "";
    // Sem crossOrigin: o cache é servido pela mesma origem, e o OSM não exige
    // CORS para exibição simples em <img>.
    tile.setAttribute("role", "presentation");

    const localUrl = this.getTileUrl(coords);
    const onlineUrl = this.buildOnlineUrl(coords);

    let tentouOnline = false;

    const sucesso = (fonte: TileSource) => {
      this.stats[fonte]++;
      this.emitStats();
      done(undefined, tile);
    };

    tile.onload = () => sucesso(tentouOnline ? "online" : "local");

    tile.onerror = () => {
      if (!tentouOnline) {
        // Cache não cobre este tile: tenta a internet.
        tentouOnline = true;
        tile.src = onlineUrl;
        return;
      }
      // As duas fontes falharam. Reportamos ao Leaflet SEM erro e com o tile
      // vazio: propagar o erro faria o Leaflet re-tentar em loop, martelando
      // uma rede que não existe.
      this.stats.missing++;
      this.emitStats();
      done(undefined, tile);
    };

    tile.src = localUrl;
    return tile;
  }

  /** Monta a URL online sorteando o subdomínio, como o Leaflet faria. */
  private buildOnlineUrl(coords: L.Coords): string {
    const subs = ["a", "b", "c"];
    const sub = subs[Math.abs(coords.x + coords.y) % subs.length];
    return ONLINE_TILE_URL.replace("{s}", sub)
      .replace("{z}", String(this._getZoomForUrl()))
      .replace("{x}", String(coords.x))
      .replace("{y}", String(coords.y));
  }

  private emitStats(): void {
    // Cópia: quem recebe não deve conseguir mutar o estado interno da camada.
    this.onStats?.({ ...this.stats });
  }

  /** Estatísticas atuais de origem dos tiles. */
  getStats(): TileSourceStats {
    return { ...this.stats };
  }
}

/**
 * Indica se o cache local está presente no build.
 *
 * Faz UMA requisição a um tile conhecido (o de zoom mínimo, que sempre existe
 * se o cache foi gerado). Serve para a UI avisar a equipe ANTES da prova que
 * `npm run tiles` não foi rodado — descobrir isso na beira do rio é tarde.
 */
export async function hasLocalTileCache(
  z: number,
  x: number,
  y: number,
): Promise<boolean> {
  try {
    const url = `${import.meta.env.BASE_URL}tiles/${z}/${x}/${y}.png`;
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Índices do tile que cobre uma coordenada num dado zoom (Web Mercator). */
export function tileIndexFor(
  lat: number,
  lng: number,
  zoom: number,
): { x: number; y: number } {
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * 2 ** zoom),
    y: Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
        2 ** zoom,
    ),
  };
}
