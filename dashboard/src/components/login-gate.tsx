import * as React from "react";
import { IconShieldLock, IconEye, IconAnchor } from "@tabler/icons-react";
import { ATHENAS_LOGO, ATHENAS_LOGO_ALT } from "@/assets/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

// Escopo de Login de Segurança (Sigilo Tático): divide os privilégios entre
// Avaliador/Público (métricas básicas) e Tripulação Athenas (analítica completa).
export function LoginGate({ children }: { children: React.ReactNode }) {
  const { role, loginPublic, loginCrew } = useAuth();
  const [showCrew, setShowCrew] = React.useState(false);
  const [pass, setPass] = React.useState("");
  const [error, setError] = React.useState(false);

  if (role) return <>{children}</>;

  const submitCrew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginCrew(pass)) {
      setError(true);
      setPass("");
    }
  };

  return (
    <div className="panel-grid flex min-h-screen flex-col items-center justify-center bg-[#0b132b] p-6 text-[#dbe9f6]">
      <img src={ATHENAS_LOGO} alt={ATHENAS_LOGO_ALT} className="h-20 w-20 object-contain" />
      <h1 className="mt-4 font-tech text-2xl font-medium uppercase tracking-[0.25em] text-[#48cae4] glow-cyan">
        Athenas OS v2.1
      </h1>
      <p className="mb-8 font-tech text-xs tracking-[0.3em] text-[#48cae4]/60">
        central de telemetria · duna 2026
      </p>

      <div className="grid w-full max-w-md gap-4">
        <button
          onClick={loginPublic}
          className="group flex items-start gap-3 rounded-lg border border-[#48cae4]/20 bg-[#101c3a]/70 p-4 text-left transition-colors hover:border-[#48cae4]/60"
        >
          <IconEye className="mt-0.5 size-6 shrink-0 text-[#48cae4]" />
          <div>
            <div className="font-medium">Avaliador / Público</div>
            <div className="text-sm text-[#8aa6c8]">
              Métricas básicas de conformidade (velocímetro, cronômetro e mapa).
              Dados de consumo ficam ocultos.
            </div>
          </div>
        </button>

        {!showCrew ? (
          <button
            onClick={() => setShowCrew(true)}
            className="group flex items-start gap-3 rounded-lg border border-[#48cae4]/20 bg-[#101c3a]/70 p-4 text-left transition-colors hover:border-[#48cae4]/60"
          >
            <IconShieldLock className="mt-0.5 size-6 shrink-0 text-[#ff9e2c]" />
            <div>
              <div className="font-medium">Tripulação Athenas</div>
              <div className="text-sm text-[#8aa6c8]">
                Ferramentas analíticas completas, gráficos de arrasto e módulo de
                exportação.
              </div>
            </div>
          </button>
        ) : (
          <form
            onSubmit={submitCrew}
            className="flex flex-col gap-3 rounded-lg border border-[#ff9e2c]/40 bg-[#101c3a]/70 p-4"
          >
            <div className="flex items-center gap-2 text-[#ff9e2c]">
              <IconShieldLock className="size-5" />
              <span className="font-medium">Acesso da tripulação</span>
            </div>
            <Input
              autoFocus
              type="password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setError(false);
              }}
              placeholder="Senha tática"
              className="border-[#48cae4]/30 bg-[#0b132b] text-[#dbe9f6]"
            />
            {error && (
              <span className="text-sm text-[#ff3b3b]">
                Senha incorreta. Tente novamente.
              </span>
            )}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                <IconAnchor className="size-4" /> Entrar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowCrew(false);
                  setError(false);
                }}
              >
                Voltar
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
