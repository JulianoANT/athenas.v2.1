import type * as React from "react";

export interface Route {
  name: string;
  label: string;
  href: string;
  element: React.ReactNode;
  children?: Route[];
}

// Árvore de rotas da aplicação (ajuste conforme você adicionar páginas/rotas reais).
export const routes: Route[] = [
  {
    name: "indicators",
    label: "Indicadores",
    href: "/",
    element: null,
  },
  {
    name: "temperature",
    label: "Temperatura",
    href: "/temperatura",
    element: null,
  },
  {
    name: "gps",
    label: "GPS",
    href: "/gps",
    element: null,
  },
  {
    name: "battery",
    label: "Bateria",
    href: "/bateria",
    element: null,
  },
  {
    name: "imu",
    label: "IMU",
    href: "/imu",
    element: null,
  },
  {
    name: "system",
    label: "Sistema",
    href: "/sistema",
    element: null,
    children: [
      {
        name: "observability",
        label: "Observabilidade",
        href: "/sistema/observabilidade",
        element: null,
      },
      {
        name: "access",
        label: "Acessos",
        href: "/sistema/acessos",
        element: null,
      },
    ],
  },
];
