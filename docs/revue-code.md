# Revue de code de HomeHub

Revue sévère de tout le code (`server/`, `shared/`, `web/src/`, `scripts/`) faite sur la 0.39.0 (`9a4a07e`), suivie
d'une refonte sur la branche `claude/refonte-code-042ec6`. Les numéros de ligne renvoient à l'état **après** la
refonte. Pour un défaut corrigé, ils renvoient à `9a4a07e` (« avant »).

Verdict d'ensemble : le domaine est bien pensé et bien testé quand il est en fonctions pures (`shared/fitness*.ts`,
`gtfs.ts`, `ecoledirecte.ts`, `web/src/lib/`). Ce qui pèche, c'est la colle :

- la couche HTTP faisait tout (droits, validation, règles, persistance, format des erreurs) ;
- la persistance était recopiée onze fois ;
- côté front, quelques écrans sont devenus des fourre-tout.

Le code n'était pas mauvais, mais chaque nouvelle fonctionnalité se faisait par copier-coller. La refonte s'attaque à
ce mécanisme, pas aux symptômes un par un.

## Classement par gravité

| # | Gravité | Constat | État |
|---|---|---|---|
| 1 | **Critique (sécurité)** | `X-Real-IP` / `X-Forwarded-For` crus sans condition : une adresse de bouclage vaut tablette | Signalé, non corrigé (changerait le comportement) |
| 2 | **Haute (intégrité)** | Mémoire modifiée avant l'écriture disque dans les magasins JSON | Corrigé (`905610e`) |
| 3 | **Haute (conception)** | Routes HTTP obèses : droits, validation, règles et persistance mêlés, 37 copies du contrôle d'accès | Corrigé (`598e051`) |
| 4 | **Haute (duplication)** | Persistance JSON recopiée onze fois, avec des variantes de comportement | Corrigé (`905610e`) |
| 5 | Moyenne | `/stock/products/:code/recheck` sans contrôle d'accès, déclenche des appels sortants | Signalé |
| 6 | Moyenne | Service du dashboard : un magasin créé en cachette (DIP), six try/catch recopiés, transports mélangés aux écrans | Corrigé (`ff4bd37`) |
| 7 | Moyenne | Chaînes « config → membres → find » partout (Loi de Déméter) | Corrigé côté serveur ; 26 restent dans le front |
| 8 | Moyenne | Composants Svelte géants (Scan 1017 lignes, Transit 921, Phone 661, SportPanel 613, Stock 609) | Prochaines étapes |
| 9 | Moyenne | Règles « quelle page fait quoi » recopiées dans quatre composants | Corrigé (`b99dec0`) |
| 10 | Moyenne | Machine à états du minuteur de séance dans le composant, sans test ; verrou d'écran qui peut fuir | Prochaines étapes |
| 11 | Basse | Messages d'erreur incohérents (`prettifyError`, premier problème, texte fixe) | Corrigé pour les routes refaites |
| 12 | Basse | Types recopiés entre `web/src/lib/api.ts` et le serveur | Prochaines étapes |
| 13 | Basse | Couplage latéral entre sources, utilitaires mal rangés, en-tête manquant | Prochaines étapes |
| 14 | Basse | Magasins et sources sans test (`transit-settings`, `fitness`, `stock`, `gtfs-rt`, `geocode`) | Prochaines étapes |

## 1. Sécurité : l'adresse du client est crue sur parole

`server/access.ts:43-54` lit `X-Real-IP`, puis `X-Forwarded-For`, sans vérifier que la requête vient du proxy.
`server/access.ts:57-60` accorde ensuite les droits de tablette à toute adresse de bouclage (`LOOPBACK`, ligne 23) ou
listée dans la configuration.

**Conséquence.** Si le port de HomeHub est joignable sans passer par le proxy (erreur de compose, réseau local, dev),
il suffit d'envoyer `X-Real-IP: 127.0.0.1` pour devenir « la tablette ». On peut alors lire les dashboards, écrire
partout et appairer un téléphone.

