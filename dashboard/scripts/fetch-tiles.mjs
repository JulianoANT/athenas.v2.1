#!/usr/bin/env node
// =============================================================================
//  Baixa os tiles do mapa da raia para uso OFFLINE durante a prova.
//
//  ---------------------------------------------------------------------------
//  POR QUE ISTO EXISTE
//  ---------------------------------------------------------------------------
//  Na prova o notebook fica conectado ao Access Point do receptor LoRa
//  ("Athenas-Base") — e essa rede NÃO TEM INTERNET. Sem cache, o mapa do
//  Passadiço abre em branco: a posição, a trilha e o vetor de predição
//  continuam sendo calculados (é tudo client-side), mas sem fundo cartográfico
//  ninguém consegue relacionar o barco com a margem.
//
//  Os tiles baixados aqui vão para `public/tiles/` e entram no build. Ficam lá
//  POR CONSTRUÇÃO — não há risco de "esqueceram de aquecer o cache".
//
//  ---------------------------------------------------------------------------
//  POLÍTICA DE USO
//  ---------------------------------------------------------------------------
//  A política dos tiles públicos do OpenStreetMap DESENCORAJA download em massa
//  para uso offline. Por isso este script:
//
//    - limita a UMA requisição por segundo (configurável, nunca abaixo de 1/s);
//    - envia um User-Agent identificando o projeto, como a política exige;
//    - é retomável: nunca rebaixa um tile que já está em disco;
//    - cobre uma área deliberadamente pequena (~2 x 2 km).
//
//  Se a equipe preferir uma fonte que autorize cache offline explicitamente,
//  troque TILE_SOURCE por um provedor com chave de API (MapTiler, Stadia Maps
//  e Thunderforest têm plano gratuito que permite).
//
//  ---------------------------------------------------------------------------
//  USO
//  ---------------------------------------------------------------------------
//    npm run tiles              # baixa (pula o que já existe)
//    npm run tiles -- --dry-run # só estima quantidade e tamanho
//    npm run tiles -- --force   # rebaixa tudo
// =============================================================================

import { mkdir, writeFile, access, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(rootDir, "public", "tiles");

// -----------------------------------------------------------------------------
//  Configuração
//
//  Estes valores espelham src/lib/map/race-area.ts. São duplicados de propósito:
//  este script roda em Node puro, sem passar pelo TypeScript do Vite. Se mudar
//  a área da prova, mude NOS DOIS lugares.
// -----------------------------------------------------------------------------

const BBOX = {
  minLat: -26.307809,
  minLng: -48.892517,
  maxLat: -26.289843,
  maxLng: -48.872467,
};

const MIN_ZOOM = 13;

/**
 * Zoom máximo cacheado. O padrão é 18, e a escolha tem uma razão de custo:
 *
 *   zoom 18 -> 346 tiles no total (~6 MB, ~6 min de download)
 *   zoom 19 -> 1246 tiles       (~22 MB, ~21 min)
 *
 * O zoom 19 sozinho responde por 72% do volume, e o ganho é modesto: em 18 a
 * resolução já é de 0,54 m por pixel, o que numa lagoa de 90 m significa a
 * lâmina d'água ocupando ~170 pixels. Baixar 900 tiles a mais do servidor
 * público do OSM por meio nível de detalhe não é proporcional.
 *
 * Se a equipe quiser o detalhe máximo:  npm run tiles -- --max-zoom 19
 */
const DEFAULT_MAX_ZOOM = 18;
let MAX_ZOOM = DEFAULT_MAX_ZOOM;

/** Fonte dos tiles. `{s}` é sorteado entre os subdomínios. */
const TILE_SOURCE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const SUBDOMAINS = ["a", "b", "c"];

/**
 * Intervalo mínimo entre requisições, em ms. A política do OSM pede
 * comportamento comedido; 1 req/s é o piso que respeitamos sempre.
 */
const REQUEST_INTERVAL_MS = 1000;

/** User-Agent identificando o projeto — exigido pela política de uso. */
const USER_AGENT =
  "AthenasTelemetry/2.2 (equipe universitaria DUNA 2026; cache offline da raia)";

// -----------------------------------------------------------------------------
//  Conversão lat/lon -> índices de tile (projeção Web Mercator, padrão de fato)
// -----------------------------------------------------------------------------

function lngToTileX(lng, zoom) {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      2 ** zoom,
  );
}

