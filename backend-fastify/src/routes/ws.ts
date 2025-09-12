import { FastifyPluginAsync } from "fastify";
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
  app.get("/stream", { websocket: true }, (conn) => {
    conn.socket.on("message", async (msg: Buffer) => {
      try {
        // For simplicity in the POC, expect WAV chunks from client
        const postings = await createFingerprint(msg);
        const match = await matchHashes(app, postings);
        conn.socket.send(JSON.stringify({ ok: true, match }));
      } catch (err:any) {
        app.log.error(err);
        conn.socket.send(JSON.stringify({ ok: false, error: err?.message || "decode_error" }));
      }
    });
    conn.socket.on("close", () => app.log.info("WS disconnected"));
  });
};

export default wsRoutes;
