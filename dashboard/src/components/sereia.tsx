import sereiaMask from "@/assets/sereia-mask.png";
import type { VesselHealth } from "@/types/telemetry";
import { cn } from "@/lib/utils";
import { HEALTH_COLOR_VAR, HEALTH_LABEL, HEALTH_DESC } from "@/lib/health";

// =============================================================================
//  Sereia Athenas — indicador de integridade da embarcação (Vessel Health)
//
//  O avatar é a SEREIA DA LOGO OFICIAL do projeto, não um desenho paralelo.
//  Ter duas sereias diferentes no mesmo sistema (uma na marca, outra no painel)
//  enfraqueceria a identidade justamente na tela que a banca mais olha.
//
//  COMO A COR FUNCIONA:
//  A logo é uma silhueta. Em vez de manter três arquivos coloridos, usamos a
//  silhueta como MÁSCARA CSS e pintamos com `background-color`. Assim a cor
//  vem das variáveis do tema — acompanha os modos Sol/Noite de graça, e trocar
//  a logo no futuro não exige regerar variação nenhuma.
//
//  Estados:
//   - serena (verde):    sistema nominal estável
//   - tatica (laranja):  alto arrasto (leme > 30° ou corrente > 18 A)
//   - alerta (vermelho): sobrecarga, superaquecimento ou bateria crítica
// =============================================================================

// As constantes vivem em @/lib/health para o Fast Refresh funcionar aqui
// (este arquivo exporta APENAS componentes).

/** Proporção da arte da sereia (recortada da logo oficial): 360 × 565. */
const ASPECT = 360 / 565;

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

  // `size` é a ALTURA; a largura sai da proporção da arte. Assim a sereia nunca
  // distorce, independente de onde o componente é usado.
  const height = size;
  const width = Math.round(size * ASPECT);

  return (
    <div
      className={cn("flex flex-col items-center gap-1.5", className)}
      role="img"
      aria-label={`Sereia ${HEALTH_LABEL[health]}: ${HEALTH_DESC[health]}`}
      title={`${HEALTH_LABEL[health]} — ${HEALTH_DESC[health]}`}
    >
      <div
        className={cn(
          "relative flex items-center justify-center",
          // A pulsação carrega significado: parada = nominal, pulsando =
          // atenção, piscando = crítico. Dá para ler o estado com o rabo do
          // olho, sem processar a cor.
          health === "tatica" && "animate-pulse",
          health === "alerta" && "animate-blink",
        )}
        style={{ width, height }}
      >
        {/* Halo de fundo — reforça o estado sem competir com a silhueta. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-full"
          style={{
            background: `radial-gradient(circle, color-mix(in oklab, ${color} 22%, transparent) 0%, transparent 68%)`,
          }}
        />

        {/* A sereia da logo, pintada pela cor do estado via máscara CSS. */}
        <div
          style={{
            width,
            height,
            backgroundColor: color,
            WebkitMaskImage: `url(${sereiaMask})`,
            maskImage: `url(${sereiaMask})`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            filter: `drop-shadow(0 0 ${health === "serena" ? 5 : 10}px ${color})`,
            // SEM TRANSICAO — de proposito, e isto NAO e detalhe estetico.
            //
            // Com `transition: background-color`, o navegador congela a cor
            // resolvida no inicio da animacao e nao a reavalia quando o var()
            // passa a apontar para OUTRA variavel (--ok -> --alert). O
            // resultado observado em teste: a sereia continuava VERDE durante
            // um alerta critico, com o style inline correto em `var(--alert)`.
            //
            // Um indicador de emergencia que mostra a cor errada e pior que
            // indicador nenhum. A mudanca de estado deve ser instantanea; quem
            // carrega a sensacao de urgencia sao as animacoes de pulso e
            // piscada no elemento pai.
          }}
        />
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
