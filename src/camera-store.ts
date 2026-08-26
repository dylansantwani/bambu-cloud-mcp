import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR =
  process.env.BAMBU_MCP_CONFIG_DIR || path.join(os.homedir(), ".bambu-mcp");
const CAM_FILE = path.join(CONFIG_DIR, "cameras.json");

export interface CameraEntry {
  /** LAN access code (8-digit, from printer WLAN settings). Required for port-6000 auth. */
  accessCode: string;
  /** Optional static LAN IP override; normally auto-resolved from MQTT status. */
  ip?: string;
}

type CameraMap = Record<string, CameraEntry>; // keyed by printer serial

export function loadCameras(): CameraMap {
  try {
    return JSON.parse(fs.readFileSync(CAM_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function getCamera(serial: string): CameraEntry | undefined {
  return loadCameras()[serial];
}

export function setCamera(serial: string, entry: CameraEntry): void {
  const map = loadCameras();
  map[serial] = { ...map[serial], ...entry };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CAM_FILE, JSON.stringify(map, null, 2), { mode: 0o600 });
}

/** Decode Bambu's little-endian int32 IP (from status net.info[].ip) to dotted form. */
export function decodeIp(ipInt?: number): string | null {
  if (ipInt == null || ipInt === 0) return null;
  return [ipInt & 255, (ipInt >> 8) & 255, (ipInt >> 16) & 255, (ipInt >> 24) & 255].join(".");
}
