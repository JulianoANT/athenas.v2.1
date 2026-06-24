# syntax=docker/dockerfile:1

# ---------- Stage 1: build ----------
# Compila o dashboard (Vite 8 + React 19) gerando os assets estáticos em /app/dist.
FROM node:20-alpine AS build
WORKDIR /app

# Instala dependências primeiro para aproveitar o cache de camadas do Docker.
COPY package*.json ./
RUN npm install

# Copia o restante do código-fonte e roda o build (tsc -b && vite build).
COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
# Serve os arquivos estáticos via Nginx (imagem final enxuta, sem Node).
FROM nginx:alpine

# Assets estáticos gerados pelo Vite.
COPY --from=build /app/dist /usr/share/nginx/html

# Configuração do Nginx (SPA fallback, gzip e cache de assets).
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# A imagem base nginx:alpine já define o CMD para rodar o Nginx em foreground.
