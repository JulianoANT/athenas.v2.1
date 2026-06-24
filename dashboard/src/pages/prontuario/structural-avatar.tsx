import type { StatusData, SensorData } from "@/types/telemetry";
import { TATICA_RUDDER_DEG } from "@/lib/telemetry/contract";

// Avatar Estrutural — corte LATERAL (wireframe) do casco da Athenas. Seções
// rotuladas mudam de cor conforme os alarmes:
//  - praça de máquinas / motor (popa): vermelha se status.overheat_alert
//  - bateria: vermelha se status.battery_low (amarela em estado de atenção)
//  - leme: laranja se |sensors.rudder_deg| > 30°
// Linhas guia e contorno do casco em ciano (var(--cyan)).

const CYAN = "var(--cyan)";
const NEUTRAL = "color-mix(in oklab, var(--cyan) 16%, transparent)";

function sectionFill(color: string, opacity = 0.22) {
  return `color-mix(in oklab, ${color} ${opacity * 100}%, transparent)`;
}

export function StructuralAvatar({
  status,
  sensors,
}: {
  status: StatusData;
  sensors: SensorData;
}) {
  const overheat = status.overheat_alert;
  const batteryLow = status.battery_low;
  const rudderHigh = Math.abs(sensors.rudder_deg) > TATICA_RUDDER_DEG;

  const engineColor = overheat ? "var(--alert)" : CYAN;
  const batteryColor = batteryLow ? "var(--alert)" : CYAN;
  const rudderColor = rudderHigh ? "var(--warn)" : CYAN;

  // Inclina o leme visualmente conforme o ângulo (clamp para legibilidade).
  const rudderAngle = Math.max(-45, Math.min(45, sensors.rudder_deg));

  return (
    <svg
      viewBox="0 0 520 280"
      className="w-full"
      role="img"
      aria-label="Corte lateral estrutural do casco da Athenas"
    >
      {/* Linha d'água (guia ciano) */}
      <line
        x1={0}
        y1={96}
        x2={520}
        y2={96}
        stroke={CYAN}
        strokeWidth={1}
        strokeDasharray="6 6"
        strokeOpacity={0.5}
      />
      <text x={8} y={90} style={{ fill: CYAN, fontSize: 10, opacity: 0.7 }}>
        LINHA D&apos;ÁGUA
      </text>

      {/* Convés */}
      <line x1={70} y1={104} x2={452} y2={104} stroke={CYAN} strokeWidth={1.5} />

      {/* Contorno do casco (corte lateral). Proa à direita, popa à esquerda. */}
      <path
        d="M70 104
           L452 104
           L470 130
           C474 150 470 176 452 196
           L120 196
           C92 196 74 176 66 150
           C62 132 64 116 70 104 Z"
        fill={sectionFill(CYAN, 0.05)}
        stroke={CYAN}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Cavernas / linhas guia internas */}
      {[160, 210, 260, 310, 360, 410].map((x) => (
        <line
          key={x}
          x1={x}
          y1={106}
          x2={x}
          y2={192}
          stroke={CYAN}
          strokeWidth={0.75}
          strokeOpacity={0.18}
        />
      ))}

      {/* ---- PRAÇA DE MÁQUINAS / MOTOR (popa, esquerda) ---- */}
      <g
        className={overheat ? "animate-pulse-alert" : undefined}
        style={{ transformOrigin: "center" }}
      >
        <rect
          x={96}
          y={120}
          width={92}
          height={66}
          rx={6}
          fill={sectionFill(engineColor)}
          stroke={engineColor}
          strokeWidth={1.75}
        />
        {/* Motor (rotor estilizado) */}
        <circle
          cx={142}
          cy={153}
          r={20}
          fill="none"
          stroke={engineColor}
          strokeWidth={2}
        />
        <circle cx={142} cy={153} r={6} fill={engineColor} />
        <line
          x1={142}
          y1={133}
          x2={142}
          y2={173}
          stroke={engineColor}
          strokeWidth={1.25}
        />
        <line
          x1={122}
          y1={153}
          x2={162}
          y2={153}
          stroke={engineColor}
          strokeWidth={1.25}
        />
      </g>

      {/* ---- BATERIA (meia-nau) ---- */}
      <g>
        <rect
          x={206}
          y={132}
          width={78}
          height={50}
          rx={5}
          fill={sectionFill(batteryColor)}
          stroke={batteryColor}
          strokeWidth={1.75}
        />
        {/* Terminais */}
        <rect x={222} y={124} width={12} height={8} rx={2} fill={batteryColor} />
        <rect x={256} y={124} width={12} height={8} rx={2} fill={batteryColor} />
        {/* Células */}
        {[220, 236, 252, 268].map((x) => (
          <line
            key={x}
            x1={x}
            y1={140}
            x2={x}
            y2={174}
            stroke={batteryColor}
            strokeWidth={1.25}
            strokeOpacity={0.7}
          />
        ))}
      </g>

      {/* ---- CASCO / PORÃO (vante) — apenas guia, sempre ciano ---- */}
      <g>
        <rect
          x={300}
          y={130}
          width={138}
          height={56}
          rx={6}
          fill={sectionFill(CYAN, 0.06)}
          stroke={NEUTRAL}
          strokeWidth={1.5}
        />
      </g>

      {/* Proa */}
      <path
        d="M452 104 L470 130 C474 150 470 176 452 196"
        fill="none"
        stroke={CYAN}
        strokeWidth={2}
      />

      {/* ---- LEME (popa, abaixo do casco) ---- */}
      <g transform={`rotate(${rudderAngle} 96 196)`}>
        <rect
          x={88}
          y={196}
          width={16}
          height={52}
          rx={4}
          fill={sectionFill(rudderColor, 0.35)}
          stroke={rudderColor}
          strokeWidth={1.75}
          style={{ transition: "fill 0.2s linear, stroke 0.2s linear" }}
        />
      </g>
      <circle cx={96} cy={196} r={3.5} fill={rudderColor} />

      {/* Hélice (entre motor e leme) */}
      <g stroke={engineColor} strokeWidth={1.5} fill="none">
        <line x1={104} y1={196} x2={120} y2={196} />
        <path d="M104 196 l-7 -8 M104 196 l-7 8" />
      </g>

      {/* ---- Rótulos ---- */}
      <SectionLabel x={142} y={206} color={engineColor} text="PRAÇA DE MÁQUINAS" />
      <SectionLabel x={245} y={206} color={batteryColor} text="BATERIA" />
      <SectionLabel x={369} y={206} color={CYAN} text="CASCO / PORÃO" />
      <SectionLabel x={96} y={262} color={rudderColor} text="LEME" />
      <SectionLabel x={461} y={150} color={CYAN} text="PROA" />
    </svg>
  );
}

function SectionLabel({
  x,
  y,
  color,
  text,
}: {
  x: number;
  y: number;
  color: string;
  text: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      className="font-tech"
      style={{
        fill: color,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.5,
      }}
    >
      {text}
    </text>
  );
}
