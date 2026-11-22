# The Oasis (packaged): notes for a coding agent

This folder is the Oasis, a local app: a page server (Next.js, port 4516) and an agent engine (port 4530) that shows the user's Claude Code sessions as characters in a 3D village in the browser.

## Install and open it

```
node scripts/oasis.mjs start
```

That is the only command needed, on Windows, macOS and Linux. The first time it installs the packages (pnpm, from the lockfile), writes `.env`, creates the database and seeds the first worlds, builds the app, then starts both servers and opens the browser at the village. Give it up to ten minutes the first time; run it in the background if your shell has a time limit.

Do not run `next dev`, `next start`, `pnpm dev` or `npm start` by hand instead: `pnpm dev` and `npm start` call the start script anyway, but `next` alone starts the page without the engine, the database or the village, and the user sees an empty world with no way to summon an agent.

## When something is wrong

- `node scripts/oasis.mjs status` says what is running; `node scripts/oasis.mjs stop` stops it.
- Logs: `logs/world.log` (the page server) and `logs/engine.log` (the engine).
- The address must carry `?profile=village`; the start script opens the right one, with the local key.
- Ports taken: `OASIS_WEB_PORT` and `OASIS_PORT` pick others.
- Report what you found, or a fix, at https://github.com/Parzival-Moksha/uploader/issues (pull requests welcome: see CONTRIBUTING.md).
