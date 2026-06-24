import { OVERHEAT_C } from "@/lib/telemetry/contract";

// Termômetro digital vertical do estator (DS18B20). Coluna de mercúrio
// proporcional à temperatura, escala 0–100 °C com marca de superaquecimento em
// 70 °C. Acima do limiar a coluna fica vermelha (var(--alert)).

const T_MIN = 0;
const T_MAX = 100;

// Geometria do tubo (coordenadas SVG).
const TUBE_X = 78;
const TUBE_W = 26;
const TUBE_TOP = 24;
const TUBE_BOTTOM = 268;
const TUBE_H = TUBE_BOTTOM - TUBE_TOP;
const BULB_CY = 296;
const BULB_R = 26;

function yForTemp(t: number): number {
  const frac = Math.max(0, Math.min(1, (t - T_MIN) / (T_MAX - T_MIN)));
  return TUBE_BOTTOM - frac * TUBE_H;
}

export function Thermometer({ temp }: { temp: number }) {
  const over = temp >= OVERHEAT_C;
  const color = over ? "var(--alert)" : "var(--cyan)";
  const fillTop = yForTemp(temp);
  const overheatY = yForTemp(OVERHEAT_C);

  // Marcas a cada 10 °C com rótulos a cada 20 °C.
  const ticks: number[] = [];
  for (let t = T_MIN; t <= T_MAX; t += 10) ticks.push(t);

  return (
    <svg
      viewBox="0 0 200 336"
      className="h-full w-full max-h-[360px]"
      role="img"
      aria-label={`Termômetro do estator: ${temp.toFixed(1)} graus Celsius`}
    >
      {/* Trilho do tubo (fundo) */}
      <rect
        x={TUBE_X}
        y={TUBE_TOP}
        width={TUBE_W}
        height={TUBE_H + 8}
        rx={TUBE_W / 2}
        fill="var(--muted)"
        stroke="color-mix(in oklab, var(--cyan) 35%, transparent)"
        strokeWidth={1.5}
      />

      {/* Coluna preenchida (mercúrio) */}
      <rect
        x={TUBE_X}
        y={fillTop}
        width={TUBE_W}
        height={TUBE_BOTTOM - fillTop + 10}
        rx={TUBE_W / 2}
        fill={color}
        style={{
          transition: "y 0.25s ease, height 0.25s ease, fill 0.2s linear",
          filter: `drop-shadow(0 0 6px ${color})`,
        }}
      />

      {/* Bulbo */}
      <circle
        cx={TUBE_X + TUBE_W / 2}
        cy={BULB_CY}
        r={BULB_R}
        fill={color}
        style={{ filter: `drop-shadow(0 0 8px ${color})` }}
      />

      {/* Linha de superaquecimento (70 °C) */}
      <line
        x1={TUBE_X - 10}
        y1={overheatY}
        x2={TUBE_X + TUBE_W + 64}
        y2={overheatY}
        stroke="var(--alert)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text
        x={TUBE_X + TUBE_W + 18}
        y={overheatY - 6}
        style={{ fill: "var(--alert)", fontSize: 11, fontWeight: 600 }}
      >
        70 °C MÁX
      </text>

      {/* Escala */}
      {ticks.map((t) => {
        const y = yForTemp(t);
        const labeled = t % 20 === 0;
        return (
          <g key={t}>
            <line
              x1={TUBE_X - (labeled ? 14 : 8)}
              y1={y}
              x2={TUBE_X - 2}
              y2={y}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
            />
            {labeled && (
              <text
                x={TUBE_X - 18}
                y={y + 4}
                textAnchor="end"
                style={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              >
                {t}
              </text>
            )}
          </g>
        );
      })}

      {/* Leitura digital grande */}
      <text
        x={154}
        y={150}
        textAnchor="middle"
        className="font-tech"
        style={{ fill: color, fontSize: 40, fontWeight: 700 }}
      >
        {temp.toFixed(1)}
      </text>
      <text
        x={154}
        y={172}
        textAnchor="middle"
        style={{ fill: "var(--muted-foreground)", fontSize: 14 }}
      >
        °C
      </text>
    </svg>
  );
}
