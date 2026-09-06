#!/usr/bin/env node
// bambu-cli — command-line interface for your Bambu Lab printer fleet.
// Standalone (no MCP server required). Uses the same MQTT + cloud-credential
// plumbing as the MCP server in this directory.
// Run with: node bambu-cli.js <command> [options]

import { BambuMQTTClient } from "./dist/mqtt-client.js";
import { loadCloud, mqttHostForRegion } from "./dist/cloud-store.js";
import { loadConfig } from "./dist/config.js";

// ANSI helpers — drop-in replacement for chalk (no npm dependency)
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bg: (r, g, b) => `\x1b[48;2;${r};${g};${b}m`,
};

const R = (s) => `${ANSI.red}${s}${ANSI.reset}`;
const G = (s) => `${ANSI.green}${s}${ANSI.reset}`;
const Y = (s) => `${ANSI.yellow}${s}${ANSI.reset}`;
const C = (s) => `${ANSI.cyan}${s}${ANSI.reset}`;
const B = (s) => `${ANSI.bold}${s}${ANSI.reset}`;
const D = (s) => `${ANSI.dim}${s}${ANSI.reset}`;
const M = (s) => `${ANSI.magenta}${s}${ANSI.reset}`;

function pctStr(v) {
  if (typeof v === "number" && v >= 0 && v <= 100) return `${Math.round(v)}%`;
  if (typeof v === "string" && v.endsWith("%")) return v;
  return "—";
}
function tempStr(v, target) {
  if (v === undefined || v === null || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  const t = target !== undefined ? (typeof target === "string" ? parseFloat(target) : target) : null;
  if (isNaN(n)) return "—";
  const cur = `${Math.round(n)}°C`;
  return t !== null && !isNaN(t) ? `${cur} (→ ${Math.round(t)}°C)` : cur;
}
function timeRemaining(v) {
  if (v === undefined || v === null || v === 0) return "—";
  const mins = typeof v === "string" ? parseInt(v, 10) : v;
  if (isNaN(mins) || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function wifiStr(v) {
  if (!v) return "—";
  const s = typeof v === "string" ? v : `${v} dBm`;
  const num = typeof v === "string" ? parseInt(v, 10) : v;
  if (isNaN(num)) return s;
  if (num >= -50) return G(s);
  if (num >= -70) return Y(s);
  return R(s);
}
function stateColor(state) {
  if (!state) return D;
  const s = state.toUpperCase();
  if (s === "RUNNING") return G;
  if (s === "PREPARE" || s === "PAUSE" || s === "FINISH") return Y;
  if (s === "FAILED" || s === "IDLE") return R;
  return D;
}
function stageName(stage) {
  const stages = {
    "-1": "Idle", "0": "Printing", "1": "Auto bed leveling", "2": "Heatbed preheating",
    "3": "Sweeping XY mech mode", "4": "Changing filament", "5": "M400 pause",
    "6": "Paused — filament runout", "7": "Heating hotend", "8": "Calibrating extrusion",
    "9": "Scanning bed surface", "10": "Inspecting first layer", "11": "Identifying build plate type",
    "12": "Calibrating micro lidar", "13": "Homing toolhead", "14": "Cleaning nozzle tip",
    "15": "Checking extruder temperature", "16": "Paused by user", "17": "Pause — front cover falling",
    "18": "Calibrating micro lidar", "19": "Calibrating extrusion flow",
    "20": "Paused — nozzle temp malfunction", "21": "Paused — heat bed temp malfunction",
  };
  return stages[String(stage)] || `stage ${stage}`;
}
function speedLevel(v) {
  if (v === undefined || v === null) return "—";
  const map = { 1: "Silent", 2: "Standard", 3: "Sport", 4: "Ludicrous" };
  return map[Number(v)] || `Level ${v}`;
}
function colorSwatch(hex) {
  if (!hex || hex === "00000000" || hex === "000000FF") return "";
  const clean = hex.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (clean.length < 6) return "";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${ANSI.bg(r, g, b)}  ${ANSI.reset}`;
}
function printInfo(status) {
  const file = status.gcode_file || status.subtask_name || status.task_id || "—";
  const proj = status.project_id || status.task_id || "—";
  const pid = status.profile_id || "—";
  return `${file}  (proj ${proj}, profile ${pid}, type ${status.print_type || "—"})`;
}

// ---------------------------------------------------------------------------
// Connect, refresh status, disconnect — reusable for every subcommand
// ---------------------------------------------------------------------------
async function freshStatus(cfg) {
  const cloud = loadCloud();
  let mqttCfg;
  if (cfg.mode === "cloud" && cloud) {
    const host = mqttHostForRegion(cfg.region || cloud.region);
    mqttCfg = { host, port: 8883, username: cloud.username, password: cloud.accessToken, deviceId: cfg.serialNumber, model: cfg.model };
  } else if (cfg.mode === "lan") {
    mqttCfg = { host: cfg.host, port: 8883, username: "bblp", password: cfg.accessCode, deviceId: cfg.serialNumber, model: cfg.model };
  } else {
    if (!cloud) throw new Error(`No cloud credentials and printer '${cfg.id}' has no mode. Run npm run login first.`);
    const host = mqttHostForRegion(cfg.region || cloud.region);
    mqttCfg = { host, port: 8883, username: cloud.username, password: cloud.accessToken, deviceId: cfg.serialNumber, model: cfg.model };
  }
  const client = new BambuMQTTClient(mqttCfg);
  try {
    await client.connect();
    await client.requestStatus();
    await new Promise((r) => setTimeout(r, 2500));
    return client.getCachedStatus();
  } catch (err) {
    return null;
  } finally {
    client.disconnect();
  }
}
function makeMqttCfg(cfg) {
  const cloud = loadCloud();
  if (cfg.mode === "cloud" && cloud) {
    return {
      host: mqttHostForRegion(cfg.region || cloud.region),
      port: 8883,
      username: cloud.username,
      password: cloud.accessToken,
      deviceId: cfg.serialNumber,
      model: cfg.model,
    };
  }
  if (cfg.mode === "lan") {
    return { host: cfg.host, port: 8883, username: "bblp", password: cfg.accessCode, deviceId: cfg.serialNumber, model: cfg.model };
  }
  if (!cloud) throw new Error(`No credentials for printer '${cfg.id}'.`);
  return {
    host: mqttHostForRegion(cfg.region || cloud.region),
    port: 8883,
    username: cloud.username,
    password: cloud.accessToken,
    deviceId: cfg.serialNumber,
    model: cfg.model,
  };
}
async function sendCommand(cfg, command, params = {}) {
  const mqttCfg = makeMqttCfg(cfg);
  const client = new BambuMQTTClient(mqttCfg);
  try {
    await client.connect();
    return await client.sendCommand(command, params);
  } finally {
    client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------
async function cmdStatus(printers, json) {
  const results = await Promise.allSettled(
    printers.map(async (p) => {
      const status = await freshStatus(p);
      return { printer: p, status };
    }),
  );

  if (json) {
    const obj = results.map((r) => {
      if (r.status === "rejected") return { error: r.reason?.message };
      const { printer, status } = r.value;
      return {
        name: printer.name,
        id: printer.id,
        serialNumber: printer.serialNumber,
        model: printer.model || "—",
        mode: printer.mode || "cloud",
        status: status || { error: "no status received" },
      };
    });
    console.log(JSON.stringify(obj, null, 2));
    return;
  }

  console.log();
  console.log(B("Bambu Farm — Status") + `  ·  ${D(new Date().toLocaleTimeString())}  ·  ${printers.length} printer(s)`);
  console.log();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const p = printers[i];
    if (r.status === "rejected") {
      console.log(R(`  ✗ ${p.name} — ${r.reason?.message || "failed"}`));
      continue;
    }
    const { printer, status } = r.value;
    if (!status) {
      console.log(R(`  ✗ ${printer.name} — no status received (offline or blocked)`));
      continue;
    }

    const state = status.gcode_state || "UNKNOWN";
    const sc = stateColor(state);
    const pct = pctStr(status.mc_percent);
    const remain = timeRemaining(status.mc_remaining_time);
    const nozzle = tempStr(status.nozzle_temper, status.nozzle_target_temper);
    const bed = tempStr(status.bed_temper, status.bed_target_temper);
    const chamber = status.chamber_temper !== undefined ? `${status.chamber_temper}°C` : "—";
    const wifi = wifiStr(status.wifi_signal);
    const speed = speedLevel(status.spd_lvl);
    const sName = status.subtask_name || status.gcode_file || "—";
    const layer = status.layer_num !== undefined && status.total_layer_num !== undefined
      ? `${status.layer_num}/${status.total_layer_num}` : "—";
    const stage = status.stg_cur !== undefined && status.gcode_state !== "IDLE" && status.gcode_state !== "FINISH"
      ? stageName(status.stg_cur) : "—";
    const age = status._age_seconds !== undefined ? `${status._age_seconds}s ago` : "";
    const sep = "─".repeat(64);

    console.log(B(`  ${printer.name}`) + `  ${D(`(sn ${printer.serialNumber}, ${printer.model || "N2S"}, ${printer.mode || "cloud"})`)}`);
    console.log(D(`  ${sep}`));
    console.log(`  ${sc(B(state))}  ·  ${pct}  ·  ${remain !== "—" ? G(remain) : "—"}  ·  ${layer}  ·  ${stage}`);
    console.log(`  ${printInfo(status)}`);
    console.log(D(`  ${sep}`));
    console.log(`  Nozzle:  ${nozzle}`);
    console.log(`  Bed:     ${bed}`);
    console.log(`  Chamber: ${chamber}`);
    console.log(`  Speed:   ${speed}`);
    console.log(`  WiFi:    ${wifi}  ${age ? D(`· ${age}`) : ""}`);
    if (status.ams?.ams?.length) {
      const trays = [];
      for (const ams of status.ams.ams) {
        for (const tray of ams.tray || []) {
          const col = tray.tray_color || "00000000";
          const type = tray.tray_type || "empty";
          const id = tray.id;
          const swatch = col !== "00000000" && col !== "000000FF" ? colorSwatch(col) : "";
          trays.push(`T${id}:${swatch}${type} (${col})`);
        }
      }
      if (trays.length) console.log(`  AMS: ${trays.join("  ")}`);
    }
    console.log();
  }
}

async function cmdVersion(printers) {
  console.log();
  console.log(B("Firmware Versions"));
  console.log();
  for (const p of printers) {
    console.log(B(`  ${p.name}`) + `  ${D(`(sn ${p.serialNumber})`)}`);
    try {
      const ver = await sendCommand(p, "info.get_version");
      await new Promise((r) => setTimeout(r, 500));
      if (ver && Array.isArray(ver)) {
        for (const m of ver) {
          const sw = m.sw_ver || "—";
          const nv = m.new_ver ? Y(`→ ${m.new_ver}`) : D("—");
          const flag = m.flag !== undefined ? ` flag:${m.flag}` : "";
          console.log(`    ${C(m.name.padEnd(12))} ${G(sw)}  ${nv}  ${D(m.hw_ver || "")}${flag}`);
        }
      } else {
        console.log(D(`    ${JSON.stringify(ver)}`));
      }
    } catch (err) {
      console.log(R(`    ✗ ${err.message}`));
    }
    console.log();
  }
}

async function cmdPrinters() {
  const cfg = loadConfig();
  const cloud = loadCloud();
  console.log();
  console.log(B("Registered Printers"));
  console.log();
  if (cfg.printers.length === 0) {
    console.log(D("  No printers configured."));
    console.log(D("  Add one with: bambu-cli.js printers add <name> <serial> <host> [mode]"));
    console.log();
    return;
  }
  for (const p of cfg.printers) {
    const online = cloud ? "✓" : "✗";
    console.log(`  ${G("●")} ${B(p.name)}`);
    console.log(`     id:        ${p.id}`);
    console.log(`     serial:    ${p.serialNumber}`);
    console.log(`     model:     ${p.model || "—"}`);
    console.log(`     mode:      ${p.mode || "cloud"}`);
    console.log(`     host:      ${p.host || (cloud ? mqttHostForRegion(p.region || cloud.region) : "—")}`);
    console.log(`     region:    ${p.region || (cloud ? cloud.region : "—") || "—"}`);
    console.log(`     cloud:     ${online}`);
    console.log();
  }
}

async function cmdPause(printers, target) {
  const subset = target ? printers.filter((p) => p.id === target || p.name === target) : printers;
  if (subset.length === 0) { console.log(R(`  No printer matching '${target || "all"}'.`)); process.exit(1); }
  console.log(D(`Pausing ${subset.length} printer(s)…`));
  for (const p of subset) {
    try {
      await sendCommand(p, "print.pause");
      console.log(G(`  ✓ ${p.name} — paused`));
    } catch (err) {
      console.log(R(`  ✗ ${p.name} — ${err.message}`));
    }
  }
}

async function cmdResume(printers, target) {
  const subset = target ? printers.filter((p) => p.id === target || p.name === target) : printers;
  if (subset.length === 0) { console.log(R(`  No printer matching '${target || "all"}'.`)); process.exit(1); }
  console.log(D(`Resuming ${subset.length} printer(s)…`));
  for (const p of subset) {
    try {
      await sendCommand(p, "print.resume");
      console.log(G(`  ✓ ${p.name} — resumed`));
    } catch (err) {
      console.log(R(`  ✗ ${p.name} — ${err.message}`));
    }
  }
}

function askConfirm(q) {
  process.stdout.write(q);
  return new Promise((resolve) => {
    const onData = (d) => {
      process.stdin.pause();
      const ok = d.toString().trim().toLowerCase();
      resolve(ok === "y" || ok === "yes");
    };
    process.stdin.once("data", onData);
    process.stdin.resume();
  });
}

async function cmdStop(printers, target) {
  const subset = target ? printers.filter((p) => p.id === target || p.name === target) : printers;
  if (subset.length === 0) { console.log(R(`  No printer matching '${target || "all"}'.`)); process.exit(1); }
  console.log(R(`⚠  Stopping ${subset.length} printer(s) — this cannot be undone.`));
  for (const p of subset) {
    const ok = await askConfirm(`  Stop "${p.name}"? (y/N) `);
    if (!ok) { console.log(D(`  skipped ${p.name}`)); continue; }
    try {
      await sendCommand(p, "print.stop");
      console.log(R(`  ✓ ${p.name} — stopped`));
    } catch (err) {
      console.log(R(`  ✗ ${p.name} — ${err.message}`));
    }
  }
  process.stdin.pause();
}

async function cmdSpeed(printers, levelOrOff, target) {
  const subset = target ? printers.filter((p) => p.id === target || p.name === target) : printers;
  if (subset.length === 0) { console.log(R(`  No printer matching '${target || "all"}'.`)); process.exit(1); }
  const level = levelOrOff === "off" ? 0 : parseInt(levelOrOff, 10);
  if (isNaN(level) || level < 0 || level > 4) {
    console.log(D(`  Speed levels: 1=Silent  2=Standard  3=Sport  4=Ludicrous  off=0`));
    process.exit(1);
  }
  console.log(D(`Setting speed to ${levelOrOff} on ${subset.length} printer(s)…`));
  for (const p of subset) {
    try {
      await sendCommand(p, "print.print_speed", { param: String(level) });
      const label = level === 0 ? "off" : `${level} (${speedLevel(level)})`;
      console.log(G(`  ✓ ${p.name} — speed ${label}`));
    } catch (err) {
      console.log(R(`  ✗ ${p.name} — ${err.message}`));
    }
  }
}

async function cmdWatch(printers) {
  console.log();
  console.log(B("Watching printer status — Ctrl+C to stop"));
  console.log(D("Updating every 10 seconds…"));
  console.log();

  let running = true;
  const sig = () => { running = false; };
  process.on("SIGINT", sig);
  process.on("SIGTERM", sig);

  let lastLines = 0;
  while (running) {
    const results = await Promise.allSettled(
      printers.map(async (p) => {
        const status = await freshStatus(p);
        return { printer: p, status };
      }),
    );

    const lines = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const p = printers[i];
      if (r.status === "rejected" || !r.value?.status) {
        lines.push(`${R("✗")} ${p.name} — ${r.reason?.message || "no signal"}`);
        continue;
      }
      const { printer, status } = r.value;
      const state = status?.gcode_state || "UNKNOWN";
      const sc = stateColor(state);
      const pct = pctStr(status?.mc_percent);
      const remain = timeRemaining(status?.mc_remaining_time);
      const stage = status?.stg_cur !== undefined && (status.gcode_state === "RUNNING" || status.gcode_state === "PREPARE")
        ? stageName(status.stg_cur) : "—";
      const speed = speedLevel(status?.spd_lvl);
      const nozzle = tempStr(status?.nozzle_temper, status?.nozzle_target_temper);
      const bed = tempStr(status?.bed_temper, status?.bed_target_temper);
      const printName = status?.subtask_name || status?.gcode_file || "—";
      const layer = status?.layer_num !== undefined && status?.total_layer_num !== undefined
        ? `${status.layer_num}/${status.total_layer_num}` : "—";

      lines.push(
        `  ${B(printer.name.padEnd(24))} ${sc(state.padEnd(9))} ${pct.padStart(4)}  ${remain !== "—" ? G(remain.padEnd(7)) : "—".padEnd(7)} ${layer.padEnd(9)} ${stage}`,
      );
      lines.push(
        `  ${D(" ".repeat(24))} ${nozzle.padEnd(14)} ${bed.padEnd(14)} ${speed.padEnd(9)} ${wifiStr(status?.wifi_signal).padEnd(10)} ${printName}`,
      );
    }

    if (lastLines > 0) {
      process.stdout.write("\x1b[" + lastLines + "A\x1b[J");
    }
    for (const l of lines) console.log(l);
    lastLines = lines.length + 1;

    await new Promise((r) => {
      const to = setTimeout(r, 10000);
      const stop = () => { clearTimeout(to); running = false; r(); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  }

  process.stdout.write("\x1b[J");
  console.log(D("\n  Watch stopped."));
}

function cmdHelp() {
  console.log(`
${B("bambu-cli")} — command-line interface for your Bambu Lab printer fleet
${D("Connects via MQTT (cloud or LAN). Uses the same credentials as the MCP server.")}

${B("Usage")}
  node bambu-cli.js <command> [options]

${B("Commands")}
  ${C("status")}    Show live status of all printers (default)
  ${C("status -1")} / ${C("status --once")}   Explicit single-shot status
  ${C("version")}   Show firmware versions for all printers
  ${C("pause")}     Pause current print (all printers, or -p <id>)
  ${C("resume")}    Resume paused print (all printers, or -p <id>)
  ${C("stop")}      Stop current print with confirmation (all, or -p <id>)
  ${C("speed")} <1|2|3|4|off>   Set print speed (all, or -p <id>)
  ${C("printers")}  List registered printers from config
  ${C("watch")}     Continuously poll and redraw status (Ctrl+C to stop)
  ${C("help")}      Show this help

${B("Options")}
  -p, --printer <id|name>   Target a specific printer (by id or name)
  -j, --json                Output status as JSON (for scripting)
  -h, --help                Show help

${B("Examples")}
  node bambu-cli.js                          # show status of all printers
  node bambu-cli.js status -j                # JSON output
  node bambu-cli.js status -p A1 Combo #1    # one printer by name
  node bambu-cli.js pause -p 01P00A000000000 # pause by serial
  node bambu-cli.js speed 3                  # sport mode on all
  node bambu-cli.js version                  # firmware versions
  node bambu-cli.js watch                    # live monitoring
`);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(args) {
  const opts = { command: "status", printer: undefined, json: false };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "-h" || a === "--help") { opts.command = "help"; i++; continue; }
    if (a === "-j" || a === "--json") { opts.json = true; i++; continue; }
    if (a === "-p" || a === "--printer") {
      opts.printer = args[++i] || "";
      i++;
      continue;
    }
    if (!opts.command || opts.command === "status") {
      opts.command = a;
      i++;
      continue;
    }
    i++;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    cmdHelp();
    return;
  }

  const cfg = loadConfig();
  const printers = args.printer
    ? cfg.printers.filter((p) => p.id === args.printer || p.name === args.printer || p.serialNumber === args.printer)
    : cfg.printers;

  if (printers.length === 0) {
    console.log(R(`Printer '${args.printer || "all"}' not found in config.`));
    console.log(D("Available: " + cfg.printers.map((p) => `(${p.serialNumber}) ${p.name}`).join(", ") || "none"));
    process.exit(1);
  }

  console.log(D(`Config: ${process.env.HOME}/.bambu-mcp/printers.json (${printers.length} printer(s))`));

  const cloud = loadCloud();
  const cloudPrinters = printers.filter((p) => p.mode === "cloud");
  if (cloudPrinters.length > 0 && !cloud) {
    console.log(R("Cloud printers found but no cloud credentials (cloud.json)."));
    console.log(D("Run: cd /Users/dylan/tools/bambu-mcp && npm run login"));
    process.exit(1);
  }

  switch (args.command) {
    case "status":
    case "status -1":
    case "status --once":
      await cmdStatus(printers, args.json);
      break;
    case "version":
      await cmdVersion(printers);
      break;
    case "pause":
      await cmdPause(printers, args.printer);
      break;
    case "resume":
      await cmdResume(printers, args.printer);
      break;
    case "stop":
      await cmdStop(printers, args.printer);
      break;
    case "speed": {
      const raw = args.command === "speed" ? "" : args.command; // not used; speed subcommand has no arg here
      // speed expects the level as a positional arg — re-check parseArgs: we only captured command "speed"
      // The level must be passed as a second positional. Since parseArgs only sets command, handle here:
      const levelArg = process.argv.slice(2).find((a) => !["speed", "-p", "--printer", "-j", "--json", "-h", "--help"].includes(a) && !args.printer.includes(a));
      if (!levelArg || !["1", "2", "3", "4", "off"].includes(levelArg)) {
        console.log(R("speed command requires a level: 1, 2, 3, 4, or off"));
        console.log(D("Example: node bambu-cli.js speed 3"));
        process.exit(1);
      }
      await cmdSpeed(printers, levelArg, args.printer);
      break;
    }
    case "printers":
      await cmdPrinters();
      break;
    case "watch":
      await cmdWatch(printers);
      break;
    default:
      console.log(R(`Unknown command: ${args.command}`));
      console.log(D("Run 'node bambu-cli.js help' for usage."));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(R("Fatal:"), err);
  process.exit(1);
});
