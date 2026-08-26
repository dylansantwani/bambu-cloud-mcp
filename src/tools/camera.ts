import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FleetManager } from "../fleet-manager.js";
import { captureFrame } from "../camera-client.js";
import { getCamera, setCamera, decodeIp } from "../camera-store.js";

export function registerCameraTools(
  server: McpServer,
  fleet: FleetManager,
): void {
  server.tool(
    "get_camera_frame",
    "Capture a live JPEG snapshot from a printer's chamber camera over the LAN and return it as an image. Works for A1/A1 Mini/P1P/P1S on the same network with 'LAN Mode Liveview' enabled. The printer's IP is auto-detected; the LAN access code is used for auth (set once via set_camera_access for cloud printers).",
    {
      printer: z
        .string()
        .optional()
        .describe("Printer ID (e.g. 'cloud-01S00A1234567890') or omit if only one printer"),
      ip: z
        .string()
        .optional()
        .describe("Override LAN IP (normally auto-detected from printer status)"),
      access_code: z
        .string()
        .optional()
        .describe("Override LAN access code (normally read from stored config)"),
    },
    async ({ printer, ip, access_code }) => {
      const conn = fleet.resolvePrinters(printer)[0];
      const serial = conn.config.serialNumber;

      // Resolve LAN IP: explicit arg → live status → stored override.
      let host = ip;
      if (!host) {
        try {
          const st = await conn.mqtt.requestStatus();
          host = decodeIp(st.net?.info?.[0]?.ip) || undefined;
        } catch {}
      }
      if (!host) host = getCamera(serial)?.ip;
      if (!host) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not determine ${conn.config.name}'s LAN IP. Pass ip=..., or ensure the printer is online.`,
            },
          ],
        };
      }

      // Resolve access code: explicit arg → stored camera code → LAN config code.
      const code =
        access_code || getCamera(serial)?.accessCode || conn.config.accessCode;
      if (!code) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No LAN access code for ${conn.config.name}. Run set_camera_access with the 8-digit code from the printer's WLAN settings.`,
            },
          ],
        };
      }

      try {
        const jpg = await captureFrame(host, code, { timeoutMs: 9000 });
        return {
          content: [
            {
              type: "image" as const,
              data: jpg.toString("base64"),
              mimeType: "image/jpeg",
            },
            {
              type: "text" as const,
              text: `${conn.config.name} — live frame (${host}, ${(jpg.length / 1024).toFixed(0)} KB).`,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Camera capture failed for ${conn.config.name} at ${host}: ${err.message}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "set_camera_access",
    "Store the LAN access code (and optional IP) for a printer's chamber camera, so get_camera_frame can authenticate. The access code is the 8-digit code in the printer's WLAN settings.",
    {
      printer: z.string().describe("Printer ID (e.g. 'cloud-01S00A1234567890')"),
      access_code: z.string().describe("8-digit LAN access code from printer WLAN settings"),
      ip: z.string().optional().describe("Optional static LAN IP (normally auto-detected)"),
    },
    async ({ printer, access_code, ip }) => {
      const conn = fleet.resolvePrinters(printer)[0];
      setCamera(conn.config.serialNumber, { accessCode: access_code, ip });
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved camera access for ${conn.config.name} (serial ${conn.config.serialNumber}).`,
          },
        ],
      };
    },
  );
  server.tool(
    "set_recording",
    "Enable or disable camera recording on a printer (or all printers).",
    {
      printer: z
        .string()
        .optional()
        .describe("Printer ID, 'all', or omit for single printer"),
      enabled: z.boolean().describe("true to enable recording, false to disable"),
    },
    async ({ printer, enabled }) => {
      return fleet.executeOnPrinters(printer, async (conn) => {
        await conn.mqtt.setCameraRecording(enabled);
        return `Camera recording ${enabled ? "enabled" : "disabled"}.`;
      });
    },
  );

  server.tool(
    "set_timelapse",
    "Enable or disable timelapse recording on a printer (or all printers).",
    {
      printer: z
        .string()
        .optional()
        .describe("Printer ID, 'all', or omit for single printer"),
      enabled: z
        .boolean()
        .describe("true to enable timelapse, false to disable"),
    },
    async ({ printer, enabled }) => {
      return fleet.executeOnPrinters(printer, async (conn) => {
        await conn.mqtt.setTimelapse(enabled);
        return `Timelapse recording ${enabled ? "enabled" : "disabled"}.`;
      });
    },
  );
}
