import type { VesselHealth } from "@/types/telemetry";
import { cn } from "@/lib/utils";

// Avatar Interativo da Sereia Athenas — indicador biológico de integridade do
// sistema elétrico/térmico (Vessel Health Status):
//  - serena (verde ciano): sistema nominal estável
//  - tatica (laranja):      alto arrasto (leme > 30° ou corrente > 18A)
//  - alerta (vermelho):     sobrecarga, superaquecimento ou bateria crítica

export const HEALTH_COLOR_VAR: Record<VesselHealth, string> = {
  serena: "var(--ok)",
  tatica: "var(--warn)",
  alerta: "var(--alert)",
};

export const HEALTH_LABEL: Record<VesselHealth, string> = {
  serena: "Serena",
  tatica: "Tática",
  alerta: "Alerta",
};

export const HEALTH_DESC: Record<VesselHealth, string> = {
  serena: "Sistema nominal estável",
  tatica: "Alto arrasto detectado",
  alerta: "Sobrecarga crítica",
};

export function SereiaAvatar({
  health,
  size = 72,
  showLabel = false,
  className,
}: {
  health: VesselHealth;
  size?: number;
  showLabel?: boolean;
  className?: string;
}) {
  const color = HEALTH_COLOR_VAR[health];
  return (
    <div
      className={cn("flex flex-col items-center gap-1", className)}
      role="img"
      aria-label={`Sereia ${HEALTH_LABEL[health]}: ${HEALTH_DESC[health]}`}
      title={`${HEALTH_LABEL[health]} — ${HEALTH_DESC[health]}`}
    >
      <div
        className={cn(
          "relative flex items-center justify-center rounded-full",
          health === "tatica" && "animate-pulse",
          health === "alerta" && "animate-blink",
        )}
        style={{
          width: size,
          height: size,
          color,
          filter: `drop-shadow(0 0 ${health === "serena" ? 5 : 9}px ${color})`,
        }}
      >
        <svg
          viewBox="0 0 64 100"
          width={size}
          height={size}
          aria-hidden="true"
          style={{ overflow: "visible" }}
        >
          {/* Anel de status */}
          <circle
            cx="32"
            cy="50"
            r="30"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="1.5"
          />
          {/* Cabelo fluindo */}
          <path
            d="M22 14 C12 16 12 34 20 40 C14 36 16 22 22 18 Z"
            fill="currentColor"
            opacity="0.45"
          />
          <path
            d="M42 14 C52 16 52 34 44 40 C50 36 48 22 42 18 Z"
            fill="currentColor"
            opacity="0.45"
          />
          {/* Cabeça */}
          <circle cx="32" cy="16" r="7.5" fill="currentColor" />
          {/* Torso */}
          <path
            d="M25 22 C26 30 26 34 30 40 L34 40 C38 34 38 30 39 22 C36 26 28 26 25 22 Z"
            fill="currentColor"
          />
          {/* Cauda sinuosa + nadadeira */}
          <path
            d="M30 38
               C22 48 22 60 30 68
               C34 72 34 78 29 83
               C24 90 16 92 12 94
               C20 90 26 86 30 80
               C31 86 33 90 38 95
               C36 88 33 84 33 78
               C40 72 42 60 36 50
               C34 46 33 42 34 38 Z"
            fill="currentColor"
            opacity="0.92"
          />
        </svg>
      </div>
      {showLabel && (
        <div className="text-center leading-tight">
          <div
            className="font-tech text-xs font-medium uppercase tracking-wider"
            style={{ color }}
          >
            {HEALTH_LABEL[health]}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {HEALTH_DESC[health]}
          </div>
        </div>
      )}
    </div>
  );
}
