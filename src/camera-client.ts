import * as tls from "tls";

/**
 * Grab a single JPEG "chamber image" frame from an A1 / A1 Mini / P1P / P1S
 * printer over the local network.
 *
 * These models don't expose RTSP (only X1/H2 do). Instead they serve a
 * proprietary MJPEG-ish stream on TCP port 6000 over TLS:
 *   1. Send an 80-byte auth packet: 4x uint32 LE header + username(32) + code(32).
 *   2. The printer replies with repeating [16-byte header][JPEG payload] frames,
 *      where the header's first uint32 (LE) is the JPEG byte length.
 *
 * Requires "LAN Mode Liveview" enabled on the printer (Settings), which is
 * independent of full LAN-Only mode — Bambu Handy keeps working.
 */

const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

export interface CaptureOptions {
  port?: number;
  timeoutMs?: number;
}

function buildAuthPacket(username: string, accessCode: string): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0x40, 0); // payload length that follows (64 bytes)
  header.writeUInt32LE(0x3000, 4);
  header.writeUInt32LE(0x0, 8);
  header.writeUInt32LE(0x0, 12);
  const user = Buffer.alloc(32);
  Buffer.from(username, "ascii").copy(user);
  const code = Buffer.alloc(32);
  Buffer.from(accessCode, "ascii").copy(code);
  return Buffer.concat([header, user, code]);
}

/** Capture one JPEG frame. Resolves to a Buffer of image/jpeg bytes. */
export function captureFrame(
  host: string,
  accessCode: string,
  opts: CaptureOptions = {},
): Promise<Buffer> {
  const port = opts.port ?? 6000;
  const timeoutMs = opts.timeoutMs ?? 8000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let buf = Buffer.alloc(0);
    let expected = -1; // expected JPEG length once header is parsed

    const socket = tls.connect(
      { host, port, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        socket.write(buildAuthPacket("bblp", accessCode));
      },
    );

    const done = (err: Error | null, data?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {}
      if (err) reject(err);
      else resolve(data!);
    };

    const timer = setTimeout(
      () =>
        done(
          new Error(
            `Camera timeout after ${timeoutMs}ms (is "LAN Mode Liveview" enabled on the printer, and is this machine on the same network as ${host}?)`,
          ),
        ),
      timeoutMs,
    );

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      // Parse the 16-byte frame header to learn the JPEG length.
      if (expected < 0 && buf.length >= 16) {
        const len = buf.readUInt32LE(0);
        if (len > 0 && len < 8_000_000) {
          expected = len;
          buf = buf.subarray(16);
        } else {
          // Header didn't look sane — fall back to JPEG marker scanning.
          const start = buf.indexOf(JPEG_START);
          if (start >= 0) buf = buf.subarray(start);
        }
      }

      if (expected > 0 && buf.length >= expected) {
        const frame = buf.subarray(0, expected);
        if (frame.subarray(0, 3).equals(JPEG_START)) return done(null, frame);
        // Length-based framing was off; try marker-based extraction instead.
      }

      // Marker-based fallback: complete JPEG between SOI and EOI.
      const s = buf.indexOf(JPEG_START);
      if (s >= 0) {
        const e = buf.indexOf(JPEG_END, s + 3);
        if (e >= 0) return done(null, buf.subarray(s, e + 2));
      }
    });

    socket.on("timeout", () => done(new Error("Camera socket timed out.")));
    socket.on("error", (err) => done(err));
    socket.on("close", () => {
      if (!settled) done(new Error("Camera connection closed before a full frame arrived."));
    });
  });
}
