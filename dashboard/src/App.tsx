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
          <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex w-full items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-6"
              />
              <Breadcrumbs routes={routes} rootLabel="Athenas OS" />
              <div className="ml-auto flex items-center gap-2">
                <ConnectionBadge />
                <ThemeToggle />
              </div>
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4">
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
