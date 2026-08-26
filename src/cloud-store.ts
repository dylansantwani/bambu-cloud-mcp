import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR =
  process.env.BAMBU_MCP_CONFIG_DIR || path.join(os.homedir(), ".bambu-mcp");
const CLOUD_FILE = path.join(CONFIG_DIR, "cloud.json");

export interface CloudCredentials {
  region: string; // "US" | "China" | ...
  email: string;
  /** MQTT username, e.g. "u_1234567". Derived from the JWT at login. */
  username: string;
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds when accessToken expires (from JWT exp), if known. */
  expiresAt?: number;
  savedAt: string;
}

export function getCloudPath(): string {
  return CLOUD_FILE;
}

export function loadCloud(): CloudCredentials | null {
  try {
    const data = fs.readFileSync(CLOUD_FILE, "utf-8");
    return JSON.parse(data) as CloudCredentials;
  } catch {
    return null;
  }
}

export function saveCloud(creds: CloudCredentials): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CLOUD_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CLOUD_FILE, 0o600);
  } catch {}
}

export function clearCloud(): boolean {
  try {
    fs.unlinkSync(CLOUD_FILE);
    return true;
  } catch {
    return false;
  }
}

/** Cloud MQTT broker host for a region. */
export function mqttHostForRegion(region?: string): string {
  return (region || "").toLowerCase().startsWith("china")
    ? "cn.mqtt.bambulab.com"
    : "us.mqtt.bambulab.com";
}
