# HomeHub

Tableau de bord maison affiché en plein écran sur la tablette (Fully Kiosk).
Hébergé sur le NAS TrueNAS, derrière Nginx Proxy Manager (accès LAN + VPN uniquement).

## Stack

- **Back** : Node.js 24 + [Hono](https://hono.dev). TypeScript exécuté directement par Node (pas de build côté serveur).
- **Front** : [Svelte 5](https://svelte.dev) + Vite, compilé dans `web/dist` et servi par le back.
- **Image** : `ghcr.io/deaflight/homehub`, construite par GitHub Actions à chaque tag.

```
server/        API (Hono) — sert aussi le front compilé
web/           front Svelte (index.html, src/)
Dockerfile     image multi-stage
.github/       workflow de release (build + push GHCR)
```

## Développement

```bash
npm install
npm run dev       # back sur :3000 + Vite sur :5173 (proxy /api → :3000)
npm run check     # vérification des types (server + web)
npm run build     # compile le front dans web/dist
npm start         # sert l'app compilée sur :3000
```

Pour tester sur la tablette en dev : `http://<ip-du-pc>:5173`.

## API

| Route | Réponse |
|---|---|
| `GET /api/health` | `{ status, version, time }` — utilisée aussi par le healthcheck Docker |

## Release et déploiement

1. Mettre à jour `version` dans `package.json`, commit.
2. `git tag vX.Y.Z && git push --follow-tags` → GitHub Actions publie `ghcr.io/deaflight/homehub:X.Y.Z`.
3. Dans `nas-config`, passer le service `homehub` au tag `X.Y.Z`, commit + push.
4. Sur le NAS : `git pull --ff-only` puis `docker compose up -d homehub`.

Configuration par variables d'environnement : voir `.env.example`.