Le commentaire suppose que l'architecture de déploiement est respectée. Le code ne le vérifie pas : c'est **Postel
appliqué à l'envers**. Il faut être tolérant sur le format, pas sur l'origine.

**Correction proposée** (non faite : elle change le comportement et le déploiement doit la suivre) :

- ne croire ces en-têtes que si l'adresse de la connexion est celle du proxy (liste `trustedProxies` dans la
  configuration) ;
- sinon, prendre l'adresse de la connexion.

## 2. Intégrité : la mémoire avant le disque

**Avant**, chaque magasin (`lists.ts`, `notes.ts`, `routines.ts`, `stock.ts`, `pins.ts`, …) modifiait son objet en
mémoire, puis écrivait le fichier. Si l'écriture échouait (disque plein, droits), le serveur continuait à servir un
état qui n'existait nulle part. Au redémarrage suivant, les modifications « acceptées » disparaissaient.

`server/sources/json-file.ts` inverse l'ordre : la modification se fait sur un brouillon (`structuredClone`), qui
remplace la mémoire seulement une fois écrit. L'écriture reste atomique (fichier temporaire puis renommage), sérialisée
et en mode 0600. Le cas est testé (`json-file.test.ts`, « une écriture qui échoue ne change rien »).

## 3. Séparation des couches : des routes qui faisaient tout

**Avant**, `server/app.ts` (289 lignes), `lists-api.ts` (374), `stock-api.ts` (321) mêlaient dans chaque gestionnaire :

- l'identification (`identify`, `access.write`) ;
- le code PIN ;
- la validation zod (34 fois `schema.safeParse(await c.req.json().catch(() => null))`) ;
- les règles métier (scan, suite sur la liste de courses, reconnaissance faciale) ;
- le format des erreurs.

