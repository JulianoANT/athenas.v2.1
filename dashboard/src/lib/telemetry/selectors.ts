// =============================================================================
//  Seletores de telemetria.
//
//  Cada hook aqui devolve um PRIMITIVO. Isso e o que torna a arquitetura
//  granular: o Zustand compara o valor anterior com Object.is e so re-renderiza
//  o componente quando aquele numero especifico mudou.
//
//  Regra pratica para a equipe: nunca faca `useTelemetryStore(s => s.frame)`
//  em um componente que so precisa da velocidade. Isso re-renderiza a 5 Hz e
//  desfaz todo o ganho da migracao para Zustand.
// =============================================================================

import { useTelemetryStore } from "./store";
import { batteryPercent } from "./contract";

// --- Navegacao ---
export const useSpeedKnots = () => useTelemetryStore((s) => s.speedKnots);
export const useCog = () => useTelemetryStore((s) => s.cog);
export const useFix = () => useTelemetryStore((s) => s.fix);
export const useDistance = () => useTelemetryStore((s) => s.distance_m);

// --- Conjunto motriz ---
export const useCurrent = () =>
  useTelemetryStore((s) => s.frame?.sensors.current_a ?? 0);
export const useVoltage = () =>
  useTelemetryStore((s) => s.frame?.sensors.voltage_v ?? 0);
export const useMotorTemp = () =>
  useTelemetryStore((s) => s.frame?.sensors.temp_c ?? 0);
export const useRudder = () =>
  useTelemetryStore((s) => s.frame?.sensors.rudder_deg ?? 0);
export const useBatteryPercent = () =>
  useTelemetryStore((s) =>
    s.frame ? batteryPercent(s.frame.sensors.voltage_v) : 0,
  );

// --- Ambiente do casco (DHT22) ---
export const useAmbientTemp = () =>
  useTelemetryStore((s) => s.frame?.ambient.temp_c ?? 0);
export const useAmbientHumidity = () =>
  useTelemetryStore((s) => s.frame?.ambient.humidity ?? 0);

// --- Gemeo Digital Termico ---
export const useVirtualCoreTemp = () =>
  useTelemetryStore((s) => s.virtualCoreTemp);
export const useMeltdownImminent = () =>
  useTelemetryStore((s) => s.meltdownImminent);
export const useSecondsToMeltdown = () =>
  useTelemetryStore((s) => s.secondsToMeltdown);

// --- Eficiencia hidrodinamica ---
export const usePower = () => useTelemetryStore((s) => s.power_w);
export const useSpecificConsumption = () =>
  useTelemetryStore((s) => s.sec_w_per_knot);
export const useCavitationAlert = () =>
  useTelemetryStore((s) => s.cavitationAlert);

// --- Estado geral ---
export const useHealth = () => useTelemetryStore((s) => s.health);
export const useConnectionStatus = () => useTelemetryStore((s) => s.status);

// --- Alertas de status vindos do firmware ---
export const useAlgaeAlert = () =>
  useTelemetryStore((s) => s.frame?.status.algae_alert ?? false);
export const useOverheatAlert = () =>
  useTelemetryStore((s) => s.frame?.status.overheat_alert ?? false);
export const useBatteryLow = () =>
  useTelemetryStore((s) => s.frame?.status.battery_low ?? false);

// --- Saude dos sensores (flags de "Sensor Fault" do firmware) ---
export const useImuFault = () =>
  useTelemetryStore((s) => s.frame?.faults.imu ?? true);
export const useGpsFault = () =>
  useTelemetryStore((s) => s.frame?.faults.gps ?? true);
export const useMotorTempFault = () =>
  useTelemetryStore((s) => s.frame?.faults.motor_temp ?? true);
export const useAmbientFault = () =>
  useTelemetryStore((s) => s.frame?.faults.ambient ?? true);

/** true assim que o primeiro quadro real do hardware chega. */
export const useHasData = () => useTelemetryStore((s) => s.frame !== null);
