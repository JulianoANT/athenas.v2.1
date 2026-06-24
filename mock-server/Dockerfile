FROM node:20-alpine

WORKDIR /app

# Instala apenas dependencias de producao (camada cacheavel).
COPY package.json ./
RUN npm install --omit=dev

# Copia o codigo da aplicacao.
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
