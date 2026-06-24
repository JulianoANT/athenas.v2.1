import * as L from "leaflet";

// Marcador da embarcação VISTA DE CIMA (top-down), nunca o pin padrão do
// Leaflet. Construído via L.divIcon com um SVG embutido. O elemento raiz
// recebe a classe "athenas-vessel" para que possamos rotacioná-lo conforme o
// rumo (cog) sem recriar o ícone a cada quadro.

const VESSEL_SIZE = 38;

/**
 * SVG de um casco visto de cima, apontando para o NORTE (topo). A rotação é
 * aplicada externamente (transform: rotate) em torno do centro para refletir o
 * Course Over Ground. O glow ciano segue a identidade Athenas.
 */
function vesselSvg(): string {
  return `
    <svg viewBox="0 0 40 40" width="${VESSEL_SIZE}" height="${VESSEL_SIZE}"
         xmlns="http://www.w3.org/2000/svg" class="athenas-vessel-svg"
         style="overflow:visible">
      <!-- esteira/halo -->
      <circle cx="20" cy="20" r="17" fill="var(--cyan)" opacity="0.12"/>
      <!-- casco visto de cima: proa para cima -->
      <path d="M20 3
               C26 9 27 18 27 26
               C27 31 24 35 20 37
               C16 35 13 31 13 26
               C13 18 14 9 20 3 Z"
            fill="var(--cyan)" stroke="#04222b" stroke-width="1.4"/>
      <!-- convés / cabine -->
      <path d="M20 12
               C23 15 23 22 22 27
               L18 27
               C17 22 17 15 20 12 Z"
            fill="#04222b" opacity="0.85"/>
      <!-- vetor de proa (indica o rumo) -->
      <path d="M20 3 L17 9 L23 9 Z" fill="#eafdff"/>
    </svg>`;
}

/** Cria o L.divIcon da embarcação. */
export function createVesselIcon(): L.DivIcon {
  return L.divIcon({
    className: "athenas-vessel", // sem estilos padrão do Leaflet
    html: `<div class="athenas-vessel-rot">${vesselSvg()}</div>`,
    iconSize: [VESSEL_SIZE, VESSEL_SIZE],
    iconAnchor: [VESSEL_SIZE / 2, VESSEL_SIZE / 2],
  });
}

/**
 * Aplica a rotação (rumo em graus) ao SVG interno do marcador. Trabalha sobre o
 * elemento já renderizado no DOM para evitar recriar o ícone a cada quadro.
 */
export function rotateVesselMarker(marker: L.Marker, cogDeg: number): void {
  const el = marker.getElement();
  if (!el) return;
  const rot = el.querySelector<HTMLElement>(".athenas-vessel-rot");
  if (rot) {
    rot.style.transform = `rotate(${cogDeg}deg)`;
    rot.style.transformOrigin = "50% 50%";
    rot.style.transition = "transform 180ms linear";
  }
}
