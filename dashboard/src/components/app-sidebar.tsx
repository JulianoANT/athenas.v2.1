import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { IconLogout } from "@tabler/icons-react";
import { ATHENAS_LOGO, ATHENAS_LOGO_ALT } from "@/assets/logo";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { SereiaAvatar } from "@/components/sereia";
import { routes } from "@/routes";
import { useAuth } from "@/lib/auth";
import { useHealth } from "@/lib/telemetry/selectors";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation();
  const { isCrew, role, logout } = useAuth();
  // Seletor primitivo: a sidebar so re-renderiza quando o ESTADO DA SEREIA
  // muda, nao a cada quadro de telemetria a 5 Hz.
  const health = useHealth();
  const items = routes.filter((r) => !r.crewOnly || isCrew);

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <img
            src={ATHENAS_LOGO}
            alt={ATHENAS_LOGO_ALT}
            className="size-8 shrink-0 rounded-md"
          />
          <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-tech text-sm font-medium tracking-wide">
              ATHENAS
            </span>
            <span className="text-[10px] text-sidebar-foreground/60">
              Central de Telemetria
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((r) => (
              <SidebarMenuItem key={r.name}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(location.pathname, r.href)}
                  tooltip={r.label}
                >
                  <Link to={r.href}>
                    {r.icon}
                    <span>{r.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Estado da embarcação</SidebarGroupLabel>
          <div className="flex flex-col items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
            <SereiaAvatar health={health} size={88} showLabel />
          </div>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-1 group-data-[collapsible=icon]:hidden">
          <div className="grid leading-tight">
            <span className="text-xs font-medium">
              {role === "crew" ? "Tripulação Athenas" : "Avaliador / Público"}
            </span>
            <span className="text-[10px] text-sidebar-foreground/60">
              {role === "crew" ? "acesso completo" : "acesso restrito"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            title="Encerrar sessão"
            aria-label="Encerrar sessão"
          >
            <IconLogout className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
