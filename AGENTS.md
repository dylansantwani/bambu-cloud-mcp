# AGENTS.md

Repo-specific notes for AI coding agents working on **bambu-cloud-mcp**, an MCP server that controls Bambu Lab 3D printers over MQTT (LAN + cloud).

## Build & run

- `npm install` then `npm run build` (TypeScript → `dist/`). `npm run dev` watches.
- Entry point is `dist/index.js`; the server speaks MCP over **stdio**.
- No test suite exists. "Green" means `npm run build` succeeds under `strict` mode with no errors. Do not claim tests pass — there are none to run.
- `npm run login` is interactive and needs a real terminal + Bambu account; don't invoke it in CI or non-interactive contexts.

## Layout

- `src/index.ts` — registers all tool groups and auto-connects configured printers on startup.
- `src/tools/*.ts` — one file per tool group; each exports a `registerXxxTools(server, fleet)` function.
- `src/fleet-manager.ts` — per-printer connection manager; branches on LAN vs cloud `mode`.
- `src/mqtt-client.ts` — the Bambu MQTT protocol (status + commands).
- `src/bambu-cloud.ts` / `src/cloud-store.ts` — cloud login/API and `~/.bambu-mcp/cloud.json`.
- `src/camera-client.ts` — LAN-only chamber JPEG capture (TLS port 6000).

## Adding a tool

Register with `server.tool(name, description, zodSchema, handler)`, then wire the group into `src/index.ts`. Write descriptions and Zod `.describe()` text for a reader who is an AI assistant deciding when to call the tool — they are the tool's real UX.

## Style & conventions

- TypeScript, ES modules, 2-space indent, `strict` on. Match existing files.
- **Commit messages: Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

## Gotchas

- **stdio transport:** never `console.log` to stdout — it corrupts the MCP JSON-RPC stream. Diagnostics go to `console.error` (stderr), as the existing code does.
- **One MQTT client per printer on LAN:** BambuStudio / OrcaSlicer / Home Assistant will block the connection (`connack timeout`). Cloud mode doesn't have this limit.
- **Camera is LAN-only** and needs "LAN Mode Liveview" on the printer. Don't add cloud-camera claims — the video feed uses proprietary P2P (TUTK) that isn't reimplementable here.
- **Cloud vs LAN share command topics** (`device/<serial>/request`), so control tools should be mode-agnostic; only connection/auth differs.
- **Secrets:** never log or commit credentials. They live in `~/.bambu-mcp/` (git-ignored). Config dir is overridable via `BAMBU_MCP_CONFIG_DIR`.
