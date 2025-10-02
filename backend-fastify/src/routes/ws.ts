import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "ws"; // dev dep: @types/ws
import { createFingerprint } from "@services/fingerprint.js";

// Simple matcher over Redis postings: fp:{hash} -> ["songId:offsetMs", ...]
async function matchHashes(app: any, postings: { hash: string; tOffsetMs: number }[]) {
  const votes = new Map<string, number>(); // key: `${songId}|${delta}`

  for (const p of postings) {
    const list = await app.redis.lrange(`fp:${p.hash}`, 0, 500); // cap per hash
    for (const item of list) {
      const [songId, offStr] = item.split(":");
      const off = parseInt(offStr, 10);
      const delta = off - p.tOffsetMs;
      const key = `${songId}|${delta}`;
      votes.set(key, (votes.get(key) || 0) + 1);
    }
  }

  let bestKey = ""; let bestVotes = 0;
  for (const [k, v] of votes.entries()) { if (v > bestVotes) { bestVotes = v; bestKey = k; } }
  if (!bestKey) return null;

  const [songId, deltaStr] = bestKey.split("|");
  const track = await app.prisma.track.findUnique({ where: { id: songId } });
  if (!track) return null;

  return {
    song_id: track.id,
    title: track.title,
    artist: track.artist,
    confidence: bestVotes,
    delta_ms: Number(deltaStr)
  };
}

const wsRoutes: FastifyPluginAsync = async (app) => {
  // v10+ API: (socket /* WebSocket */, req /* FastifyRequest */)
  app.get("/stream", { websocket: true }, (socket: WebSocket, req) => {
    app.log.info({ url: req.url }, "WS connected");

    // Anexe handlers SINCRONAMENTE (recomendação do plugin)
    socket.on("message", async (data, isBinary) => {
      try {
        // Trate keepalive/JSON texto
        if (!isBinary) {
          const text = data.toString();
          if (text === "ping" || text.includes('"type":"ping"')) {
            socket.send(JSON.stringify({ ok: true, pong: Date.now() }));
            return;
          }
        }

        // Espera WAV binário (Buffer). Se vier ArrayBuffer, converta.
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

        const postings = await createFingerprint(buf);
        const match = await matchHashes(app, postings);
        socket.send(JSON.stringify({ ok: true, match }));
      } catch (err: any) {
        app.log.error({ err }, "WS message handler error");
        try {
          socket.send(JSON.stringify({ ok: false, error: err?.message || "decode_error" }));
        } catch {}
      }
    });

    socket.on("close", () => app.log.info("WS disconnected"));
    socket.on("error", (err) => app.log.error({ err }, "WS error"));
  });
};

export default wsRoutes;
