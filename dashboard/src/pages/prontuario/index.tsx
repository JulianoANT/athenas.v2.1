// =============================================================================
//  ABA 3 — Prontuario & Diagnosticos (rota crew-only)
//
//  Controle de Danos Termicos com Gemeo Digital, avatar estrutural do casco,
//  diagnostico da atitude (MPU6050) e painel de saude dos sensores.
//
//  Em superaquecimento (>= 70 °C) o painel entra em emergencia visual e dispara
//  um alarme sonoro continuo (Web Audio API) apos a tripulacao arma-lo.
// =============================================================================

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
  IconDroplet,
  IconSatellite,
  IconRotate,
  IconPlugConnected,
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
import { ThermalTwin } from "@/components/thermal/thermal-twin";
import { ThermalCalibrationPanel } from "@/components/thermal/thermal-calibration-panel";
import { ArtificialHorizon } from "@/components/nav/artificial-horizon-lazy";
import { AttitudeReadout } from "@/components/nav/attitude-readout";
import { useTelemetryStore } from "@/lib/telemetry/store";
import {
  useHealth,
  useMotorTemp,
  useCurrent,
  useVoltage,
  useRudder,
  useAmbientTemp,
  useAmbientHumidity,
  useAlgaeAlert,
  useBatteryLow,
  useGpsFault,
  useImuFault,
  useMotorTempFault,
  useAmbientFault,
  useVirtualCoreTemp,
} from "@/lib/telemetry/selectors";
import { OVERHEAT_C, TATICA_RUDDER_DEG } from "@/lib/telemetry/contract";
import { cn } from "@/lib/utils";

import { Thermometer } from "./thermometer";
import { StructuralAvatar } from "./structural-avatar";
import { useThermalAlarm } from "./use-thermal-alarm";

