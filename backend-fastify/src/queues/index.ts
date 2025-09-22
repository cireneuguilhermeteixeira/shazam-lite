import { Queue, Worker, QueueEvents } from "bullmq";
import { loadEnv } from "@config/env.js";
import IORedis from "ioredis";


const env = loadEnv();


// export const connection = new IORedis(env.REDIS_URL);

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const fingerprintQueue = new Queue("fingerprint", {
    connection,
    prefix: env.QUEUE_PREFIX
});


export const fingerprintEvents = new QueueEvents("fingerprint", {
    connection,
    prefix: env.QUEUE_PREFIX
});