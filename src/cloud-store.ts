import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR =
  process.env.BAMBU_MCP_CONFIG_DIR || path.join(os.homedir(), ".bambu-mcp");
const CLOUD_FILE = path.join(CONFIG_DIR, "cloud.json");

/** Stored cloud region. EU is its own label; see parseRegion. */
export type CloudRegion = "US" | "EU" | "China";

export interface CloudCredentials {
  region: CloudRegion;
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

const API_HOST_GLOBAL = "https://api.bambulab.com";
const API_HOST_CHINA = "https://api.bambulab.cn";
const MQTT_HOST_GLOBAL = "us.mqtt.bambulab.com";
const MQTT_HOST_CHINA = "cn.mqtt.bambulab.com";

/**
 * Normalize a region string from the login prompt or stored config.
 *
 * Empty input is not a region — the login CLI defaults that to US.
 * Unknown input returns null so "EU" is never silently stored as "US".
 *
 * Europe is a first-class label (Bambu Studio / ha-bambulab both offer it).
 * Its public API is the global host, not a separate EU API: ha-bambulab's
 * get_Url only rewrites .com to .cn for China. The hostname
 * eu.mqtt.bambulab.com is cited in unofficial notes but has no DNS record
 * (checked 2026-11-22 from Switzerland and from a Mac), so MQTT for EU
 * stays on us.mqtt.bambulab.com — the broker pybambu uses for every
 * non-China account.
 */
export function parseRegion(input?: string): CloudRegion | null {
  const raw = (input || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!raw) return null;
  if (
    raw === "us" ||
    raw === "usa" ||
    raw === "global" ||
    raw === "na" ||
    raw === "northamerica" ||
    raw === "other"
  ) {
    return "US";
  }
  if (raw === "eu" || raw === "europe" || raw === "european") return "EU";
  if (raw === "china" || raw === "cn" || raw === "ch") return "China";
  return null;
}

/** HTTPS API host. China uses .cn; US and EU use the global host. */
export function apiHostForRegion(region?: string): string {
  return parseRegion(region) === "China" ? API_HOST_CHINA : API_HOST_GLOBAL;
}

/** Cloud MQTT broker host for a region. */
export function mqttHostForRegion(region?: string): string {
  return parseRegion(region) === "China" ? MQTT_HOST_CHINA : MQTT_HOST_GLOBAL;
}
