---
name: homehub-monde-fictif
description: Run HomeHub in its fictional world (test family, fake school and transit services, frozen clock) to look at a screen, drive it as the tablet, a paired phone or a recognized person, and add or update a documentation capture. Use when checking a HomeHub UI change in a real browser, reproducing a screen, or touching scripts/docs-captures.ts.
---

# The fictional world (monde fictif)

`scripts/docs-captures.ts` starts the **real** HomeHub server (`scripts/docs-captures/server.ts`) with a fictional
configuration (`scripts/docs-captures/homehub.yaml`: Alex, Sam, Léa, Tom, Angers), fake services
(`scripts/docs-captures/fake-world.ts`: ÉcoleDirecte, Irigo real time, product databases) and a fresh state folder
written by the script (paired phones, sport programme, fictional face…). Nothing real: never point it at real
accounts. Weather (Open-Meteo) and GTFS timetables are the real ones, hence capture noise.

## Look at a screen
```bash
npm run -s build                                   # the server serves web/dist: rebuild after every front change
DOCS_SERVE=1 node scripts/docs-captures.ts         # run_in_background: true; stays up on http://localhost:3190
```
Then open it in the built-in browser (`mcp__Claude_Browser__navigate`). Stop it with TaskStop when done.

- **Tablet**: the server sees the page from loopback, so the browser *is* the tablet (kiosk).
- **Paired phone**: before loading a `/m…` page, run in the page:
  `localStorage.setItem('homehub.phone', JSON.stringify({ token: 'docs-alex', ownerId: 'alex' }))`
  (or `docs-lea` / `lea`), then reload.
- **Recognized person on the tablet** (no camera in the browser pane or headless Chrome): the state holds a fictional
  face for Alex, embedding `Array.from({ length: 128 }, (_, i) => Math.sin(i + 1))`. Open a session and present it
  with every API request:
  ```js
  const FACE = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
  const { token } = await (await fetch('/api/faces/identify', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embedding: FACE, real: 1, live: 1 }) })).json();
  const f = window.fetch;
  window.fetch = (url, init = {}) => f(url, String(url).includes('/api/') ? { ...init, headers: { ...init.headers, 'X-Actor-Session': token } } : init);
  ```
  The patch survives in-app navigation (SPA), not a reload. The server then treats requests as Alex in front of
  the tablet; the front's `actor.current` stays null (screens that need the person must ask the server).

## Pitfalls already met
- **Run the captures in the foreground**, never with `run_in_background`: one Bash call with a long `timeout`
  (`600000`). Three sessions ended their turn "waiting for the captures to finish" and were never woken up again,
  leaving the work half done. If a run might take longer than 10 min, reshoot by groups with the name filter
  (`node scripts/docs-captures.ts "tablette"`, then `"telephone"`), each in the foreground. Never end a turn while
  something you need is still running. (Only `DOCS_SERVE=1`, which never ends, goes in the background.)
- **Clock**: the *server* runs on Thursday 5 November 2026, 07:35 (then advances). The capture script also fakes the
  *browser* clock; the browser pane does not, so "this week" or "today" on screen may disagree with server data.
- **Hidden browser pane**: `requestAnimationFrame` is paused, animations look frozen. Check motion by sampling state
  over time (e.g. an SVG path's `d` twice, a second apart), not by screenshots.
- `get_page_text` / `read_page` / `javascript_tool` are more reliable than screenshots for checking values.
- Camera requests are blocked in the browser pane (notice shown): expected, not a bug.
- **Port 3190 already taken** (another worktree left its fictional world open): don't kill it, run with
  `DOCS_PORT=3290` (the Chrome debugging port follows, +1). The script now refuses to start when the port already
  answers: it used to write its data into the other session's fictional world.

## Drive extension (« Remplir le panier »)
`npm run extension:check` builds `extension/dist` and drives the real content script in headless Chrome on fake
www.coursesu.com pages (requests intercepted, served by `scripts/docs-captures/fake-drive.ts`, never the real site),
checks the stop rule (captcha, unconfirmed add, unexpected page) and reshoots `ordinateur-extension-*.png`. Run it in
the foreground (~2 min). The real site's selectors are unknown: keep the fake page in line with `SELECTORS` in
`extension/src/coursesu.ts`.

## Add or update a documentation capture
In `scripts/docs-captures.ts`:
- Data for the screen goes into the state written before the server starts (e.g. `fitness.json`, `faces.json`,
  `devices.json`) or through `call(token, method, path, body)` once it runs. Keep data plausible and fictional.
- `await shoot(name, url, TABLET | PHONE, { init, after, wait, camera })`
  - `init`: script run before the page loads (`asPhone('alex')`, `asAlexAtTablet`, fake BarcodeDetector…);
  - `after`: script run after load + `wait` ms (default 3000), then 1 s pause before the shot; use `click('Label')`
    (exact button text) and `setTimeout` for multi-step flows;
  - output: `docs/images/<name>.png`. Name it `tablette-…` or `telephone-…`.
- Reshoot only what you touched: `node scripts/docs-captures.ts "<regex on names>"` (after `npm run build`).
- Read every new png. Reference it in `docs/ecrans.md` (tablet: full width; phone: tables of 3 or `<img width="260">`).
- Enriching shared data (e.g. more sport sessions) can change other captures: reshoot the whole family of screens and
  look at them.

## Done when
The screen was seen working (values read, flow clicked through), server stopped, captures read and referenced.
