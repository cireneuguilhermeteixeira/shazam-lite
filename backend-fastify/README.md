# TuneTrace Backend (Fastify)


> Initial scaffold with Fastify, CORS, WebSocket, file uploads, Prisma (Postgres), Redis, MinIO (S3), and BullMQ worker.


## Prerequisites
- Node.js 20+
- Docker & Docker Compose


## Setup
```bash
cp .env.example .env
yarn install
yarn prisma:generate
yarn prisma:migrate
docker compose up -d
```


Create the bucket in MinIO Console (http://localhost:9001): `tunetrace-tracks`.


## Run
```bash
yarn dev # API
yarn worker # Worker
```


## Endpoints
- `POST /tracks` (multipart: file, title, artist) → stores in S3 + DB and enqueues fingerprint job.
- `GET /tracks/:id` → metadata
- `GET /ws/stream` (WebSocket) → send binary audio chunks (PCM), receives interim responses.


## Next Steps
- Implement PCM decoding and FFT + peak picking in `src/services/fingerprint.ts`.
- Add Redis index writer/reader and matching logic in WS route.
- Add auth and input validation.