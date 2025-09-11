import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";

import { loadEnv } from "@config/env";
import { prismaPlugin } from "@plugins/prisma";
import { redisPlugin } from "@plugins/redis";
import { s3Plugin } from "@plugins/s3";
import tracksRoutes from "@routes/tracks";
import wsRoutes from "@routes/ws";

export async function buildApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: "info",
      transport: { target: "pino-pretty" }
    }
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(s3Plugin);

  await app.register(tracksRoutes, { prefix: "/tracks" });
  await app.register(wsRoutes, { prefix: "/ws" });

  app.get("/health", async () => ({ ok: true }));

  return app;
}