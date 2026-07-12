import { defineConfig } from "vite";
import * as path from "path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  // Publicado em GitHub Pages sob https://<user>.github.io/athenas.v2.0/.
  // Em dev (vite/vite preview) o base "/" é usado automaticamente.
  base: process.env.NODE_ENV === "production" ? "/athenas.v2.0/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "src") }],
  },
});
