import * as React from "react";
import type { AccessRole } from "@/types/telemetry";

// Escopo de Login de Segurança (Sigilo Tático) da Diretriz.
//  - public: Modo Avaliador / Público — só métricas básicas de conformidade.
//  - crew:   Modo Tripulação Athenas — ferramentas analíticas completas,
//            gráficos de consumo e módulo de exportação.
//
// Observação de segurança: este é um gate de UI para proteger o sigilo tático
// durante a prova, não um controle de acesso server-side. A senha da tripulação
// pode ser configurada por VITE (build) — nunca commite uma senha real.

const ROLE_KEY = "athenas:role";
const CREW_PASSCODE = "athenas2026";

interface AuthContextValue {
  role: AccessRole | null;
  isCrew: boolean;
  loginPublic: () => void;
  loginCrew: (passcode: string) => boolean;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function readRole(): AccessRole | null {
  if (typeof window === "undefined") return null;
  const r = window.sessionStorage.getItem(ROLE_KEY);
  return r === "crew" || r === "public" ? r : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = React.useState<AccessRole | null>(readRole);

  const persist = (r: AccessRole | null) => {
    if (r) window.sessionStorage.setItem(ROLE_KEY, r);
    else window.sessionStorage.removeItem(ROLE_KEY);
    setRole(r);
  };

  const value: AuthContextValue = {
    role,
    isCrew: role === "crew",
    loginPublic: () => persist("public"),
    loginCrew: (passcode: string) => {
      if (passcode.trim() === CREW_PASSCODE) {
        persist("crew");
        return true;
      }
      return false;
    },
    logout: () => persist(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
