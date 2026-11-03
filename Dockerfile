# --- Build du front (et vérifications) ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci lance scripts/patch-pawnote.ts (corrections de Pawnote pour Pronote 2026).
COPY scripts/patch-pawnote.ts ./scripts/
RUN npm ci
COPY . .
RUN npm run check && npm test && npm run build

# --- Image finale : serveur + front compilé ---
FROM node:24-alpine
ENV NODE_ENV=production \
    TZ=Europe/Paris \
    PORT=3000 \
    HOMEHUB_CONFIG=/data/homehub.yaml \
    HOMEHUB_STATIC_ROOT=/app/web/dist \
    HOMEHUB_STATE_DIR=/state
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/patch-pawnote.ts ./scripts/
RUN npm ci --omit=dev && npm cache clean --force
COPY shared ./shared
COPY server ./server
# Codes PIN des profils : sudo docker exec -it homehub node scripts/set-pin.ts <profil>
COPY scripts/set-pin.ts ./scripts/
COPY config/homehub.example.yaml ./config/
COPY --from=build /app/web/dist ./web/dist

# Dossier inscriptible (jeton Pronote, listes, téléphones, PIN) : à monter en volume pour qu'il survive aux mises à jour.
RUN mkdir -p /state && chown node:node /state
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server/index.ts"]
