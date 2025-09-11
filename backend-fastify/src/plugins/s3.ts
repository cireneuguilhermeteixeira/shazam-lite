import fp from "fastify-plugin";
import { S3Client } from "@aws-sdk/client-s3";
import { loadEnv } from "@config/env.js";


export const s3Plugin = fp(async (app) => {
    const env = loadEnv();
    const s3 = new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        credentials: {
            accessKeyId: env.S3_ACCESS_KEY,
            secretAccessKey: env.S3_SECRET_KEY
        },
        forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
    });
    app.decorate("s3", s3);
});


declare module "fastify" {
    interface FastifyInstance {
        s3: S3Client;
    }
}