// -----------------------------------------------------------------------------
//  Painel de saude dos sensores.
//
//  A Diretriz exige "Tratamento de Dados Fantasmas": o firmware nunca envia
//  leitura corrompida — ele retem o ultimo valor valido e levanta uma flag.
//  Esta tabela e onde essas flags viram informacao acionavel para a tripulacao:
//  saber QUE sensor caiu e a diferenca entre um diagnostico e um chute.
// -----------------------------------------------------------------------------
function SensorHealthPanel() {
  const gps = useGpsFault();
  const imu = useImuFault();
  const motorTemp = useMotorTempFault();
  const ambient = useAmbientFault();
  const dropped = useTelemetryStore((s) => s.droppedFrames);
  const malformed = useTelemetryStore((s) => s.malformedFrames);

  const sensors = [
    {
      label: "GPS Neo-6M",
      hint: "UART2 · GPIO 16/17",
      fault: gps,
      icon: <IconSatellite className="size-4" />,
      faultHint: "sem fix valido ou dado com mais de 1,5 s",
    },
    {
      label: "MPU6050",
      hint: "I2C · SDA 21 / SCL 22",
      fault: imu,
      icon: <IconRotate className="size-4" />,
      faultHint: "sem resposta no barramento I2C",
    },
    {
      label: "DS18B20 (estator)",
      hint: "1-Wire · GPIO 4 (pull-up 4k7)",
      fault: motorTemp,
      icon: <IconTemperature className="size-4" />,
      faultHint: "retornou -127 °C ou 85 °C (erro de barramento)",
    },
    {
      label: "DHT22 (ambiente)",
      hint: "Digital · GPIO 15",
      fault: ambient,
      icon: <IconDroplet className="size-4" />,
      faultHint: "leitura NaN (falha de timing ou conector)",
    },
  ];

  const faultCount = sensors.filter((s) => s.fault).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <IconPlugConnected className="size-4" />
            Saude dos Sensores
          </span>
          <Badge variant={faultCount === 0 ? "ok" : "warn"}>
            {faultCount === 0
              ? "Todos nominais"
              : `${faultCount} em falha`}
          </Badge>
        </CardTitle>
        <CardDescription>
          Flags de "Sensor Fault" reportadas pelo firmware. Em falha, o valor
          exibido no painel e o ultimo valido retido — nao um dado fresco.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {sensors.map((s) => (
          <div
            key={s.label}
            className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5"
            style={{
              background: s.fault
                ? "color-mix(in oklab, var(--alert) 8%, transparent)"
                : undefined,
            }}
          >
            <div className="flex min-w-0 items-start gap-2">
              <span
                className="mt-0.5 shrink-0"
                style={{ color: s.fault ? "var(--alert)" : "var(--ok)" }}
              >
                {s.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {s.fault ? s.faultHint : s.hint}
                </div>
              </div>
            </div>
            <Badge variant={s.fault ? "alert" : "ok"} className="shrink-0">
              {s.fault ? "falha" : "ok"}
            </Badge>
          </div>
        ))}

        <Separator className="my-1" />

        {/* Qualidade do enlace WiFi: `seq` do firmware detecta perda de pacotes */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Qualidade do enlace</span>
          <span className="font-tech tabular-nums">
            {dropped} perdidos · {malformed} malformados
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Prontuario() {
  const health = useHealth();

  const temp_c = useMotorTemp();
  const virtual = useVirtualCoreTemp();
  const current_a = useCurrent();
  const voltage_v = useVoltage();
  const rudder_deg = useRudder();
  const ambientTemp = useAmbientTemp();
  const humidity = useAmbientHumidity();

  const algaeAlert = useAlgaeAlert();
  const batteryLow = useBatteryLow();
  const motorTempFault = useMotorTempFault();
  const ambientFault = useAmbientFault();

  // O alarme so considera superaquecimento quando a leitura e CONFIAVEL: tocar
  // sirene por causa de um sensor solto queima a confianca da tripulacao.
  const overheat = !motorTempFault && temp_c >= OVERHEAT_C;
  const rudderHigh = Math.abs(rudder_deg) > TATICA_RUDDER_DEG;

  const alarm = useThermalAlarm(overheat);

  return (
    <div className="space-y-6">
      {/* Banner de emergencia termica */}
      {overheat && (
        <AlertBanner
          variant="alert"
          title="Superaquecimento do estator"
          icon={<IconAlertTriangle className="size-5" />}
          message={
            <>
              Temperatura em {temp_c.toFixed(1)} °C — acima do limiar de{" "}
              {OVERHEAT_C} °C. Reduza a carga do motor imediatamente.
              {alarm.armed
                ? alarm.muted
                  ? " Alarme sonoro silenciado."
                  : " Alarme sonoro ativo."
                : " Arme o alarme sonoro para alerta audivel."}
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
          Termico {overheat ? "critico" : "nominal"}
        </Badge>
        <Badge variant={batteryLow ? "alert" : "ok"}>
          <IconBattery className="size-3" />
          Bateria {batteryLow ? "critica" : "ok"}
        </Badge>
        <Badge variant={algaeAlert ? "warn" : "muted"}>
          <IconPlant className="size-3" />
          Algas {algaeAlert ? "detectadas" : "livre"}
        </Badge>
        <Badge variant={rudderHigh ? "warn" : "muted"}>
          <IconSteeringWheel className="size-3" />
          Leme {rudderHigh ? "carregado" : "nominal"}
        </Badge>
      </div>

      {/* --- Gemeo termico + termometro --- */}
      <div className="grid gap-6 xl:grid-cols-2">
        <ThermalTwin />

        <Card
          className={cn("transition-colors", overheat && "animate-pulse-alert")}
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
              Controle de Danos Termicos
            </CardTitle>
            <CardDescription>
              Estator (DS18B20) — emergencia em {OVERHEAT_C} °C
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-stretch gap-4 sm:flex-row">
              <div className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-1/2">
                <Thermometer temp={temp_c} />
              </div>
              <div className="flex flex-col justify-center gap-3 sm:w-1/2">
                <div
                  className="font-tech text-4xl font-bold leading-none sm:text-5xl"
                  style={{ color: overheat ? "var(--alert)" : "var(--cyan)" }}
                >
                  {motorTempFault ? "--" : temp_c.toFixed(1)}
                  <span className="ml-1 align-super text-xl text-muted-foreground">
                    °C
                  </span>
                </div>
                <div
                  className="font-tech text-sm font-medium uppercase tracking-wide"
                  style={{ color: overheat ? "var(--alert)" : "var(--ok)" }}
                >
                  {motorTempFault
                    ? "Sensor em falha"
                    : overheat
                      ? "Superaquecimento"
                      : "Dentro da faixa"}
                </div>

                <Separator className="my-1" />

                {/* Controles do alarme sonoro */}
                <div className="flex flex-col gap-2">
                  {!alarm.armed ? (
                    <Button
                      variant="default"
                      size="lg"
                      onClick={alarm.arm}
                      className="h-11 justify-start"
                    >
                      <IconBellRinging className="size-4" />
                      Armar alarme sonoro
                    </Button>
                  ) : (
                    <Button
                      variant={alarm.muted ? "secondary" : "outline"}
                      size="lg"
                      onClick={alarm.toggleMute}
                      className="h-11 justify-start"
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
                      ? "O navegador exige um gesto para liberar audio."
                      : alarm.sounding
                        ? "Sirene ativa enquanto durar o superaquecimento."
                        : alarm.muted
                          ? "Som silenciado pela tripulacao."
                          : "Armado — soara ao atingir o limiar."}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- Atitude do casco --- */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconRotate className="size-4" />
              Diagnostico de Atitude — Horizonte Artificial
            </CardTitle>
            <CardDescription>
              Cinematica naval em WebGL a partir dos angulos de Euler do
              MPU6050.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] sm:h-[320px]">
              <ArtificialHorizon />
            </div>
          </CardContent>
        </Card>

        <AttitudeReadout />
      </div>

      {/* --- Avatar estrutural + saude dos sensores --- */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconActivity className="size-4" />
              Avatar Estrutural — Corte Lateral
            </CardTitle>
            <CardDescription>
              Diagnostico por secao do casco (alarmes em tempo real)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="panel-grid rounded-lg p-2">
              <StructuralAvatar
                status={{
                  algae_alert: algaeAlert,
                  overheat_alert: overheat,
                  battery_low: batteryLow,
                }}
                sensors={{ current_a, voltage_v, temp_c, rudder_deg }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SereiaAvatar health={health} size={56} showLabel />
              <div className="text-right text-xs text-muted-foreground">
                <div>
                  Praca de maquinas:{" "}
                  <span
                    style={{ color: overheat ? "var(--alert)" : "var(--ok)" }}
                  >
                    {overheat ? "superaquecida" : "nominal"}
                  </span>
                </div>
                <div>
                  Bateria:{" "}
                  <span
                    style={{ color: batteryLow ? "var(--alert)" : "var(--ok)" }}
                  >
                    {batteryLow ? "critica" : "nominal"}
                  </span>
                </div>
                <div>
                  Leme:{" "}
                  <span
                    style={{ color: rudderHigh ? "var(--warn)" : "var(--ok)" }}
                  >
                    {rudderHigh ? "carregado" : "nominal"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <SensorHealthPanel />
      </div>

      {/* --- Calibracao de bancada do modelo termico --- */}
      <ThermalCalibrationPanel />

      {/* --- Leitura numerica --- */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Estator"
          value={motorTempFault ? "--" : temp_c.toFixed(1)}
          unit="°C"
          icon={<IconTemperature className="size-4" />}
          valueColor={overheat ? "var(--alert)" : undefined}
          hint={`Limiar ${OVERHEAT_C} °C`}
        />
        <MetricCard
          label="Nucleo virtual"
          value={Number.isFinite(virtual) ? virtual.toFixed(1) : "--"}
          unit="°C"
          icon={<IconTemperature className="size-4" />}
          valueColor="#ff9e2c"
          hint="modelo preditivo"
        />
        <MetricCard
          label="Corrente"
          value={current_a.toFixed(1)}
          unit="A"
          icon={<IconBolt className="size-4" />}
          hint="ACS758 · EMA"
        />
        <MetricCard
          label="Tensao"
          value={voltage_v.toFixed(2)}
          unit="V"
          icon={<IconBattery className="size-4" />}
          valueColor={batteryLow ? "var(--alert)" : undefined}
        />
        <MetricCard
          label="Leme"
          value={rudder_deg.toFixed(0)}
          unit="°"
          icon={<IconSteeringWheel className="size-4" />}
          valueColor={rudderHigh ? "var(--warn)" : undefined}
          hint={`Limiar ±${TATICA_RUDDER_DEG}°`}
        />
        <MetricCard
          label="Umidade no casco"
          value={ambientFault ? "--" : humidity.toFixed(0)}
          unit="%"
          icon={<IconDroplet className="size-4" />}
          valueColor={
            !ambientFault && humidity > 85 ? "var(--warn)" : undefined
          }
          hint={ambientFault ? "DHT22 em falha" : `${ambientTemp.toFixed(1)} °C`}
        />
      </div>
    </div>
  );
}
