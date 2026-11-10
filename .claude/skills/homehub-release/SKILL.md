---
name: homehub-release
description: Start and release a new HomeHub version. Each new version is developed in its own sub-session; then version bump, type check, tests in local time and UTC, build, docs captures with noise cleanup, commit, tag, push only after the user's approval, CI watch. Use when the user asks for a new HomeHub version or feature, when a batch of HomeHub changes is ready to ship, or when the user asks to release, tag, or push HomeHub.
---

# Releasing HomeHub

One batch of changes = one version. Run from the repo root (`C:\src\DeafLight\homehub`).
Deployment on the NAS is a separate step in the private NAS config repo (its `truenas-app-deploy` skill,
"HomeHub" section): prepare it right after tagging, push both together once the user approves.

## 0. Every new version starts in its own sub-session (user's standing rule)
When the user asks for a new version, or for a feature that will become one, do not develop it in the current
session: start a new session for it (`start_session`, the user asked for it in words), then answer in one line where
it runs. The brief must stand alone:
- repo `C:\src\DeafLight\homehub` (and the NAS config repo for deployment), target version `X.Y.Z`;
- the scope agreed with the user, in your own words (what the user will see, what is out of scope), and the
  relevant `TODO.md` item;
- follow `CLAUDE.md`, this skill and `homehub-monde-fictif`; check the screens in the fictional world;
- done = HomeHub tag `vX.Y.Z` and NAS config commit ready, the user asked once before pushing both.
Small fixes to a version still in progress, and questions, stay in the session that has the context.

## 1. Before the version bump
- Feature complete: tests next to the code, `README.md` (feature bullet), `docs/ecrans.md`, `TODO.md` box checked.
- Version: minor for a feature (0.38.0 → 0.39.0), patch for a fix (0.35.0 → 0.35.1).

## 2. Bump and verify (stop at the first failure and fix it)
```bash
npm version X.Y.Z --no-git-tag-version --ignore-scripts   # package.json + package-lock.json, no tag yet
npm run -s check                                          # 0 errors, 0 warnings
npx vitest run                                            # all green
TZ=UTC npx vitest run                                     # again in UTC: catches local-date bugs
npm run -s build
npm run -s docs:captures                                  # rebuilds and reshoots docs/images
```
Also bump the version in the first line of `docs/ecrans.md` ("Captures de HomeHub X.Y.Z").

## 3. Clean up capture noise
Captures are reshot every time; many differ only by noise. Keep a changed image only if the release changed that
screen; otherwise restore it.
- Always noise: tablet captures (`tablette-*.png`, real weather of the day), `planche-design.png`,
  `telephone-scanner.png` (fake camera frame), and any capture with a running animation
  (`telephone-sport-exercice.png`: frozen at another instant).
- Restore only *tracked* files (new captures are untracked and must be kept):
```bash
git ls-files -m docs/images | grep -E "tablette-|planche|telephone-scanner" | xargs -r git checkout --
```
- Look at every remaining changed or new image (Read the png) before committing.

## 4. Commit and tag
- Message in French, first line `X.Y.Z : <résumé>`, then bullets of what changed for the user; written to a file
  in the scratchpad (avoids shell quoting), ending with the attribution line from the system reminder.
- Commit identity (public repo, GitHub noreply address):
```bash
git add -A
git -c user.name=DeafLight -c user.email=16166397+DeafLight@users.noreply.github.com commit -q -F <message file>
git tag vX.Y.Z
```
- `git status --short` must be empty afterwards.

## 5. Push (only after the user says so)
Ask first, in one question covering both repos (HomeHub tag + NAS config commit). Then:
```bash
git push -q origin main vX.Y.Z
gh run list --limit 1                       # id of the "release" run for the tag
gh run watch <id> --exit-status > /dev/null && echo CI-OK
```
The tag workflow checks types and tests, builds and publishes `ghcr.io/deaflight/homehub:X.Y.Z`. Push the NAS config
commit only once CI is green (the image must exist before the compose points at it).

## Pitfalls already met
- `$state` name clash: a variable named `state` in a Svelte component breaks the `$state` rune; rename it.
- `Array.prototype.findLastIndex` is not in the web tsconfig lib: use `reduce`.
- Heredocs containing quotes or `$` break in Git Bash: write scripts and messages with the Write tool instead.
- Never `git add` captures blindly: a noisy `tablette-*.png` in a release commit makes the doc lie about the weather.

## Done when
CI green, tag on GitHub, the user told what to deploy and what to configure (if anything) after deployment.
