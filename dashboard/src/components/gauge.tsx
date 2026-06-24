import { cn } from "@/lib/utils";

// Gauge semicircular (velocímetro náutico). Arco superior de 180° preenchido
// proporcionalmente ao valor, com leitura central. Convenção de ângulo:
// 0° = topo, sentido horário (canônico para mostradores).

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function RadialGauge({
  value,
  min = 0,
  max = 100,
  unit,
  label,
  valueColor = "var(--primary)",
  decimals = 1,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  label?: string;
  valueColor?: string;
  decimals?: number;
  className?: string;
}) {
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const START = -90;
  const END = 90;
  const valEnd = START + (END - START) * frac;
  const cx = 100;
  const cy = 100;
  const r = 78;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg viewBox="0 0 200 124" className="w-full max-w-[260px]">
        <path
          d={describeArc(cx, cy, r, START, END)}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {frac > 0.001 && (
          <path
            d={describeArc(cx, cy, r, START, valEnd)}
            fill="none"
            stroke={valueColor}
            strokeWidth="14"
            strokeLinecap="round"
          />
        )}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="font-tech"
          style={{ fill: valueColor, fontSize: 34, fontWeight: 600 }}
        >
          {value.toFixed(decimals)}
        </text>
        {unit && (
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            style={{ fill: "var(--muted-foreground)", fontSize: 13 }}
          >
            {unit}
          </text>
        )}
      </svg>
      {label && (
        <div className="-mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
    </div>
  );
}
