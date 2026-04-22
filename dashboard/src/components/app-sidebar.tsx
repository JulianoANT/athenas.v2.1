"use client";

import * as React from "react";

import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  IconSpeedboat,
  IconLayoutDashboard,
  IconTemperature,
  IconFrame,
  IconChartPie,
  IconBatteryVertical3,
  IconGps,
  IconAngle,
  IconSettings,
  IconReportAnalytics,
  IconAdjustments,
} from "@tabler/icons-react";

// This is sample data.
const data = {
  user: {
    name: "Lukas",
    email: "lukas.w@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  teams: [
    {
      name: "Athenas",
      logo: <IconSpeedboat />,
      plan: "Estrela do Norte",
    },
  ],
  navMain: [
    {
      title: "Dashboard",
      url: "#",
      icon: <IconLayoutDashboard />,
    },
    {
      title: "Temperatura",
      url: "#",
      icon: <IconTemperature />,
    },
    {
      title: "GPS",
      url: "#",
      icon: <IconGps />,
    },
    {
      title: "Bateria",
      url: "#",
      icon: <IconBatteryVertical3 />,
    },
    {
      title: "IMU",
      url: "#",
      icon: <IconAngle />,
    },
  ],
  system: [
    {
      name: "Configurações",
      url: "#",
      icon: <IconSettings />,
    },
    {
      name: "Relatórios",
      url: "#",
      icon: <IconReportAnalytics />,
    },
    {
      name: "Permissões",
      url: "#",
      icon: <IconAdjustments />,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props} variant="inset">
      <SidebarHeader>
        <TeamSwitcher team={data.teams[0]} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.system} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
