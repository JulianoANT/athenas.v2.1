// Aba 3 — Prontuário & Diagnósticos (Controle de Danos Térmicos + Avatar
// Estrutural). Rota crew-only. Monitora o estator (DS18B20): em
// superaquecimento (>= 70 °C) o painel entra em emergência visual e dispara um
// alarme sonoro contínuo (Web Audio API) após o usuário armá-lo.
import {
  IconTemperature,
  IconVolume,
  IconVolumeOff,
  IconBellRinging,
  IconBolt,
  IconBattery,
  IconPlant,
  IconShieldCheck,
  IconAlertTriangle,
  IconActivity,
  IconSteeringWheel,
} from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MetricCard } from "@/components/metric-card";
import { SereiaAvatar } from "@/components/sereia";
import { AlertBanner } from "@/components/alert-banner";
import { useTelemetry } from "@/lib/telemetry/provider";
import { OVERHEAT_C, TATICA_RUDDER_DEG } from "@/lib/telemetry/contract";
import { cn } from "@/lib/utils";

import { Thermometer } from "./thermometer";
import { StructuralAvatar } from "./structural-avatar";
import { useThermalAlarm } from "./use-thermal-alarm";

export default function Prontuario() {
  const { frame, health } = useTelemetry();

  const sensors = frame?.sensors ?? {
    current_a: 0,
    voltage_v: 0,
    temp_c: 0,
    rudder_deg: 0,
  };
  const status = frame?.status ?? {
    algae_alert: false,
    overheat_alert: false,
    battery_low: false,
  };

  const overheat = sensors.temp_c >= OVERHEAT_C || status.overheat_alert;
  const rudderHigh = Math.abs(sensors.rudder_deg) > TATICA_RUDDER_DEG;

  const alarm = useThermalAlarm(overheat);

  return (
    <div className="space-y-6">
      {/* Banner de emergência térmica */}
      {overheat && (
        <AlertBanner
          variant="alert"
          title="Superaquecimento do estator"
          icon={<IconAlertTriangle className="size-5" />}
          message={
            <>
              Temperatura em {sensors.temp_c.toFixed(1)} °C — acima do limiar de{" "}
              {OVERHEAT_C} °C. Reduza a carga do motor imediatamente.
              {alarm.armed
                ? alarm.muted
                  ? " Alarme sonoro silenciado."
                  : " Alarme sonoro ativo."
                : " Arme o alarme sonoro para alerta audível."}
            </>
          }
        />
      )}

      {/* Badges de status */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={overheat ? "alert" : "ok"}>
          {overheat ? (
            <IconAlertTriangle className="size-3" />
          ) : (
            <IconShieldCheck className="size-3" />
          )}
          Térmico {overheat ? "crítico" : "nominal"}
        </Badge>
        <Badge variant={status.battery_low ? "alert" : "ok"}>
          <IconBattery className="size-3" />
          Bateria {status.battery_low ? "crítica" : "ok"}
        </Badge>
        <Badge variant={status.algae_alert ? "warn" : "muted"}>
          <IconPlant className="size-3" />
          Algas {status.algae_alert ? "detectadas" : "livre"}
        </Badge>
        <Badge variant={rudderHigh ? "warn" : "muted"}>
          <IconSteeringWheel className="size-3" />
          Leme {rudderHigh ? "carregado" : "nominal"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --- Controle de Danos Térmicos --- */}
        <Card
          className={cn(
            "transition-colors",
            overheat && "animate-pulse-alert",
          )}
          style={
            overheat
              ? {
                  borderColor: "var(--alert)",
                  background:
                    "color-mix(in oklab, var(--alert) 8%, var(--card))",
                }
              : undefined
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconTemperature className="size-4" />
              Controle de Danos Térmicos
            </CardTitle>
            <CardDescription>
              Estator (DS18B20) — emergência em {OVERHEAT_C} °C
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-stretch gap-4">
              <div className="w-1/2 shrink-0">
                <Thermometer temp={sensors.temp_c} />
              </div>
              <div className="flex w-1/2 flex-col justify-center gap-3">
                <div
                  className="font-tech text-5xl font-bold leading-none"
                  style={{
                    color: overheat ? "var(--alert)" : "var(--cyan)",
                  }}
                >
                  {sensors.temp_c.toFixed(1)}
                  <span className="ml-1 align-super text-xl text-muted-foreground">
                    °C
                  </span>
                </div>
                <div
                  className="font-tech text-sm font-medium uppercase tracking-wide"
                  style={{
                    color: overheat ? "var(--alert)" : "var(--ok)",
                  }}
                >
                  {overheat ? "Superaquecimento" : "Dentro da faixa"}
                </div>

                <Separator className="my-1" />

                {/* Controles do alarme sonoro */}
                <div className="flex flex-col gap-2">
                  {!alarm.armed ? (
                    <Button
                      variant="default"
                      size="lg"
                      onClick={alarm.arm}
                      className="justify-start"
                    >
                      <IconBellRinging className="size-4" />
                      Armar alarme sonoro
                    </Button>
                  ) : (
                    <Button
                      variant={alarm.muted ? "secondary" : "outline"}
                      size="lg"
                      onClick={alarm.toggleMute}
                      className="justify-start"
                    >
                      {alarm.muted ? (
                        <IconVolumeOff className="size-4" />
                      ) : (
                        <IconVolume className="size-4" />
                      )}
                      {alarm.muted ? "Reativar som" : "Silenciar"}
                    </Button>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {!alarm.armed
                      ? "O navegador exige um gesto para liberar áudio."
                      : alarm.sounding
                        ? "Sirene ativa enquanto durar o superaquecimento."
                        : alarm.muted
                          ? "Som silenciado pela tripulação."
                          : "Armado — soará ao atingir o limiar."}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* --- Avatar Estrutural (Wireframe) --- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconActivity className="size-4" />
              Avatar Estrutural — Corte Lateral
            </CardTitle>
            <CardDescription>
              Diagnóstico por seção do casco (alarmes em tempo real)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg panel-grid p-2">
              <StructuralAvatar status={status} sensors={sensors} />
            </div>
            <div className="flex items-center justify-between">
              <SereiaAvatar health={health} size={56} showLabel />
              <div className="text-right text-xs text-muted-foreground">
                <div>
                  Praça de máquinas:{" "}
                  <span
                    style={{
                      color: status.overheat_alert
                        ? "var(--alert)"
                        : "var(--ok)",
                    }}
                  >
                    {status.overheat_alert ? "superaquecida" : "nominal"}
                  </span>
                </div>
                <div>
                  Bateria:{" "}
                  <span
                    style={{
                      color: status.battery_low ? "var(--alert)" : "var(--ok)",
                    }}
                  >
                    {status.battery_low ? "crítica" : "nominal"}
                  </span>
                </div>
                <div>
                  Leme:{" "}
                  <span
                    style={{
                      color: rudderHigh ? "var(--warn)" : "var(--ok)",
                    }}
                  >
                    {rudderHigh ? "carregado" : "nominal"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- Leitura numérica do estator --- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Temperatura"
          value={sensors.temp_c.toFixed(1)}
          unit="°C"
          icon={<IconTemperature className="size-4" />}
          valueColor={overheat ? "var(--alert)" : undefined}
          hint={`Limiar ${OVERHEAT_C} °C`}
        />
        <MetricCard
          label="Corrente"
          value={sensors.current_a.toFixed(1)}
          unit="A"
          icon={<IconBolt className="size-4" />}
          hint="Motor (ACS758)"
        />
        <MetricCard
          label="Tensão"
          value={sensors.voltage_v.toFixed(2)}
          unit="V"
          icon={<IconBattery className="size-4" />}
          valueColor={status.battery_low ? "var(--alert)" : undefined}
        />
        <MetricCard
          label="Leme"
          value={sensors.rudder_deg.toFixed(0)}
          unit="°"
          icon={<IconSteeringWheel className="size-4" />}
          valueColor={rudderHigh ? "var(--warn)" : undefined}
          hint={`Limiar ±${TATICA_RUDDER_DEG}°`}
        />
      </div>
    </div>
  );
}
