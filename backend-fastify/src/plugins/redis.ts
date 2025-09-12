import fp from "fastify-plugin";
import IORedis, { Redis } from "ioredis";
import { loadEnv } from "@config/env.js";


export const redisPlugin = fp(async (app) => {
    const env = loadEnv();
    const redis = new IORedis(env.REDIS_URL);
    app.decorate("redis", redis);
    app.addHook("onClose", async () => {
        await redis.quit();
    });
});


declare module "fastify" {
    interface FastifyInstance {
        redis: Redis;
    }
}