import { defineConfig } from "vite";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// O caminho base do deploy. Padrao "/" — que e o correto para `npm run dev`,
// `vite preview` e para a imagem Docker servida pelo Nginx na raiz.
//
// O GitHub Pages e o unico alvo que precisa de subcaminho; la o workflow
// define ATHENAS_BASE=/athenas.v2.0/. Antes isso era deduzido de NODE_ENV, o
// que quebrava silenciosamente o build do Docker (assets buscados em
// /athenas.v2.0/... num servidor que serve a raiz).
const base = process.env.ATHENAS_BASE || "/";

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(rootDir, "src") }],
  },
  server: {
    // Escuta em todas as interfaces para que o tablet/celular da equipe abra o
    // painel pelo IP do notebook durante os testes de campo.
    host: true,
  },
  preview: {
    host: true,
  },
  worker: {
    // O worker de telemetria usa import/export; sem ES modules o Vite geraria
    // um bundle IIFE incompativel com `{ type: "module" }`.
    format: "es",
  },
});
