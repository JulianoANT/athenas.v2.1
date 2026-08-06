// =============================================================================
//  CompassRose — Bussola vetorial dinamica (substitui o rumo numerico)
//
//  DUAS PECAS QUE GIRAM DE FORMA INDEPENDENTE, como numa bussola de bitacula:
//
//   1. A ROSA (o "cartao"): gira pelo RUMO VERDADEIRO sobre o fundo. Usamos
//      display "heading-up" — a proa fica sempre no topo, sob a linha de fe,
//      e o mundo gira em volta. E assim que uma carta nautica e lida a bordo.
//         rotacao da rosa = −rumo_verdadeiro
//
//   2. A AGULHA: aponta para o NORTE MAGNETICO, nao para o geografico. A
//      diferenca entre os dois e a DECLINACAO MAGNETICA (D) do local:
//         azimute verdadeiro do norte magnetico = D
//         angulo na tela da agulha = D − rumo_verdadeiro
//
//  Por que isso importa: o COG do Neo-6M e referenciado ao NORTE VERDADEIRO
//  (ele deriva da posicao, nao de um magnetometro). Uma bussola de mao a bordo
//  aponta para o NORTE MAGNETICO. Sem exibir as duas referencias, a equipe em
//  terra e a equipe no barco discutem rumos diferentes com o mesmo numero.
//
//  PERFORMANCE: nenhum estado do React e atualizado a 5 Hz. O componente se
//  inscreve no store fora do ciclo de render e muta o atributo `transform` dos
//  grupos SVG direto no DOM.
// =============================================================================

import * as React from "react";

import { useTelemetryStore } from "@/lib/telemetry/store";
import {
  MAGNETIC_DECLINATION_DEG,
  compassPoint,
  trueToMagnetic,
} from "@/lib/math/hydrodynamics";
import { cn } from "@/lib/utils";

const SIZE = 220;
const CENTER = SIZE / 2;
const ROSE_RADIUS = 92;
const TICK_OUTER = 88;

const CARDINALS = [
  { label: "N", deg: 0 },
  { label: "E", deg: 90 },
  { label: "S", deg: 180 },
  { label: "O", deg: 270 },
] as const;

const INTERCARDINALS = [
  { label: "NE", deg: 45 },
  { label: "SE", deg: 135 },
  { label: "SO", deg: 225 },
  { label: "NO", deg: 315 },
] as const;

/** Coordenada cartesiana de um ponto na rosa (0° = topo, sentido horario). */
function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(rad),
    y: CENTER + radius * Math.sin(rad),
  };
}

export interface CompassRoseProps {
  /** Declinacao magnetica local em graus (leste positivo). */
  declination?: number;
  size?: number;
  className?: string;
}

