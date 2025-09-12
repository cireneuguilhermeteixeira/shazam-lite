import { Worker, Job } from "bullmq";
import { connection } from "@queues/index.js";
import { loadEnv } from "@config/env.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@plugins/prisma.js";
import { createFingerprint } from "@services/fingerprint.js";
import IORedis from "ioredis";

const env = loadEnv();
const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
});
const redis = new IORedis(env.REDIS_URL);

async function streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}


new Worker(
    `${env.QUEUE_PREFIX}:fingerprint`,
    async (job: Job) => {
        const { trackId, s3Key } = job.data as { trackId: string; s3Key: string };
        await prisma.track.update({ where: { id: trackId }, data: { status: "FINGERPRINTING" } });

        const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key }));
        const audioBuf = await streamToBuffer(obj.Body as any);

        const postings = await createFingerprint(audioBuf);

        const pipeline = redis.pipeline();
        for (const p of postings) pipeline.rpush(`fp:${p.hash}`, `${trackId}:${p.tOffsetMs}`);
        await pipeline.exec();

        await prisma.track.update({ where: { id: trackId }, data: { status: "READY" } });

        return { hashes: postings.length };
    },
    { connection }
);