# bambu-cloud-mcp

An [MCP](https://modelcontextprotocol.io) server for **Bambu Lab 3D printers** that adds two things most Bambu MCP servers don't have:

- ☁️ **Cloud control** — drive your printers over the internet from anywhere (like the Bambu Handy app), using account-token auth. No need to be on the same network, and **no LAN-Only mode** (Handy keeps working).
- 📷 **Live chamber camera** — pull a real JPEG snapshot from A1 / A1 Mini / P1P / P1S printers, returned as an image your MCP client can actually display.

Plus the full local-control toolset: status, print control, temperatures, AMS/filament, files, lights, speed, raw G-code — 31 tools total, usable from any MCP client (Claude Code, Claude Desktop, etc.).

---

## Why this exists

Bambu printers speak two "languages":

| | **LAN** (same network) | **Cloud** (over the internet) |
|---|---|---|
| Status & control | ✅ | ✅ |
| Chamber camera | ✅ | ❌ *(see note)* |

Most community MCP servers only do **LAN** control, or only **read-only** cloud status. This server does **full cloud control** — every command (pause, resume, stop, set temp, change filament, G-code…) works remotely, because the Bambu cloud MQTT broker accepts the same commands as the local one.

> **Camera note:** the live camera can only be reached on the **local network**. Bambu tunnels the video feed through a proprietary P2P system (TUTK) driven by their closed-source network agent, which can't be reimplemented in the open. So status/control work from anywhere; the camera works only when your machine is on the same Wi-Fi as the printer.

---

## Supported printers

Control (LAN + cloud): **A1, A1 Mini, P1P, P1S, X1C, X1E, H2D** and other current models.

Camera (LAN only): **A1, A1 Mini, P1P, P1S** via the port-6000 chamber-image protocol. (X1/H2 series use RTSP instead and aren't wired up here yet — PRs welcome.)

---

## Requirements

- **Node.js 18+**
- For **cloud**: a Bambu Lab account (the one your printers are bound to)
- For **camera**: your machine on the same LAN as the printer, with **"LAN Mode Liveview" enabled** on the printer (Settings — this is *independent* of full LAN-Only mode, so Handy still works)

---

## Install

```bash
git clone https://github.com/dylansantwani/bambu-cloud-mcp.git
cd bambu-cloud-mcp
npm install
npm run build
```

### Register with your MCP client

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

Restart / start a new session so the client picks up the server.

---

## Setup

### 1. Cloud login (for remote control)

Run the interactive login **in your own terminal**:

```bash
npm run login
```

- Choose your **region** (US default).
- Enter your **account email**.
- Pick **method 1 (email code)** — no password needed; a one-time code is emailed to you. (Password and TOTP-2FA are also supported.)

Credentials are stored in `~/.bambu-mcp/cloud.json` (mode `0600`). The token lasts ~3 months and auto-refreshes; re-run `npm run login` when it finally expires.

On the next server start, your bound printers are auto-discovered and connected over the cloud. You can also trigger this anytime with the `sync_cloud_printers` tool.

### 2. Camera access (optional, LAN only)

The camera needs each printer's **8-digit LAN access code** (printer screen → *Settings → WLAN*). Store it once via the `set_camera_access` tool, or ask your MCP client to. The printer's LAN IP is auto-detected from its status — no need to hardcode it.

Then: `get_camera_frame` returns a live snapshot.

---

## Tools

### Cloud
| Tool | Description |
|---|---|
| `cloud_status` | Login status, account, region, token expiry, connected cloud printers |
| `sync_cloud_printers` | Discover & connect printers bound to your account over the cloud |
| `cloud_logout` | Clear stored cloud credentials and disconnect cloud printers |

### Camera
| Tool | Description |
|---|---|
| `get_camera_frame` | Capture a live JPEG from the chamber camera (LAN), returned as an image |
| `set_camera_access` | Store a printer's LAN access code (and optional IP) for the camera |

### Printer management
| Tool | Description |
|---|---|
| `add_printer` | Add a LAN printer (IP + access code + serial) |
| `remove_printer` | Remove a printer |
| `reconnect_printer` | Re-establish MQTT connection(s) |
| `list_printers` | List configured printers and connection status |

### Status & control
| Tool | Description |
|---|---|
| `get_status` | Print progress, temps, speed, AMS, lights, etc. |
| `get_version` | Firmware / module versions |
| `pause_print` / `resume_print` / `stop_print` | Print control |
| `start_print` / `start_prints` | Start a file already on the SD card (single or fleet-parallel) |
| `set_speed` | Print speed (profile name or %) |
| `set_temperature` | Nozzle / bed temp (with safety limits) |
| `set_light` | Chamber / work light |
| `set_nozzle` | Nozzle diameter (for profiles) |
| `skip_objects` | Skip objects in a multi-object print |
| `send_gcode` | Raw G-code (some dangerous commands blocked) |

### Files (LAN, FTP)
| Tool | Description |
|---|---|
| `list_files` / `upload_file` / `download_file` / `delete_file` | SD-card file ops |

### AMS / camera recording
| Tool | Description |
|---|---|
| `change_filament` / `unload_filament` | AMS control |
| `set_recording` / `set_timelapse` | Camera recording / timelapse toggles |

### Signing
| Tool | Description |
|---|---|
| `sign_message` | X.509 signing for post-Jan-2025 firmware auth |

---

## Architecture

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

**Cloud vs LAN:** a printer's `mode` decides how the MQTT client connects. LAN mode uses the printer's IP with username `bblp` + access code. Cloud mode uses `us.mqtt.bambulab.com` (or `cn.` for China) with username `u_<uid>` + your account token. The command topics (`device/<serial>/request` and `/report`) are identical, which is why every control tool "just works" over the cloud.

---

## Security & privacy

- All credentials stay **local** in `~/.bambu-mcp/` (`cloud.json`, `cameras.json`, `printers.json`), written `0600`. Nothing is sent anywhere except Bambu's own API/broker.
- These files are git-ignored and are **never** part of the repo.
- Your password is only ever sent to Bambu's login endpoint (email-code login avoids sending a password at all).

---

## Troubleshooting

- **Cloud login 403** — Bambu's API sits behind Cloudflare; retry in a moment.
- **`sync_cloud_printers` returns 0 printers** — you're logged into an account with no bound printers. Log in with the account your Bambu Handy app uses.
- **Camera `ECONNREFUSED`** — "LAN Mode Liveview" isn't enabled on that printer, or you have the wrong IP (it's auto-detected from status, so make sure the printer is online).
- **Camera timeout** — your machine isn't on the same network as the printer. The camera is LAN-only.
- **`connack timeout` / `ECONNRESET`** on LAN — a Bambu printer allows only one MQTT client; close BambuStudio/OrcaSlicer/Home Assistant and retry.

---

## Credits

- **LAN control base:** [griches/bambu-mcp](https://github.com/griches/bambu-mcp) — the original MQTT control layer and local toolset this project forks and builds on.
- **Cloud control, passwordless login, and LAN camera capture** are original additions in this fork.
- Cloud protocol details informed by the excellent [ha-bambulab / pybambu](https://github.com/greghesp/ha-bambulab) project; camera protocol per the community reverse-engineering documented on the [Bambu Lab forums](https://forum.bambulab.com/t/p1p-camera-module-communication-standard/6829).

## License

[MIT](./LICENSE). Note the upstream base (griches/bambu-mcp) does not publish an explicit license; this fork attributes it prominently and MIT-licenses the original additions. If you're the upstream author and would like different handling, please open an issue.
