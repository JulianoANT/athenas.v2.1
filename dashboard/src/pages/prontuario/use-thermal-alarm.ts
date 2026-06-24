import * as React from "react";

// Alarme sonoro de superaquecimento (Controle de Danos Térmicos).
// Usa a Web Audio API (OscillatorNode + GainNode) para emitir um tom contínuo
// enquanto o estator estiver em superaquecimento. O navegador exige um gesto do
// usuário para criar/retomar o AudioContext, então a UI deve oferecer um botão
// "Armar alarme sonoro" que chama arm(). O som só toca quando armado, não mudo e
// com overheat ativo. Todo o cleanup (osciladores/contexto) é feito no unmount.

export interface ThermalAlarm {
  /** AudioContext criado e pronto (gesto do usuário concedido). */
  armed: boolean;
  /** Usuário silenciou manualmente o alarme. */
  muted: boolean;
  /** Há um tom soando neste instante. */
  sounding: boolean;
  /** Cria/retoma o AudioContext (deve ser chamado por gesto do usuário). */
  arm: () => void;
  /** Alterna o mudo. */
  toggleMute: () => void;
}

// Frequências do bip de dois tons (sirene de emergência).
const TONE_HZ_A = 880;
const TONE_HZ_B = 622;
const BEEP_MS = 380;
const PEAK_GAIN = 0.18;

export function useThermalAlarm(active: boolean): ThermalAlarm {
  const [armed, setArmed] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [sounding, setSounding] = React.useState(false);

  const ctxRef = React.useRef<AudioContext | null>(null);
  const oscRef = React.useRef<OscillatorNode | null>(null);
  const gainRef = React.useRef<GainNode | null>(null);
  const beepTimerRef = React.useRef<number | null>(null);
  const toggleRef = React.useRef(false);

  const stopTone = React.useCallback(() => {
    if (beepTimerRef.current != null) {
      window.clearInterval(beepTimerRef.current);
      beepTimerRef.current = null;
    }
    const gain = gainRef.current;
    const ctx = ctxRef.current;
    if (gain && ctx) {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      } catch {
        /* contexto já encerrado */
      }
    }
    if (oscRef.current) {
      try {
        oscRef.current.stop();
      } catch {
        /* já parado */
      }
      try {
        oscRef.current.disconnect();
      } catch {
        /* ignore */
      }
      oscRef.current = null;
    }
    setSounding(false);
  }, []);

  const startTone = React.useCallback(() => {
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain || oscRef.current) return;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(TONE_HZ_A, ctx.currentTime);
    osc.connect(gain);
    osc.start();
    oscRef.current = osc;

    // Sirene de dois tons: alterna a frequência e pulsa o ganho.
    toggleRef.current = false;
    const tick = () => {
      const c = ctxRef.current;
      const g = gainRef.current;
      const o = oscRef.current;
      if (!c || !g || !o) return;
      toggleRef.current = !toggleRef.current;
      const hz = toggleRef.current ? TONE_HZ_B : TONE_HZ_A;
      const now = c.currentTime;
      o.frequency.setValueAtTime(hz, now);
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + 0.02);
      g.gain.setValueAtTime(PEAK_GAIN, now + BEEP_MS / 1000 - 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_MS / 1000 - 0.01);
    };
    tick();
    beepTimerRef.current = window.setInterval(tick, BEEP_MS);
    setSounding(true);
  }, []);

  const arm = React.useCallback(() => {
    try {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new Ctx();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.connect(ctx.destination);
        ctxRef.current = ctx;
        gainRef.current = gain;
      }
      void ctxRef.current.resume();
      setArmed(true);
    } catch {
      setArmed(false);
    }
  }, []);

  const toggleMute = React.useCallback(() => setMuted((m) => !m), []);

  // Liga/desliga o tom conforme as condições (armado, não mudo, overheat ativo).
  React.useEffect(() => {
    const shouldSound = armed && !muted && active;
    if (shouldSound) startTone();
    else stopTone();
  }, [armed, muted, active, startTone, stopTone]);

  // Cleanup definitivo no unmount: para osciladores e fecha o contexto.
  React.useEffect(() => {
    return () => {
      stopTone();
      const ctx = ctxRef.current;
      ctxRef.current = null;
      gainRef.current = null;
      if (ctx) void ctx.close().catch(() => undefined);
    };
  }, [stopTone]);

  return { armed, muted, sounding, arm, toggleMute };
}
