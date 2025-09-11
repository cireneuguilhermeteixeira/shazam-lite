import { FastifyPluginAsync } from "fastify";


const wsRoutes: FastifyPluginAsync = async (app) => {
    app.get("/stream", { websocket: true }, (conn, req) => {
        app.log.info({ q: req.query }, "WS connected");


        conn.socket.on("message", async (msg: Buffer) => {
            // Here we will: decode PCM frames, run short-window FFT, pick peaks, make hashes, and look up in Redis.
            // For now, just acknowledge receipt size.
            app.log.debug({ bytes: msg.length }, "WS chunk received");


            // TODO: integrate Meyda on the server-side and Redis lookup
            conn.socket.send(JSON.stringify({ ok: true, receivedBytes: msg.length }));
        });


        conn.socket.on("close", () => {
            app.log.info("WS disconnected");
        });
    });
};


export default wsRoutes;