/** Lista todos os tiles necessários para cobrir o bbox na faixa de zoom. */
function enumerateTiles() {
  const tiles = [];
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    // Y cresce para o SUL, então maxLat gera o menor Y.
    const xMin = lngToTileX(BBOX.minLng, z);
    const xMax = lngToTileX(BBOX.maxLng, z);
    const yMin = latToTileY(BBOX.maxLat, z);
    const yMax = latToTileY(BBOX.minLat, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

// -----------------------------------------------------------------------------
//  Download
// -----------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchTile({ z, x, y }, attempt = 1) {
  const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  const url = TILE_SOURCE.replace("{s}", sub)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

  if (res.status === 429 || res.status >= 500) {
    // Servidor pedindo calma ou instável: recua exponencialmente em vez de
    // insistir. Bater de novo imediatamente é o que faz servidores banirem IP.
    if (attempt > 4) throw new Error(`HTTP ${res.status} apos 4 tentativas`);
    const backoff = 2000 * 2 ** attempt;
    console.warn(`   HTTP ${res.status} — aguardando ${backoff / 1000}s...`);
    await sleep(backoff);
    return fetchTile({ z, x, y }, attempt + 1);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// -----------------------------------------------------------------------------
//  Programa principal
// -----------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  // --max-zoom N: sobe o teto de detalhe (ver comentário em DEFAULT_MAX_ZOOM).
  const zoomFlag = args.indexOf("--max-zoom");
  if (zoomFlag !== -1 && args[zoomFlag + 1]) {
    const z = Number(args[zoomFlag + 1]);
    if (!Number.isInteger(z) || z < MIN_ZOOM || z > 19) {
      console.error(`--max-zoom precisa ser um inteiro entre ${MIN_ZOOM} e 19.`);
      process.exit(1);
    }
    MAX_ZOOM = z;
  }

  const tiles = enumerateTiles();

  // Resumo por zoom: ajuda a decidir se vale cortar o zoom máximo.
  const porZoom = new Map();
  for (const t of tiles) porZoom.set(t.z, (porZoom.get(t.z) ?? 0) + 1);

  console.log("Área da prova — Lagoas do Complexo Expoville, Joinville/SC");
  console.log(
    `  bbox: ${BBOX.minLat.toFixed(6)}, ${BBOX.minLng.toFixed(6)}` +
      `  ..  ${BBOX.maxLat.toFixed(6)}, ${BBOX.maxLng.toFixed(6)}`,
  );
  console.log(`  zoom: ${MIN_ZOOM} a ${MAX_ZOOM}\n`);

  for (const [z, n] of [...porZoom].sort((a, b) => a[0] - b[0])) {
    console.log(`  zoom ${String(z).padStart(2)}: ${String(n).padStart(5)} tiles`);
  }

  // ~18 KB é a média observada de um tile PNG do OSM nesta região.
  const estMB = ((tiles.length * 18) / 1024).toFixed(1);
  console.log(`\n  TOTAL: ${tiles.length} tiles  (~${estMB} MB)`);
  console.log(
    `  tempo estimado: ~${Math.ceil(
      (tiles.length * REQUEST_INTERVAL_MS) / 60000,
    )} min a ${1000 / REQUEST_INTERVAL_MS} req/s\n`,
  );

  if (dryRun) {
    console.log("--dry-run: nada foi baixado.");
    return;
  }

  await mkdir(outDir, { recursive: true });

  let baixados = 0;
  let pulados = 0;
  let falhas = 0;
  const inicio = Date.now();

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const destDir = join(outDir, String(t.z), String(t.x));
    const dest = join(destDir, `${t.y}.png`);

    if (!force && (await exists(dest))) {
      pulados++;
      continue;
    }

    try {
      const buf = await fetchTile(t);
      await mkdir(destDir, { recursive: true });
      await writeFile(dest, buf);
      baixados++;
    } catch (err) {
      falhas++;
      console.warn(`   falhou ${t.z}/${t.x}/${t.y}: ${err.message}`);
    }

    if (baixados % 25 === 0 && baixados > 0) {
      const pct = (((i + 1) / tiles.length) * 100).toFixed(1);
      const decorrido = ((Date.now() - inicio) / 1000).toFixed(0);
      console.log(
        `  ${pct}%  —  ${baixados} baixados, ${pulados} já existiam, ` +
          `${falhas} falhas  (${decorrido}s)`,
      );
    }

    // Respeita a política de uso: nunca mais rápido que o intervalo mínimo.
    await sleep(REQUEST_INTERVAL_MS);
  }

  // --- Relatório final ---
  let bytes = 0;
  let arquivos = 0;
  async function medir(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await medir(p);
      else {
        bytes += (await stat(p)).size;
        arquivos++;
      }
    }
  }
  if (await exists(outDir)) await medir(outDir);

  console.log(`\nConcluído em ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
  console.log(`  baixados neste run: ${baixados}`);
  console.log(`  já existiam:        ${pulados}`);
  console.log(`  falhas:             ${falhas}`);
  console.log(
    `  cache em disco:     ${arquivos} tiles, ${(bytes / 1048576).toFixed(1)} MB`,
  );

  if (falhas > 0) {
    console.log(
      "\n  Rode o comando de novo para tentar apenas os que faltaram " +
        "(o script pula o que já está em disco).",
    );
  }
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
