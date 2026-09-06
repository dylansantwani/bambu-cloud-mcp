# bambu-cloud-mcp

**Control your Bambu Lab 3D printers from any MCP client — over the cloud, from anywhere, with live chamber-camera capture on your LAN.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-server-000000)](https://modelcontextprotocol.io)

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that lets an AI assistant — Claude Code, Claude Desktop, or any MCP client — monitor and drive Bambu Lab printers. It talks to printers over MQTT, either on your **LAN** or through the **Bambu cloud broker** (`us.mqtt.bambulab.com` / `cn.mqtt.bambulab.com`), so status and control work from anywhere without putting the printer into LAN-Only mode. It ships **31 tools** covering status, print control, temperatures, AMS/filament, files, and a live LAN chamber-camera snapshot.

## Why this over other Bambu MCP servers

Most community Bambu MCP servers only do **LAN** control, or **read-only** cloud status. This one does two things they usually don't:

- **Full cloud control** — every command (pause, resume, stop, set temp, change filament, raw G-code…) works over the internet, because the Bambu cloud MQTT broker accepts the same command topics (`device/<serial>/request`) as the local one. Log in once with your account and your bound printers auto-connect.
- **Live chamber camera** — `get_camera_frame` pulls a real JPEG snapshot from A1 / A1 Mini / P1P / P1S printers over the LAN and returns it as an image your MCP client can display.

> **Camera is LAN-only.** Bambu tunnels the cloud video feed through a proprietary P2P system (TUTK) that can't be reimplemented in the open, so the camera works only when your machine is on the same network as the printer. Status and control work from anywhere.

## Supported printers

- **Control (LAN + cloud):** A1, A1 Mini, P1P, P1S, X1C, X1E, H2D and other current models.
- **Camera (LAN only):** A1, A1 Mini, P1P, P1S via the port-6000 chamber-image protocol. X1/H2 series use RTSP instead and aren't wired up yet — PRs welcome.

## Tools

All 31 tools, grouped by area:

### Cloud
| Tool | Description |
|---|---|
| `cloud_status` | Login status, account, region, token expiry, connected cloud printers |
| `sync_cloud_printers` | Discover and connect printers bound to your account over the cloud |
| `cloud_logout` | Clear stored cloud credentials and disconnect cloud printers |

### Printer management
| Tool | Description |
|---|---|
| `add_printer` | Add a LAN printer (IP + access code + serial) and connect |
| `remove_printer` | Remove a printer from the fleet |
| `reconnect_printer` | Re-establish MQTT connection(s) |
| `list_printers` | List configured printers and connection status |

### Status
| Tool | Description |
|---|---|
| `get_status` | Print progress, temps, speed, AMS, lights, stage, etc. |
| `get_version` | Firmware / module versions |

### Print control
| Tool | Description |
|---|---|
| `pause_print` / `resume_print` / `stop_print` | Control the active print |
| `start_print` | Start a `.3mf` / `.gcode` file already on the SD card (plate, AMS mapping, bed type, calibration options) |
| `start_prints` | Start the same file across multiple printers in parallel |

### Hardware
| Tool | Description |
|---|---|
| `set_speed` | Print speed (profile name or percentage) |
| `set_temperature` | Nozzle / bed temperature (with safety limits) |
| `set_light` | Chamber / work light on or off |
| `set_nozzle` | Nozzle diameter (for slicer profiles) |

### AMS / filament
| Tool | Description |
|---|---|
| `change_filament` | Load / switch filament from an AMS slot |
| `unload_filament` | Unload the current filament |

### G-code
| Tool | Description |
|---|---|
| `send_gcode` | Send raw G-code (some dangerous commands blocked) |
| `skip_objects` | Skip objects in a multi-object print |

### Files (LAN, FTPS)
| Tool | Description |
|---|---|
| `list_files` | List files on the printer's SD card |
| `upload_file` | Upload a file to the SD card |
| `download_file` | Download a file from the SD card |
| `delete_file` | Delete a file from the SD card |

### Camera (LAN only)
| Tool | Description |
|---|---|
| `get_camera_frame` | Capture a live JPEG from the chamber camera, returned as an image |
| `set_camera_access` | Store a printer's LAN access code (and optional IP) for the camera |
| `set_recording` | Toggle SD-card recording |
| `set_timelapse` | Toggle timelapse |

### Signing
| Tool | Description |
|---|---|
| `sign_message` | X.509 message signing for post-January-2025 firmware that requires certificate auth |

## Requirements

- **Node.js 18+**
- For **cloud control:** a Bambu Lab account (the one your printers are bound to). No developer token needed — you log in with an emailed code, password, or 2FA.
- For the **camera:** your machine on the same LAN as the printer, with **"LAN Mode Liveview" enabled** on the printer (Settings). This is independent of full LAN-Only mode, so the Bambu Handy app keeps working.

## Installation

```bash
git clone https://github.com/dylansantwani/bambu-cloud-mcp.git
cd bambu-cloud-mcp
npm install
npm run build
```

This compiles TypeScript to `dist/`. The MCP entry point is `dist/index.js`.

## Command-line use

`bambu-cli.js` drives the same printers from a shell, with no MCP client and no
server running. It reads the printer config and cloud credentials this server
already stores, so once the MCP side is configured the CLI needs no setup.

```bash
node bambu-cli.js                 # status of every registered printer
node bambu-cli.js watch           # poll and redraw until Ctrl+C
node bambu-cli.js status -j       # JSON, for scripting
node bambu-cli.js printers        # list what is registered
node bambu-cli.js version         # firmware versions
```

| Command | What it does |
|---|---|
| `status` (default) | one-shot status for all printers; `-1` / `--once` to force single-shot |
| `watch` | continuously poll and redraw |
| `printers` | list registered printers from config |
| `version` | firmware versions |
| `pause` / `resume` | pause or resume the current print |
| `stop` | stop the current print, with a confirmation prompt |
| `speed <1\|2\|3\|4\|off>` | set print speed (3 = sport) |

Options: `-p, --printer <id\|name\|serial>` targets one printer instead of all,
`-j, --json` emits JSON, `-h, --help` shows usage.

## Configuration

### Register the server with your MCP client

**Claude Code** (user scope — available in every project):

```bash
claude mcp add bambu -s user -- node /absolute/path/to/bambu-cloud-mcp/dist/index.js
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bambu": {
      "command": "node",
      "args": ["/absolute/path/to/bambu-cloud-mcp/dist/index.js"]
    }
  }
}
```

Restart the client (or start a new session) so it picks up the server.

### Environment variables

All are optional:

| Variable | Purpose |
|---|---|
| `BAMBU_MCP_CONFIG_DIR` | Directory for runtime config and credentials. Default: `~/.bambu-mcp`. |
| `BAMBU_APP_PRIVATE_KEY` | Override the bundled X.509 private key used by `sign_message`. |
| `BAMBU_APP_CERTIFICATE` | Override the bundled X.509 certificate used by `sign_message`. |

To set the config directory in a client, add an `env` block to the server entry:

```json
{
  "mcpServers": {
    "bambu": {
      "command": "node",
      "args": ["/absolute/path/to/bambu-cloud-mcp/dist/index.js"],
      "env": {
        "BAMBU_MCP_CONFIG_DIR": "/absolute/path/to/config"
      }
    }
  }
}
```

### Cloud login (for remote control)

Run the interactive login **in your own terminal** (it needs to prompt you, so it can't run inside the MCP client):

```bash
npm run login
```

- Choose your **region** (US default).
- Enter your **account email**.
- Pick **method 1 (email code)** — no password needed; a one-time code is emailed to you. Password and TOTP-2FA are also supported.

Credentials are written to `~/.bambu-mcp/cloud.json` (mode `0600`). Your password, if you use one, is only ever sent to Bambu's login endpoint — never stored. On the next server start, your bound printers are auto-discovered and connected over the cloud; you can also trigger this anytime with the `sync_cloud_printers` tool.

### Camera access (optional, LAN only)

The camera needs each printer's **8-character LAN access code** (printer screen → *Settings → WLAN*). Store it once via the `set_camera_access` tool (or just ask your assistant to). The printer's LAN IP is auto-detected from its status, so you don't hardcode it. Then `get_camera_frame` returns a live snapshot.

## Usage

Once the server is registered and you've logged in, talk to your assistant in plain language. Examples:

- "List my Bambu printers and show their status."
- "What's the progress on the print on my P1S?"
- "Pause the print on printer `mini-1`."
- "Set the nozzle temperature on my X1C to 220°C."
- "Show me a camera snapshot of the A1."
- "Start `benchy.3mf` on all my printers."
- "Unload the filament, then load slot 2."

To add a LAN-only printer directly (no cloud account): "Add a printer at 192.168.1.50 with access code 12345678 and serial 01P00A123456789."

## How it works

A printer's `mode` decides how its MQTT client connects:

- **LAN mode** connects to the printer's IP with username `bblp` + the printer's access code.
- **Cloud mode** connects to `us.mqtt.bambulab.com` (or `cn.` for China) with username `u_<uid>` + your account token.

The command topics (`device/<serial>/request` and `/report`) are identical in both, which is why every control tool works the same over the cloud as on the LAN. File operations use FTPS (`basic-ftp`), and the chamber camera speaks the printer's TLS port-6000 image protocol directly (`camera-client.ts`).

```
src/
  index.ts            MCP server entry; registers tools, auto-connects on startup
  fleet-manager.ts    Multi-printer connection manager (LAN + cloud branches)
  mqtt-client.ts      Bambu MQTT protocol (status + all control commands)
  bambu-cloud.ts      Cloud API: login, email-code/2FA, device discovery, refresh
  cloud-store.ts      ~/.bambu-mcp/cloud.json credential store
  login-cli.ts        Interactive `npm run login`
  camera-client.ts    LAN chamber-image capture (TLS port 6000 → JPEG)
  camera-store.ts     ~/.bambu-mcp/cameras.json access-code store
  ftp-client.ts       FTPS file operations
  tools/              One file per tool group
```

All credentials stay **local** in `~/.bambu-mcp/` (`cloud.json`, `cameras.json`, `printers.json`), written `0600` and git-ignored. Nothing is sent anywhere except Bambu's own API and MQTT broker.

## Troubleshooting

- **Cloud login 403** — Bambu's API sits behind Cloudflare; wait a moment and retry.
- **`sync_cloud_printers` returns 0 printers** — you're logged into an account with no bound printers. Log in with the account your Bambu Handy app uses.
- **Camera `ECONNREFUSED`** — "LAN Mode Liveview" isn't enabled on that printer, or the printer is offline (the IP is auto-detected from status).
- **Camera timeout** — your machine isn't on the same network as the printer. The camera is LAN-only.
- **`connack timeout` / `ECONNRESET` on LAN** — a Bambu printer allows only one local MQTT client; close BambuStudio / OrcaSlicer / Home Assistant and retry.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, build steps, and the Conventional Commits convention. If you're using an AI coding agent, [AGENTS.md](./AGENTS.md) has repo-specific notes.

## Credits

- **LAN control base:** [griches/bambu-mcp](https://github.com/griches/bambu-mcp) — the original MQTT control layer and local toolset this project forks and builds on.
- **Cloud control, passwordless login, and LAN camera capture** are original additions in this fork.
- Cloud protocol details informed by [ha-bambulab / pybambu](https://github.com/greghesp/ha-bambulab); camera protocol per community reverse-engineering documented on the [Bambu Lab forums](https://forum.bambulab.com/t/p1p-camera-module-communication-standard/6829).

## License

[MIT](./LICENSE). The upstream base (griches/bambu-mcp) does not publish an explicit license; this fork attributes it prominently and MIT-licenses the original additions. If you're the upstream author and would like different handling, please open an issue.
