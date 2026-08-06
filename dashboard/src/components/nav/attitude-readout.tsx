// =============================================================================
//  AttitudeReadout — leitura numerica da cinematica naval (MPU6050)
//
//  Acompanha o horizonte artificial 3D com os valores exatos. O modelo mostra
//  a ATITUDE de forma intuitiva; esta tabela da o NUMERO, que e o que vai para
//  o relatorio tecnico e o que a banca vai perguntar.
//
//  Cada angulo tem uma barra bipolar centrada no zero — mais rapida de ler no
//  campo que um numero puro: da para ver "esta adernando para bombordo" com o
//  rabo do olho, sem processar o sinal.
// =============================================================================

import {
  IconRotate,
  IconArrowsUpDown,
  IconCompass,
  IconAlertTriangle,
} from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTelemetryStore } from "@/lib/telemetry/store";
import { useImuFault } from "@/lib/telemetry/selectors";

/** Adernamento acima disso e considerado risco de emborcar. */
const ROLL_WARN_DEG = 20;
const ROLL_ALERT_DEG = 35;
/** Escala das barras (fundo de escala em graus). */
const SCALE_DEG = 45;

function AngleBar({
  label,
  hint,
  value,
  icon,
  warnAt,
  alertAt,
  suffixLeft,
  suffixRight,
}: {
  label: string;
  hint: string;
  value: number;
  icon: React.ReactNode;
  warnAt?: number;
  alertAt?: number;
  suffixLeft: string;
  suffixRight: string;
}) {
  const abs = Math.abs(value);
  const color =
    alertAt !== undefined && abs >= alertAt
      ? "var(--alert)"
      : warnAt !== undefined && abs >= warnAt
        ? "var(--warn)"
        : "var(--cyan)";

  // Fracao da meia-barra ocupada, saturando no fundo de escala.
  const frac = Math.min(1, abs / SCALE_DEG);
  const widthPct = frac * 50;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </span>
        <span
          className="font-tech text-lg font-semibold tabular-nums leading-none"
          style={{ color }}
        >
          {value >= 0 ? "+" : "−"}
          {abs.toFixed(1)}°
        </span>
      </div>

      {/* Barra bipolar: cresce do centro para o lado do sinal. */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute top-0 h-full transition-[width,left] duration-150"
          style={{
            background: color,
            width: `${widthPct}%`,
            left: value >= 0 ? "50%" : `${50 - widthPct}%`,
          }}
        />
        {/* Marca do zero */}
        <div
          className="absolute top-0 h-full w-px"
          style={{ left: "50%", background: "var(--muted-foreground)" }}
        />
      </div>

      <div className="flex justify-between text-[9px] uppercase tracking-wide text-muted-foreground">
        <span>{suffixLeft}</span>
        <span>{hint}</span>
        <span>{suffixRight}</span>
      </div>
    </div>
  );
}

export function AttitudeReadout() {
  // Seletores primitivos: cada valor so re-renderiza quando ELE muda.
  const roll = useTelemetryStore((s) => s.frame?.imu.roll ?? 0);
  const pitch = useTelemetryStore((s) => s.frame?.imu.pitch ?? 0);
  const yaw = useTelemetryStore((s) => s.frame?.imu.yaw ?? 0);
  const fault = useImuFault();

  const rollRisk = Math.abs(roll) >= ROLL_ALERT_DEG;

  return (
    <Card className="gap-3">
      <CardHeader className="pb-0">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <IconRotate className="size-4" />
            Cinematica Naval
          </span>
          {fault ? (
            <Badge variant="alert">
              <IconAlertTriangle className="size-3" />
              IMU offline
            </Badge>
          ) : rollRisk ? (
            <Badge variant="alert">
              <IconAlertTriangle className="size-3" />
              Adernamento critico
            </Badge>
          ) : (
            <Badge variant="ok">MPU6050 ok</Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {fault && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            O MPU6050 nao respondeu no barramento I2C (SDA 21 / SCL 22). Os
            angulos abaixo sao a ultima leitura valida — o horizonte artificial
            esta congelado.
          </p>
        )}

        <AngleBar
          label="Balanco (Roll φ)"
          hint="adernamento"
          value={roll}
          icon={<IconRotate className="size-3.5" />}
          warnAt={ROLL_WARN_DEG}
          alertAt={ROLL_ALERT_DEG}
          suffixLeft="bombordo"
          suffixRight="estibordo"
        />

        <AngleBar
          label="Cabeceio (Pitch θ)"
          hint="caturro"
          value={pitch}
          icon={<IconArrowsUpDown className="size-3.5" />}
          warnAt={15}
          alertAt={28}
          suffixLeft="proa abaixo"
          suffixRight="proa acima"
        />

        {/* A guinada e integracao pura do giroscopio (sem magnetometro), entao
            deriva alguns graus por minuto. Deixamos isso explicito para
            ninguem confundi-la com o rumo de navegacao. */}
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <IconCompass className="size-3.5" />
            Guinada (Yaw ψ)
          </span>
          <div className="text-right">
            <span className="font-tech text-lg font-semibold tabular-nums leading-none">
              {(((yaw % 360) + 360) % 360).toFixed(0)}°
            </span>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              inercial · sujeito a deriva
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