Le contrôle d'accès était recopié 37 fois, sous la forme `const w = await access.write(c, id); if ('error' in w)
return c.json({error: w.error, ...}, w.status)`. C'est une violation du **SRP** et du **Tell, Don't Ask** : la route
demande à `access` un objet, l'inspecte, puis fabrique elle-même le refus. Et du **DRY** : la moindre variation (oubli
de `identify: true`) passait inaperçue.

**Après** (`598e051`) :

- `server/http.ts` :
  - `HttpError` et `fail()` lèvent un refus ;
  - `readBody()` lit et valide le corps ;
  - `handleErrors()` traduit tout en `{error, identify?}` ;
  - `createRouter()` installe ce traducteur sur chaque sous-routeur, qui marche donc aussi seul dans les tests.
- `server/access.ts` : des gardes qui **lèvent** au lieu de rendre un objet à inspecter : `writer`, `parent`, `kiosk`,
  `trusted`, `appliance`. Les messages sont des constantes (`REJECTED_PHONE`, `WHO_ARE_YOU`, …).
- `server/pin-gate.ts` : les codes PIN (requis, faux, blocage 429, code parent à définir), testés à part.
- Les règles quittent les routes pour des services sans HTTP : `services/faces.ts`, `services/stock.ts`, puis
  `services/transit.ts`.
- Chaque groupe de routes a son fichier, et `app.ts` (117 lignes) ne fait plus que composer :
  - `dashboard-api.ts`, `routines-api.ts`, `transit-api.ts`, `timers-api.ts` ;
  - `devices-api.ts`, `faces-api.ts` ;
  - `lists-api.ts` (106), `stock-api.ts` (190), `fitness-api.ts` (81).

Routes, statuts et JSON sont inchangés : les tests d'API existants passent sans retouche de leurs attentes.

## 4. Duplication : onze copies de la persistance

Lecture du fichier, validation zod, valeur par défaut, file d'écriture, écriture atomique : le même bloc existait dans
`lists`, `notes`, `routines`, `devices`, `faces`, `stock`, `pins`, `routine-plans`, `transit-settings`, `fitness` (et
`config-store`). Chaque copie avait ses variantes : relecture à chaque appel ou pas, joli JSON ou pas, droits du
fichier oubliés…

`createJsonFile()` (`server/sources/json-file.ts`) les remplace toutes. Ses options rendent chaque variante explicite
au lieu de les cacher dans une copie : `rereadEachTime`, `pretty`, `beforeSave`, `keep`.

Deux autres doublons ont été réunis :

- dates locales : `shared/dates.ts` (`localDay`, `localTime`) remplace six copies (serveur, front, `shared/fitness.ts`,
  ÉcoleDirecte, dashboard, routines) ;
- auteur d'une modification : `server/sources/schemas.ts` (`authorSchema`) remplace sept copies.

**Doublons restants :**

- `ENTITIES` : `server/sources/homework.ts:8` et `server/sources/irigo.ts:25`, deux tables différentes pour le même
  besoin ;
- `normalize` : `server/services/transit.ts:23`, `server/sources/gtfs.ts:122`, `server/sources/ecoledirecte.ts:135` ;
- la boucle caméra : `web/src/lib/face.ts:86` (partagée par Presence, Faces et le diagnostic), mais `Scan.svelte:93` a
  sa propre `startCamera`.

## 5. `/stock/products/:code/recheck` sans contrôle

`server/stock-api.ts:93` : toute requête qui atteint le serveur déclenche un appel à Open Food Facts. Ce n'est pas une
fuite (le résultat est public), mais c'est une **porte ouverte vers l'extérieur sans authentification**. Il faut au
moins `access.trusted(c)`. Ce n'est pas corrigé, parce que cela changerait la réponse pour un appelant actuel.

## 6. Service du dashboard : dépendance cachée, try/catch recopiés

**Avant**, `server/services/dashboard.ts` (409 lignes) :

- créait lui-même `createTransitSettingsStore({ path: '' })` quand on ne lui en donnait pas. C'est un magasin de
  fichier sans fichier, instancié en douce : une violation du **DIP**. Le service dépendait d'une implémentation
  concrète et de son comportement « chemin vide » ;
- recopiait six fois le même `try { … } catch { logger.error(…); return null }` (météo deux fois, emploi du temps,
  devoirs, passages, perturbations) ;
- portait tout le calcul du trajet du matin (GTFS, emploi du temps, temps réel) au milieu de l'assemblage des écrans.

**Après** :

- `transitSettingsFromConfig()` rend la conversion du YAML explicite ;
- `services/accessory.ts` donne une seule façon de masquer une source en panne ;
- `services/transit.ts` est le tableau des bus et le trajet du matin, avec ses tests (`transit.test.ts`) ;
- le dashboard tombe à 264 lignes et n'assemble plus que des écrans.

## 7. Loi de Déméter : `config.current().members.find(…)`

Le serveur avait 24 chaînes `deps.config.current().members.find((m) => m.id === id)` ou équivalentes. Chaque appelant
connaissait la forme de la configuration, et la règle « la famille est un propriétaire » (`FAMILY_ID`) était recopiée.

`server/household.ts` fournit `member`, `isMember`, `ownerIds`, `isOwner` et `nameOf`. Il est utilisé dans le
dashboard, `routine-plans`, `transit-settings`, `index.ts`, les APIs et la reconnaissance faciale.

**Reste** : 26 `config.members.find` / `profiles.find` dans le front (`grep -rn "members.find\|profiles.find"
web/src`). Il faudrait un `household` côté client dans `web/src/lib/`.

## 8. Front : composants fourre-tout

| Fichier | Lignes | Ce qu'il mélange |
|---|---|---|
| `web/src/screens/Scan.svelte` | 1017 | caméra, lecture des codes, machine à états du scan, fiche produit, formulaires, stock, liste de courses |
| `web/src/screens/Transit.svelte` | 921 | recherche d'arrêts, réglages de l'accueil, trajets de chaque membre, aperçu |
| `web/src/screens/Phone.svelte` | 661 | cinq onglets, partage, scanner |
| `web/src/components/fitness/SportPanel.svelte` | 613 | bilan de la semaine, prochaine séance, propositions, journal, historique, catalogue |
| `web/src/screens/Stock.svelte` | 609 | inventaire, contenants, réglages |

Plus de 300 lignes de script dans un composant, c'est de la logique que vitest ne voit pas. Les fonctions pures de
`web/src/lib/` sont, elles, très bien testées. Il faut continuer à y descendre la logique (machine à états du scan,
formulaires) et découper l'affichage en sous-composants.

## 9. Règles de routes éparpillées

**Avant**, quatre composants refaisaient chacun leur liste d'exceptions :

- `App.svelte` : « pas sur un téléphone, pas pendant un scan ou une séance », vérifié **deux fois** (dans le `$derived`,
  puis dans le rappel de `watchIdle`) ;
- `Presence.svelte` : la même chose plus `router.route.name !== 'faces'` en dur ;
- `Screensaver.svelte` et `Timers.svelte` : leur variante.

Pour ajouter une page « qui garde la personne », il fallait penser à quatre fichiers : **OCP** violé.

**Après** (`b99dec0`), `web/src/lib/route.ts` a une table de traits par route (`phone`, `holdsActor`, `camera`). Des
prédicats portent le nom de ce qu'ils décident : `returnsHomeWhenIdle`, `allowsScreensaver`, `watchesPresence`,
`showsTimers`. Ils sont testés page par page (`route.test.ts`).

## 10. Séance guidée et effets Svelte

- `web/src/screens/Workout.svelte:72-100` : la machine à états du minuteur (`running` / `done` / `saved`, pause, bips
  des trois dernières secondes, passage à l'étape suivante) vit dans le composant. Elle n'a aucun test, alors que c'est
  la partie la plus délicate de l'écran. Elle mérite un module `web/src/lib/workout-timer.ts` avec une horloge
  injectée.
- `Workout.svelte:119-131` : si `wakeLock.request()` se résout **après** la sortie de la page, le verrou n'est jamais
  rendu et l'écran reste allumé. Il faut un drapeau `destroyed`, ou rendre le verrou dans le `.then`.
- `web/src/components/Screensaver.svelte:104-115` : trois `$effect` qui appellent tous `wake()`. Un seul effet avec une
  condition `shouldWake` (`$derived`) serait plus lisible. Ce ne sont pas des `$derived` déguisés, puisqu'ils ont un
  effet de bord, mais leur multiplication cache la règle.
- `web/src/components/fitness/SportPanel.svelte:89-95` : `$effect` qui recopie le programme dans des champs de
  formulaire. C'est le motif « état dérivé synchronisé à la main » ; un composant de formulaire initialisé par ses props
  (et `{#key thisWeek}`) l'éviterait.
- `SportPanel.svelte:75-80` : `submit` contourne `act()`, donc ni `busy`, ni message d'erreur. Une séance refusée par
  le serveur part en rejet de promesse non géré.
- `web/src/lib/resource.svelte.ts:27` : le rafraîchissement continue page cachée. Sur la tablette ce n'est pas grave ;
  sur le téléphone, c'est de la batterie et des données.
- 15 appels manuels `resource.destroy()` : un oubli fait fuir un `setInterval`. Une fonction qui s'enregistre elle-même
  auprès du composant (`$effect` de nettoyage dans `createResource`) supprimerait la question.

## 11. Postel et messages d'erreur

On trouvait trois styles de refus pour un corps invalide :

- `z.prettifyError()`, qui expose des chemins zod à l'utilisateur ;
- le premier problème ;
- un texte fixe.

Et `c.req.json()` sans `catch` à quelques endroits : un corps non JSON donnait une 500.

`readBody()` traite un corps absent ou illisible comme `null`, donc comme un refus de validation 400 et jamais comme une
500. Par défaut il rend le premier problème, et une route peut donner son propre texte. Les messages existants ont été
gardés mot pour mot.

## 12. Types en double entre front et serveur

- `NewTask` : `web/src/lib/api.ts:171` et `server/sources/lists.ts:55`, identiques.
- `SessionReport` (`web/src/lib/api.ts:44`) recopie `SessionInput` (`server/sources/fitness.ts:52`).
- `FaceDiagnosis` (`web/src/lib/api.ts:70`) recopie `FaceVerdict` (`server/sources/faces.ts:50`).

`shared/types.ts` existe précisément pour ça. Une divergence ne se verrait qu'à l'exécution.

## 13. Rangement

- `server/sources/pronote.ts:11` importe `formatSubject` et `normalizeName` de `ecoledirecte.ts` : une source dépend
  d'une autre. Ces fonctions vont dans un module scolaire commun.
- `Logger` est défini dans `server/config-store.ts:18`, et `WEEK_DAYS` dans `server/config.ts:16` : des types
  transverses rangés dans des modules spécialisés.
- `server/config.ts` n'a pas de commentaire d'en-tête (règle 3 du projet).

## 14. Tests

Les points forts :

- 415 tests ;
- horloge figée (`server/testing.ts`) ;
- vrais fichiers temporaires plutôt que des simulacres ;
- double passage heure locale / UTC ;
- tests d'API de bout en bout sur `app.request`.

Les manques :

- **Sources sans test** : `transit-settings`, `fitness` (le magasin ; les règles de `shared/` sont testées), `stock`
  (le magasin), `gtfs-rt`, `geocode`.
- **Front** : rien sur les composants, qui portent pourtant de la logique (point 8). `web/src/lib/` est bien couvert.
- **Avant la refonte**, les droits (`access.ts`), le PIN, la reconnaissance faciale et le stock n'étaient testés qu'au
  travers de HTTP, et pas tous les refus. La branche ajoute `access.test.ts`, `pin-gate.test.ts`, `http.test.ts`,
  `household.test.ts`, `services/faces.test.ts`, `services/stock.test.ts`, `services/transit.test.ts` et
  `json-file.test.ts`.

## Ce que la branche a changé

| Commit | Contenu |
|---|---|
| `905610e` | Un seul module de persistance (`json-file.ts`, écriture avant la mémoire) ; `shared/dates.ts` ; `authorSchema` |
| `598e051` | Routes fines par groupe, `http.ts` (erreurs), gardes d'accès qui lèvent, `pin-gate.ts`, `household.ts`, services `faces` et `stock` |
| `ff4bd37` | Bus et trajet du matin dans `services/transit.ts` ; `accessory()` pour les sources en panne |
| `b99dec0` | Traits des routes du front au même endroit |

Aucune route, aucun JSON ni aucun écran ne change. Pas de nouvelle fonctionnalité, pas de changement de version.

## Prochaines étapes, par valeur

1. **Proxy de confiance** pour `X-Real-IP` (point 1), avec le compose du NAS.
2. **Contrôle d'accès sur `recheck`** (point 5).
3. **Minuteur de séance** sorti dans `web/src/lib/` avec ses tests, et correction du verrou d'écran (point 10).
4. **Découper `Scan.svelte`** : machine à états du scan dans `web/src/lib/scan.ts`, fiche produit et formulaires en
   composants. Même travail ensuite pour `Transit.svelte` et `SportPanel.svelte`.
5. **Types partagés** dans `shared/types.ts` (point 12), et un `household` côté client (point 7).
6. **Tests des magasins** `transit-settings`, `fitness`, `stock`, et des sources `gtfs-rt`, `geocode`.
7. **`createResource`** qui se nettoie seul et se met en pause page cachée.
8. **Rangement** : module scolaire commun (Pronote / ÉcoleDirecte), `Logger` et `WEEK_DAYS` dans des modules
   transverses, `ENTITIES` et `normalize` réunis, en-tête de `config.ts`.
