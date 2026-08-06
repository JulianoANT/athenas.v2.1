import * as React from "react";
import { ATHENAS_LOGO, ATHENAS_LOGO_ALT } from "@/assets/logo";

// Sequência de inicialização (Boot Sequence): terminal emulando uma varredura
// de sistemas, seguido do logotipo da Athenas surgindo com glow fade-in antes
// da transição para o painel de abas.

const LINES = [
  "[ CONNECTING TO VESSEL... ]",
  "[ SOCKET OPENED ]",
  "[ GPS LOCK ACQUIRED: 5HZ ]",
];

export function BootSequence({ onDone }: { onDone: () => void }) {
  const [done, setDone] = React.useState<string[]>([]);
  const [partial, setPartial] = React.useState("");
  const [showLogo, setShowLogo] = React.useState(false);
  const finished = React.useRef(false);

  const finish = React.useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  React.useEffect(() => {
    let li = 0;
    let ci = 0;
    let timer: number;

    const step = () => {
      if (li >= LINES.length) {
        setShowLogo(true);
        timer = window.setTimeout(finish, 1700);
        return;
      }
      const line = LINES[li];
      if (ci <= line.length) {
        setPartial(line.slice(0, ci));
        ci += 1;
        timer = window.setTimeout(step, 26);
      } else {
        setDone((p) => [...p, line]);
        setPartial("");
        li += 1;
        ci = 0;
        timer = window.setTimeout(step, 360);
      }
    };

    timer = window.setTimeout(step, 350);
    return () => window.clearTimeout(timer);
  }, [finish]);

  React.useEffect(() => {
    const skip = () => finish();
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [finish]);

  return (
    <div className="panel-grid fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b132b] text-[#48cae4]">
      <div className="w-full max-w-md px-6 font-tech text-sm">
        {done.map((l) => (
          <div key={l} className="mb-1 opacity-80">
            {l} <span className="text-[#2ee6b0]">ok</span>
          </div>
        ))}
        {!showLogo && (
          <div className="mb-1">
            {partial}
            <span className="animate-blink">_</span>
          </div>
        )}
      </div>

      {showLogo && (
        <div className="animate-glow-in mt-8 flex flex-col items-center">
          <img src={ATHENAS_LOGO} alt={ATHENAS_LOGO_ALT} className="h-24 w-24 object-contain" />
          <div className="mt-3 font-tech text-lg font-medium uppercase tracking-[0.3em] text-[#48cae4]">
            Athenas OS
          </div>
          <div className="font-tech text-[10px] tracking-[0.4em] text-[#48cae4]/60">
            v2.1 · DUNA 2026
          </div>
        </div>
      )}

      <div className="absolute bottom-6 font-tech text-[10px] tracking-widest text-[#48cae4]/40">
        toque ou pressione qualquer tecla para pular
      </div>
    </div>
  );
}
