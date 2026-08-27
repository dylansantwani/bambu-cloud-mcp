# Contributing

Thanks for your interest in improving **bambu-cloud-mcp**. This is a small TypeScript MCP server, so the workflow is lightweight.

## Development setup

Requires **Node.js 18+**.

```bash
git clone https://github.com/dylansantwani/bambu-cloud-mcp.git
cd bambu-cloud-mcp
npm install
npm run build     # compile src/ -> dist/
```

Useful scripts (from `package.json`):

| Command | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm run dev` | `tsc --watch` — recompile on save. |
| `npm start` | Run the built server on stdio (`node dist/index.js`). |
| `npm run login` | Interactive Bambu cloud login (writes `~/.bambu-mcp/cloud.json`). |

There is no automated test suite yet. Verify changes by building cleanly (`npm run build` with no errors — the project uses `strict` mode) and by running the server against a real printer or MCP client. If you add tests, wire them into a `test` script and mention it in your PR.

### Testing against a client

Point Claude Code (or another MCP client) at your local build:

```bash
claude mcp add bambu-dev -s user -- node /absolute/path/to/bambu-cloud-mcp/dist/index.js
```

Rebuild and restart the client session after changes.

## Code style

- TypeScript, ES modules, 2-space indentation, `strict` mode on. Keep it compiling under the existing `tsconfig.json`.
- One file per tool group under `src/tools/`; register new tools with `server.tool(name, description, zodSchema, handler)` and wire the group into `src/index.ts`.
- Give every tool a clear description and Zod-described parameters — the descriptions are what the AI assistant reads to decide when and how to call the tool.
- Never log secrets. Credentials live only in `~/.bambu-mcp/` (git-ignored); don't commit `cloud.json`, `cameras.json`, or `printers.json`.

## Commit messages

This repo follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary>

<optional body explaining what and why>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`. Examples:

- `feat: add set_chamber_temp tool for X1 series`
- `fix: reconnect cloud MQTT after token refresh`
- `docs: clarify camera LAN-only requirement`

## Pull requests

1. Fork and branch from `main` (e.g. `feat/chamber-temp`).
2. Make focused changes; keep the build green.
3. Describe **what** changed and **why**, and note which printer model(s) you tested against — hardware behavior varies across models.
4. Open the PR against `main`.

By contributing, you agree your contributions are licensed under the project's [MIT License](./LICENSE).