export function CompassRose({
  declination = MAGNETIC_DECLINATION_DEG,
  size = SIZE,
  className,
}: CompassRoseProps) {
  const roseRef = React.useRef<SVGGElement>(null);
  const needleRef = React.useRef<SVGGElement>(null);
  const trueLabelRef = React.useRef<SVGTextElement>(null);
  const pointLabelRef = React.useRef<SVGTextElement>(null);
  const magLabelRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    // Aplicacao imperativa: chamada a 5 Hz sem passar pelo React.
    const apply = (cog: number) => {
      const heading = ((cog % 360) + 360) % 360;

      roseRef.current?.setAttribute(
        "transform",
        `rotate(${-heading} ${CENTER} ${CENTER})`,
      );
      needleRef.current?.setAttribute(
        "transform",
        `rotate(${declination - heading} ${CENTER} ${CENTER})`,
      );

      if (trueLabelRef.current) {
        trueLabelRef.current.textContent = `${Math.round(heading)
          .toString()
          .padStart(3, "0")}°`;
      }
      if (pointLabelRef.current) {
        pointLabelRef.current.textContent = compassPoint(heading);
      }
      if (magLabelRef.current) {
        magLabelRef.current.textContent = `${Math.round(
          trueToMagnetic(heading, declination),
        )
          .toString()
          .padStart(3, "0")}° M`;
      }
    };

    apply(useTelemetryStore.getState().cog);
    return useTelemetryStore.subscribe((s) => s.cog, apply);
  }, [declination]);

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        style={{ maxWidth: size }}
        role="img"
        aria-label="Bussola: rumo verdadeiro e norte magnetico"
      >
        {/* --- Bisel fixo --- */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ROSE_RADIUS + 12}
          fill="var(--card)"
          stroke="color-mix(in oklab, var(--cyan) 30%, transparent)"
          strokeWidth={1.5}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ROSE_RADIUS + 2}
          fill="none"
          stroke="color-mix(in oklab, var(--cyan) 16%, transparent)"
        />

        {/* --- ROSA: gira pelo rumo verdadeiro --- */}
        <g
          ref={roseRef}
          style={{ transition: "transform 180ms linear" }}
          transform={`rotate(0 ${CENTER} ${CENTER})`}
        >
          {/* Marcas de grau: a cada 5°, mais longas a cada 30° */}
          {Array.from({ length: 72 }, (_, i) => i * 5).map((deg) => {
            const major = deg % 30 === 0;
            const inner = TICK_OUTER - (major ? 14 : 7);
            const a = polar(deg, TICK_OUTER);
            const b = polar(deg, inner);
            return (
              <line
                key={deg}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={major ? "var(--cyan)" : "var(--muted-foreground)"}
                strokeOpacity={major ? 0.8 : 0.45}
                strokeWidth={major ? 1.6 : 1}
              />
            );
          })}

          {/* Pontos colaterais */}
          {INTERCARDINALS.map(({ label, deg }) => {
            const p = polar(deg, TICK_OUTER - 28);
            return (
              <text
                key={label}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fill: "var(--muted-foreground)",
                  fontSize: 9,
                  letterSpacing: "0.05em",
                }}
              >
                {label}
              </text>
            );
          })}

          {/* Pontos cardeais — N destacado */}
          {CARDINALS.map(({ label, deg }) => {
            const p = polar(deg, TICK_OUTER - 26);
            const isNorth = deg === 0;
            return (
              <text
                key={label}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fill: isNorth ? "var(--cyan)" : "var(--foreground)",
                  fontSize: isNorth ? 15 : 13,
                  fontWeight: 700,
                }}
              >
                {label}
              </text>
            );
          })}
        </g>

        {/* --- AGULHA MAGNETICA: aponta para o Norte Magnetico --- */}
        <g
          ref={needleRef}
          style={{ transition: "transform 180ms linear" }}
          transform={`rotate(0 ${CENTER} ${CENTER})`}
        >
          {/* Ponta norte (vermelha, como toda agulha magnetica) */}
          <path
            d={`M ${CENTER} ${CENTER - 58} L ${CENTER - 7} ${CENTER} L ${CENTER + 7} ${CENTER} Z`}
            fill="#EF476F"
          />
          {/* Ponta sul */}
          <path
            d={`M ${CENTER} ${CENTER + 46} L ${CENTER - 6} ${CENTER} L ${CENTER + 6} ${CENTER} Z`}
            fill="var(--muted-foreground)"
            fillOpacity={0.65}
          />
        </g>

        {/* Pivo central */}
        <circle cx={CENTER} cy={CENTER} r={5} fill="var(--card)" />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={5}
          fill="none"
          stroke="var(--cyan)"
          strokeWidth={1.5}
        />

        {/* --- LINHA DE FE (lubber line): marca fixa da proa, no topo --- */}
        <path
          d={`M ${CENTER} ${CENTER - ROSE_RADIUS - 14}
              L ${CENTER - 9} ${CENTER - ROSE_RADIUS + 2}
              L ${CENTER + 9} ${CENTER - ROSE_RADIUS + 2} Z`}
          fill="var(--cyan)"
        />

        {/* --- Leitura digital do rumo verdadeiro --- */}
        <text
          ref={trueLabelRef}
          x={CENTER}
          y={CENTER + 30}
          textAnchor="middle"
          className="font-tech"
          style={{ fill: "var(--cyan)", fontSize: 26, fontWeight: 700 }}
        >
          000°
        </text>
        <text
          ref={pointLabelRef}
          x={CENTER}
          y={CENTER + 48}
          textAnchor="middle"
          style={{
            fill: "var(--muted-foreground)",
            fontSize: 11,
            letterSpacing: "0.12em",
          }}
        >
          N
        </text>
      </svg>

      {/* Legenda das duas referencias */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--cyan)" }}
          />
          Verdadeiro (GPS)
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "#EF476F" }}
          />
          <span ref={magLabelRef} className="font-tech tabular-nums">
            000° M
          </span>
        </span>
        <span className="font-tech">
          Var. {declination >= 0 ? "E" : "O"}{" "}
          {Math.abs(declination).toFixed(1)}°
        </span>
      </div>
    </div>
  );
}
