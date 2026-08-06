import * as React from "react";
import {
  HashRouter,
  Routes,
  Route as RouterRoute,
  Navigate,
} from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ConnectionBadge } from "@/components/connection-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { BootSequence } from "@/components/boot-sequence";
import { LoginGate } from "@/components/login-gate";
import { AwaitingHardware } from "@/components/awaiting-hardware";
import { MeltdownAlert } from "@/components/thermal/meltdown-alert";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { routes } from "@/routes";
import { useAuth } from "@/lib/auth";

import Dashboard from "./pages/dashboard";
import Passadico from "./pages/passadico";
import Maquinas from "./pages/maquinas";
import Prontuario from "./pages/prontuario";
import Exportar from "./pages/exportar";

const BOOT_KEY = "athenas:booted";

function CrewGuard({ children }: { children: React.ReactNode }) {
  const { isCrew } = useAuth();
  return isCrew ? <>{children}</> : <Navigate to="/" replace />;
}

function Shell() {
  return (
    <HashRouter>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          {/* Header fixo no topo: em campo, com o painel rolado, o estado da
              conexao e o alternador de tema precisam continuar acessiveis. */}
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur transition-[width,height] ease-linear sm:h-16 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex w-full items-center gap-2 px-3 sm:px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-1 data-[orientation=vertical]:h-6 sm:mr-2"
              />
              {/* Trilha de navegacao some no celular: nao ha largura para ela
                  e o titulo da propria pagina ja cumpre o papel. */}
              <div className="hidden min-w-0 sm:block">
                <Breadcrumbs routes={routes} rootLabel="Athenas OS" />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
                <ConnectionBadge />
                <ThemeToggle />
              </div>
            </div>
          </header>

          <div className="flex flex-1 flex-col gap-4 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
            <AwaitingHardware />
            <Routes>
              <RouterRoute path="/" element={<Dashboard />} />
              <RouterRoute path="/passadico" element={<Passadico />} />
              <RouterRoute path="/maquinas" element={<Maquinas />} />
              <RouterRoute
                path="/prontuario"
                element={
                  <CrewGuard>
                    <Prontuario />
                  </CrewGuard>
                }
              />
              <RouterRoute
                path="/exportar"
                element={
                  <CrewGuard>
                    <Exportar />
                  </CrewGuard>
                }
              />
              <RouterRoute path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </SidebarInset>
      </SidebarProvider>

      {/* Alerta global de fusao do estator: precisa aparecer em qualquer aba. */}
      <MeltdownAlert />
    </HashRouter>
  );
}

export default function App() {
  const [booted, setBooted] = React.useState(
    () =>
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(BOOT_KEY) === "1",
  );

  if (!booted) {
    return (
      <BootSequence
        onDone={() => {
          window.sessionStorage.setItem(BOOT_KEY, "1");
          setBooted(true);
        }}
      />
    );
  }

  return (
    <LoginGate>
      <Shell />
    </LoginGate>
  );
}
