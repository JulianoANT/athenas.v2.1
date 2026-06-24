import type * as React from "react";
import {
  IconLayoutDashboard,
  IconCompass,
  IconEngine,
  IconReportMedical,
  IconFileExport,
} from "@tabler/icons-react";

export interface Route {
  name: string;
  label: string;
  href: string;
  icon?: React.ReactNode;
  /** Visível apenas para a Tripulação Athenas (oculto no modo público). */
  crewOnly?: boolean;
  children?: Route[];
}

// Árvore de navegação do Athenas OS. As abas seguem a Diretriz v2.0.
export const routes: Route[] = [
  {
    name: "overview",
    label: "Visão Geral",
    href: "/",
    icon: <IconLayoutDashboard />,
  },
  {
    name: "passadico",
    label: "Passadiço & Navegação",
    href: "/passadico",
    icon: <IconCompass />,
  },
  {
    name: "maquinas",
    label: "Casa de Máquinas",
    href: "/maquinas",
    icon: <IconEngine />,
  },
  {
    name: "prontuario",
    label: "Prontuário & Diagnósticos",
    href: "/prontuario",
    icon: <IconReportMedical />,
    crewOnly: true,
  },
  {
    name: "export",
    label: "Athenas Log",
    href: "/exportar",
    icon: <IconFileExport />,
    crewOnly: true,
  },
];
