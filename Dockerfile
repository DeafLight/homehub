# --- Build du front (et vérifications) ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm test && npm run build

# --- Image finale : serveur + front compilé ---
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HOMEHUB_CONFIG=/data/homehub.yaml \
    HOMEHUB_STATIC_ROOT=/app/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared ./shared
COPY server ./server
COPY config/homehub.example.yaml ./config/
COPY --from=build /app/web/dist ./web/dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server/index.ts"]
