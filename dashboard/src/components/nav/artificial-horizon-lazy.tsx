// =============================================================================
//  Carregamento sob demanda do Horizonte Artificial 3D.
//
//  Three.js + React Three Fiber + drei somam mais de 1 MB de JavaScript. No
//  bundle principal, isso e paga por TODO mundo em TODA visita — inclusive
//  pelo avaliador abrindo o painel num celular em 4G na beira do lago.
//
//  Com React.lazy o WebGL vira um chunk separado, buscado so quando uma tela
//  que realmente usa o horizonte e montada. O primeiro carregamento do painel
//  (que precisa ser rapido: e quando a equipe esta correndo para conectar o
//  barco) fica sem esse peso.
// =============================================================================

import * as React from "react";
import { IconLoader2 } from "@tabler/icons-react";

import type { ArtificialHorizonProps } from "./artificial-horizon";

const LazyHorizon = React.lazy(() => import("./artificial-horizon"));

/** Esqueleto exibido enquanto o chunk do WebGL e baixado. */
function HorizonFallback() {
  return (
    <div
      className="flex h-full w-full items-center justify-center rounded-lg border"
      style={{ background: "#0B132B", borderColor: "#1a2942" }}
    >
      <div className="flex flex-col items-center gap-2">
        <IconLoader2 className="size-6 animate-spin" style={{ color: "#48CAE4" }} />
        <span className="font-tech text-[10px] uppercase tracking-[0.2em] text-[#48CAE4]/60">
          carregando motor 3D
        </span>
      </div>
    </div>
  );
}

export function ArtificialHorizon(props: ArtificialHorizonProps) {
  return (
    <React.Suspense fallback={<HorizonFallback />}>
      <LazyHorizon {...props} />
    </React.Suspense>
  );
}
