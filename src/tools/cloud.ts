import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FleetManager } from "../fleet-manager.js";
import type { PrinterConfig } from "../types.js";
import { addPrinterToConfig, loadConfig } from "../config.js";
import {
  loadCloud,
  saveCloud,
  clearCloud,
  getCloudPath,
  type CloudCredentials,
} from "../cloud-store.js";
import {
  listDevices,
  refreshToken,
  deriveTokenInfo,
  type CloudDevice,
} from "../bambu-cloud.js";

/** Get a currently-valid access token, refreshing if expired. Returns null if not logged in. */
async function validToken(): Promise<CloudCredentials | null> {
  let creds = loadCloud();
  if (!creds) return null;
  const now = Math.floor(Date.now() / 1000);
  if (creds.expiresAt && creds.expiresAt - now < 3600 && creds.refreshToken) {
    try {
      const r = await refreshToken(creds.refreshToken, creds.region);
      if (r.status === "success" && r.accessToken) {
        const info = deriveTokenInfo(r.accessToken);
        creds = {
          ...creds,
          accessToken: r.accessToken,
          refreshToken: r.refreshToken || creds.refreshToken,
          username: r.username || info.username || creds.username,
          expiresAt: r.expiresAt || info.expiresAt,
          savedAt: new Date().toISOString(),
        };
        saveCloud(creds);
      }
    } catch {
      /* fall through with existing token */
    }
  }
  return creds;
}

export interface SyncResult {
  loggedIn: boolean;
  devices: CloudDevice[];
  connected: string[];
  failed: { id: string; error: string }[];
  error?: string;
}

/** Discover cloud printers, persist them (mode:"cloud"), and connect them. */
export async function syncCloudPrinters(
  fleet: FleetManager,
): Promise<SyncResult> {
  const creds = await validToken();
  if (!creds) {
    return {
      loggedIn: false,
      devices: [],
      connected: [],
      failed: [],
      error: "Not logged in to Bambu cloud. Run `npm run login`.",
    };
  }

  let devices: CloudDevice[];
  try {
    devices = await listDevices(creds.accessToken, creds.region);
  } catch (e: any) {
    return {
      loggedIn: true,
      devices: [],
      connected: [],
      failed: [],
      error: `Could not list cloud printers: ${e.message}`,
    };
  }

  const connected: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const d of devices) {
    const id = `cloud-${d.dev_id}`;
    const config: PrinterConfig = {
      id,
      name: `${d.name} (cloud)`,
      host: "us.mqtt.bambulab.com", // display only; real host resolved by region
      accessCode: "",
      serialNumber: d.dev_id,
      model: d.model,
      mode: "cloud",
      region: creds.region,
    };
    addPrinterToConfig(config);
    try {
      await fleet.connectPrinter(config);
      connected.push(id);
    } catch (e: any) {
      failed.push({ id, error: e.message });
    }
  }

  return { loggedIn: true, devices, connected, failed };
}

export function registerCloudTools(
  server: McpServer,
  fleet: FleetManager,
): void {
  server.tool(
    "cloud_status",
    "Show Bambu cloud login status: whether credentials exist, the account, region, token expiry, and how many cloud printers are connected.",
    {},
    async () => {
      const creds = loadCloud();
      if (!creds) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Not logged in to Bambu cloud.\nRun \`npm run login\` in the bambu-mcp directory to enable cloud control.\nCredential file (when logged in): ${getCloudPath()}`,
            },
          ],
        };
      }
      const now = Math.floor(Date.now() / 1000);
      const exp = creds.expiresAt
        ? `${new Date(creds.expiresAt * 1000).toLocaleString()}${creds.expiresAt < now ? " (EXPIRED — run `npm run login`)" : ""}`
        : "unknown";
      const cloudPrinters = loadConfig().printers.filter(
        (p) => p.mode === "cloud",
      );
      const lines = [
        "# Bambu Cloud Status",
        `- **Account:** ${creds.email}`,
        `- **Region:** ${creds.region}`,
        `- **MQTT user:** ${creds.username}`,
        `- **Token expires:** ${exp}`,
        `- **Cloud printers configured:** ${cloudPrinters.length}`,
        "",
      ];
      for (const p of cloudPrinters) {
        const conn = fleet.getPrinter(p.id);
        lines.push(
          `  • ${p.name} (\`${p.id}\`) — ${conn?.mqtt.isConnected() ? "connected" : "disconnected"}`,
        );
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "sync_cloud_printers",
    "Discover printers bound to your Bambu cloud account and connect them over the cloud MQTT broker (works remotely, off your LAN). Requires `npm run login` first.",
    {},
    async () => {
      const res = await syncCloudPrinters(fleet);
      if (res.error) {
        return { content: [{ type: "text" as const, text: res.error }] };
      }
      if (res.devices.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Logged in, but no printers are bound to this account.",
            },
          ],
        };
      }
      const lines = [`Found ${res.devices.length} cloud printer(s):`, ""];
      for (const d of res.devices) {
        const id = `cloud-${d.dev_id}`;
        const ok = res.connected.includes(id);
        const fail = res.failed.find((f) => f.id === id);
        lines.push(
          `• ${d.name} [${d.model || "?"}] (\`${id}\`) — ${
            ok ? "connected" : fail ? `failed: ${fail.error}` : "not connected"
          }${d.online ? "" : " · printer offline"}`,
        );
      }
      lines.push("", "Use get_status, pause_print, etc. with these IDs (or 'all').");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "cloud_logout",
    "Log out of Bambu cloud: delete stored cloud credentials and disconnect cloud printers. LAN printers are unaffected.",
    {},
    async () => {
      const cloudPrinters = loadConfig().printers.filter(
        (p) => p.mode === "cloud",
      );
      for (const p of cloudPrinters) fleet.disconnectPrinter(p.id);
      const cleared = clearCloud();
      return {
        content: [
          {
            type: "text" as const,
            text: cleared
              ? `Logged out. Cleared credentials and disconnected ${cloudPrinters.length} cloud printer(s). (Cloud printer entries remain in config but won't connect until you log in again.)`
              : "No cloud credentials were stored.",
          },
        ],
      };
    },
  );
}
