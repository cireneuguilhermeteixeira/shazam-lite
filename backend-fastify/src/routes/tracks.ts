import { FastifyPluginAsync } from "fastify";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { fingerprintQueue } from "@queues/index.js";

const routes: FastifyPluginAsync = async (app) => {
    // Upload a new track (multipart)
    app.post("/", async (req, reply) => {
        const parts = req.parts();
        let title: string | undefined, artist: string | undefined;
        let fileBuffer: Buffer | undefined; let filename = ""; let contentType = "audio/mpeg";


        for await (const part of parts) {
            if (part.type === "file") {
                filename = part.filename ?? `upload-${Date.now()}`;
                const chunks: Buffer[] = [];
                for await (const chunk of part.file) chunks.push(chunk as Buffer);
                fileBuffer = Buffer.concat(chunks);
                contentType = part.mimetype;
            } else if (part.type === "field") {
                if (part.fieldname === "title") title = part.value as string;
                if (part.fieldname === "artist") artist = part.value as string;
            }
        }


        if (!fileBuffer || !title || !artist) {
            return reply.code(400).send({ error: "file, title, artist are required" });
        }


        // Save metadata in DB
        const track = await app.prisma.track.create({
            data: { title, artist, s3Key: filename, status: "QUEUED" }
        });


        // Upload to S3/MinIO
        await app.s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET!,
            Key: filename,
            Body: fileBuffer,
            ContentType: contentType
        }));


        // Enqueue fingerprinting job
        await fingerprintQueue.add("fingerprint_track", { trackId: track.id, s3Key: filename });


        return reply.code(201).send({ id: track.id, s3_key: filename, status: track.status });
    });


    // Get track metadata
    app.get("/:id", async (req, reply) => {
        const { id } = req.params as { id: string };
        const track = await app.prisma.track.findUnique({ where: { id } });
        if (!track) return reply.code(404).send({ error: "not found" });
        return track;
    });
};

export default routes;