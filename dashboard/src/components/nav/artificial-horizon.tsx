// =============================================================================
//  ArtificialHorizon — Horizonte Artificial 3D (atitude do casco)
//
//  Renderiza um modelo wireframe da embarcacao reagindo em tempo real aos
//  angulos de Euler do MPU6050.
//
//  A REGRA ARQUITETURAL QUE GOVERNA ESTE ARQUIVO:
//  E PROIBIDO usar useState para animar a rotacao. Nada de
//  `setRotation(...)` a 5 Hz — isso re-renderizaria a arvore React inteira
//  cinco vezes por segundo para mover uma matriz 4x4 que a GPU ja saberia
//  interpolar sozinha.
//
//  Em vez disso, `useFrame` (loop nativo de animacao, 60 FPS) le o estado
//  direto do store com `getState()` — uma leitura SEM assinatura, que nao
//  agenda render nenhum — e muta `meshRef.current.rotation` na mao. O DOM
//  virtual fica intacto; so a GPU trabalha.
//
//  CONVENCAO DE EIXOS (Three.js, mao direita, Y para cima):
//    - eixo X do Three  <- PITCH (caturro: proa sobe/desce)
//    - eixo Y do Three  <- YAW   (guinada: mudanca de rumo)
//    - eixo Z do Three  <- ROLL  (adernamento: bombordo/estibordo)
//  O sinal do roll e invertido para que o modelo tombe para o MESMO lado que
//  o barco real visto de re.
// =============================================================================

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import { useTelemetryStore } from "@/lib/telemetry/store";

// --- Identidade visual (Dark Mode Naval) ---
const CYAN = "#48CAE4";
const NAVY = "#0B132B";
const GRID = "#1a2942";
const ALERT = "#EF476F";

const DEG_TO_RAD = Math.PI / 180;

/**
 * Fator de suavizacao da interpolacao entre quadros de telemetria.
 *
 * A telemetria chega a 5 Hz mas o WebGL desenha a 60 FPS. Sem interpolacao o
 * casco andaria aos saltos, um degrau a cada 200 ms. Aqui aplicamos um
 * amortecimento exponencial rumo ao alvo — o resultado e um movimento continuo
 * que parece um giroscopio de verdade, nao uma animacao de slides.
 */
const SMOOTHING = 0.18;

/** Interpola angulos pelo caminho mais curto (evita o salto 359° -> 0°). */
function lerpAngle(current: number, target: number, t: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}

// -----------------------------------------------------------------------------
//  Casco: agrupamento de primitivas formando a silhueta de uma embarcacao.
// -----------------------------------------------------------------------------
function HullModel() {
  const groupRef = React.useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    // Leitura DIRETA do store, sem assinatura e sem re-render do React.
    const frame = useTelemetryStore.getState().frame;
    if (!frame) return;

    const { roll, pitch, yaw } = frame.imu;

    // Conversao de GRAUS (telemetria) para RADIANOS (WebGL opera em radianos).
    const targetX = pitch * DEG_TO_RAD;
    const targetZ = -roll * DEG_TO_RAD; // negativo para refletir o realismo
    const targetY = yaw * DEG_TO_RAD;

    group.rotation.x = lerpAngle(group.rotation.x, targetX, SMOOTHING);
    group.rotation.z = lerpAngle(group.rotation.z, targetZ, SMOOTHING);
    group.rotation.y = lerpAngle(group.rotation.y, targetY, SMOOTHING);
  });

  return (
    <group ref={groupRef}>
      {/* Casco principal — bloco afilado representando o corpo submerso */}
      <mesh>
        <boxGeometry args={[1.6, 0.45, 4]} />
        <meshBasicMaterial
          color={CYAN}
          wireframe
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Proa: cone deitado apontando para +Z (frente da embarcacao) */}
      <mesh position={[0, 0, 2.35]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.8, 1.4, 4]} />
        <meshBasicMaterial color={CYAN} wireframe transparent opacity={0.9} />
      </mesh>

      {/* Convés / superestrutura */}
      <mesh position={[0, 0.4, -0.3]}>
        <boxGeometry args={[1.0, 0.35, 1.6]} />
        <meshBasicMaterial color={CYAN} wireframe transparent opacity={0.55} />
      </mesh>

      {/* Mastro — referencia visual do "para cima" do casco */}
      <mesh position={[0, 0.95, -0.3]}>
        <cylinderGeometry args={[0.04, 0.04, 0.8, 6]} />
        <meshBasicMaterial color={CYAN} wireframe />
      </mesh>

      {/* Marcador de proa em cor de alerta: sem ele, de certos angulos e
          impossivel dizer se o barco esta de proa ou de popa para a camera. */}
      <mesh position={[0, 0.1, 3.05]}>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshBasicMaterial color={ALERT} wireframe />
      </mesh>
    </group>
  );
}

// -----------------------------------------------------------------------------
//  Plano d'agua: referencia FIXA. E ele que revela a atitude — sem um
//  horizonte estatico o cerebro nao consegue julgar quanto o casco adernou.
// -----------------------------------------------------------------------------
function WaterPlane() {
  return (
    <group position={[0, -0.9, 0]}>
      <gridHelper
        args={[16, 16, CYAN, GRID]}
        // gridHelper ja nasce no plano XZ; so precisamos das cores.
      />
    </group>
  );
}

/** Eixos de referencia do referencial do mundo (Norte / vertical). */
function ReferenceAxes() {
  return (
    <group>
      {/* Linha do eixo longitudinal (proa-popa) do referencial fixo */}
      <mesh position={[0, -0.88, 0]}>
        <boxGeometry args={[0.02, 0.01, 14]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.35} />
      </mesh>
      {/* Linha do eixo transversal (bombordo-estibordo) */}
      <mesh position={[0, -0.88, 0]}>
        <boxGeometry args={[14, 0.01, 0.02]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

// Reexportado como default para permitir o carregamento sob demanda via
// React.lazy — ver ./artificial-horizon-lazy.tsx.
export interface ArtificialHorizonProps {
  /** Altura do canvas. Aceita qualquer unidade CSS. */
  height?: string | number;
  /** Permite girar a camera com o mouse/toque. */
  interactive?: boolean;
  className?: string;
}

/**
 * Componente Canvas exportado para o grid do dashboard.
 *
 * `frameloop="always"` e intencional: o amortecimento exponencial precisa de
 * quadros continuos para convergir suavemente. O custo e baixo — a cena tem
 * poucas centenas de vertices em wireframe.
 */
export const ArtificialHorizon: React.FC<ArtificialHorizonProps> = ({
  height = "100%",
  interactive = true,
  className,
}) => {
  return (
    <div
      className={className}
      style={{
        width: "100%",
        height,
        background: NAVY,
        borderRadius: "0.5rem",
        overflow: "hidden",
        border: `1px solid ${GRID}`,
      }}
    >
      <Canvas
        // Camera em perspectiva isometrica de 45°: e o unico angulo em que
        // ROLL e PITCH sao legiveis ao mesmo tempo. De frente some o caturro;
        // de lado some o adernamento.
        camera={{ position: [5, 3, 5], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.5} />
        <WaterPlane />
        <ReferenceAxes />
        <HullModel />
        {interactive && (
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            // Trava o angulo vertical: sem isso e facil acabar olhando o barco
            // por baixo d'agua, o que nao ajuda ninguem.
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2.1}
            rotateSpeed={0.6}
          />
        )}
      </Canvas>
    </div>
  );
};

export default ArtificialHorizon;
