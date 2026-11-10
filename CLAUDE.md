# HomeHub — tableau de bord de la maison

Une tablette au mur (Fully Kiosk, accueil, dashboard par profil, reconnaissance faciale) et des téléphones reliés
(PWA sous `/m`). Dépôt **public** : `github.com/DeafLight/homehub`. Le déploiement (compose, inventaire, journal) vit
dans le dépôt privé de config du NAS, pas ici.

## Où trouver quoi

| Besoin | Où |
|---|---|
| Fonctionnalités, configuration, API, dev, release | `README.md` |
| Architecture, design (couleurs, composants) | `docs/architecture.md`, `docs/design.md` |
| Captures commentées de chaque écran | `docs/ecrans.md`, `docs/images/` |
| Feuille de route | `TODO.md` |
| Modèle de configuration | `config/homehub.example.yaml` (copie locale `config/homehub.yaml`, ignorée par git) |

Code :

| Dossier | Contenu |
|---|---|
| `server/` | API Hono (`app.ts`, `*-api.ts`), accès (`access.ts` : tablette, téléphone, personne reconnue), config (zod) |
| `server/sources/` | Une source ou un magasin par fichier (ÉcoleDirecte, Pronote, iCal, Irigo, stock, sport…), état en JSON dans `HOMEHUB_STATE_DIR` |
| `shared/` | Types et règles communs au serveur et au front (sport : `fitness*.ts`, catalogue, animations) |
| `web/src/` | Svelte 5 (runes) : `App.svelte` (routes), `screens/` (pages), `components/`, `lib/` (logique testable) |
| `scripts/` | Captures de la doc (`docs-captures.ts` + `docs-captures/`, monde fictif), appairage école, icônes |

## Stack et commandes

Node 24 (TypeScript natif, sans build côté serveur), Hono, zod, Svelte 5, Vite, vitest.

```bash
npm run check          # types (server + web) : 0 erreur attendue
npx vitest run         # tests ; les relancer avec TZ=UTC (dates locales)
npm run build          # front dans web/dist (nécessaire avant les captures)
npm run docs:captures  # refait docs/images dans le monde fictif
```

## Skills (`.claude/skills/`)

| Skill | Quand |
|---|---|
| `homehub-release` | Démarrer une version (dans sa propre sous-session) puis la sortir : numéro, vérifications, captures, commit, tag, push après accord, CI |
| `homehub-monde-fictif` | Voir un écran dans le monde fictif, simuler un téléphone ou une personne reconnue, ajouter une capture |

## Règles du projet

1. **Rien de réel dans le dépôt** : ni noms de la famille, ni adresses, ni coordonnées précises, ni arrêt de bus réel,
   ni identifiants scolaires, ni secrets. Données de test seulement : Alex, Sam (parents), Léa, Tom (enfants),
   ville d'exemple Angers.
2. Jamais de connexion aux vrais comptes ÉcoleDirecte / Pronote : faux services du monde fictif et fixtures.
3. Textes, commentaires et messages de commit **en français** ; un commentaire d'en-tête par fichier qui dit son rôle.
4. Données personnelles (sport, visages) : seul l'appareil de la personne les lit ; la tablette n'affiche rien de
   personnel. Le serveur vérifie toujours les droits (`access.ts`), le front ne fait qu'anticiper.
5. Thème sombre seulement : couleurs par variables (`--bg`, `--surface`, `--surface-2`, `--fg`, `--fg-muted`,
   `--rain`, `--sun`, `--border-strong`…, voir `web/src/app.css`), jamais de couleur en dur.
6. Toute fonctionnalité visible : tests (`*.test.ts` à côté du code), README, `docs/ecrans.md` et captures à jour,
   case cochée dans `TODO.md`.
7. Rien n'est poussé sans l'accord de l'utilisateur ; un lot de changements = une version.
8. Chaque nouvelle version se développe dans sa propre sous-session (voir `homehub-release`, étape 0).
