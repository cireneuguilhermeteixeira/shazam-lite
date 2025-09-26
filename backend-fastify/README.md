# TuneTrace — Backend “Next Steps” README

This document describes the continuation of the backend POC, building on the initial Fastify scaffold. It explains what the system does end‑to‑end, what we add in the next steps (fingerprint + matching + auth/validation), why BullMQ is used (and why it’s not pub/sub), and how to test recognition via WebSocket.

---

## What the system does (end‑to‑end)

**Upload flow** (`POST /tracks`):

1. Client uploads a track (MP3/WAV) via **multipart/form-data**.
2. API stores the raw file in **S3/MinIO** (`S3_BUCKET`).
3. API writes a **row in Postgres** (`Track` with status `QUEUED`).
4. API **enqueues** a job in **BullMQ** queue `fingerprint` with `{ trackId, s3Key }`.

**Background fingerprinting** (Worker):

1. Worker consumes jobs from the `fingerprint` queue.
2. Worker downloads the audio from S3/MinIO.
3. If needed, worker **transcodes** (e.g., **MP3 → WAV/PCM mono 44.1kHz**) using `ffmpeg`.
4. Worker runs the fingerprint pipeline (STFT → **peak picking** → **hash pairs** `(f1,f2,Δt)`).
5. Worker writes fingerprints into **Redis**: for each `hash`, append `(songId, offsetMs)` to an inverted index (e.g., `fp:{hash} → ["songId:offset"]`).
6. Worker updates Postgres `Track.status` to `READY`.

**Recognition** (WebSocket `/ws/stream`):

1. Client streams or sends a short **WAV snippet**.
2. Server computes snippet fingerprints (same pipeline) and looks up matching hashes in **Redis**.
3. Server votes for the best `(songId, Δt)` alignment and replies with the best match `{ song_id, title, artist, confidence, delta_ms }`.

> **BullMQ is not pub/sub.** It’s a **reliable job queue** on Redis: jobs persist, support retries/backoff, and are acknowledged when processed. Internally it uses Redis features, but semantically it’s not a fire‑and‑forget pub/sub.

---

## Next Steps — What we add

### 1) PCM decoding and FFT + peak picking (`src/services/fingerprint.ts`)

* **Decode WAV** → mono **Float32 PCM** and resample to **44.1 kHz** if needed.
* Compute **STFT** (window Hann, `FRAME_SIZE`, `HOP_SIZE`).
* Convert magnitude to **dB**; perform **peak picking** (local maxima in time–frequency).
* Form **pairs** of peaks within a time window (the “target zone”): generate compact **hashes** from `(f1, f2, Δt)`.
* Return a list of postings: `{ hash, tOffsetMs }`.

### 2) Redis index writer/reader and matching (WS route)

* **Writer (Worker)**: For each posting, append to `fp:{hash}` a string like `"<songId>:<offsetMs>"` (use pipelining for throughput).
* **Reader (WS)**: For each snippet hash, read up to N entries from `fp:{hash}`, compute `Δt = dbOffset - queryOffset`, and **vote** per `(songId, Δt)`. The top cluster wins.

### 3) Auth and input validation

* Add **Zod** (already in deps) schemas for request validation (multipart fields, WS messages).
* Add simple **JWT bearer** auth for uploads/streaming or an API key, depending on your needs.

---

## Installation & Run

### Prerequisites

* Node.js 20+
* Docker & Docker Compose
* (Optional for MP3 uploads) **ffmpeg** installed and available in `PATH`.

### Environment

Copy and edit `.env` from `.env.example`:

```
PORT=8080
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tunetrace?schema=public
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123
S3_BUCKET=tunetrace-tracks
S3_FORCE_PATH_STYLE=true
QUEUE_PREFIX=tunetrace
```

### Boot services

```bash
docker compose up -d postgres redis minio
# Create bucket in MinIO Console: http://localhost:9001 → tunetrace-tracks
npm i
npm run prisma:generate
npm run prisma:migrate
```

### Run API & Worker

```bash
npm run dev           # API (Fastify) http://localhost:8080
npm run worker:nowatch  # Recommended: worker without watch during long jobs
```

> **Why `:nowatch` for the worker?** Using “watch” can restart the process mid‑job and the worker may **lose its job lock** (BullMQ error “could not renew lock”). Prefer running the worker without watch when fingerprinting.

---

## API Overview

### `POST /tracks` (multipart upload)

Fields:

* `file`: audio file (MP3 or WAV)
* `title`: track title
* `artist`: track artist

Flow:

* Upload is stored in S3/MinIO with `ContentType` (server can sniff MIME if needed).
* A `Track` row is inserted in Postgres with status `QUEUED`.
* A BullMQ job `fingerprint_track` is enqueued in queue `fingerprint` with `{ trackId, s3Key }`.

Example (MP3):

```bash
curl -F "file=@tests/song.mp3;type=audio/mpeg;filename=song.mp3" \
     -F "title=Sparks" \
     -F "artist=Coldplay" \
     http://localhost:8080/tracks
```

Response `201`:

```json
{ "id": "<uuid>", "s3_key": "song.mp3", "status": "QUEUED" }
```

### `GET /tracks/:id`

Returns Postgres metadata and current status (`QUEUED` → `FINGERPRINTING` → `READY` or `FAILED`).

---

## WebSocket Recognition Test

### 1) Wait for READY

After upload, the worker will fingerprint and index the track. Poll until READY:

```bash
curl http://localhost:8080/tracks/<id>
```

### 2) Create a short snippet from the *same* song

Use ffmpeg to create a 3‑second WAV snippet starting at 10s:

```bash
ffmpeg -ss 10 -t 3 -i tests/song.mp3 -ac 1 -ar 44100 -c:a pcm_s16le tests/snippet.wav
```

### 3) Send the snippet over WebSocket

Create a small script (Node + `ws`) to push the WAV buffer and print the result:

```ts
// scripts/ws-test.ts
import { WebSocket } from "ws";
import { readFileSync } from "fs";

const ws = new WebSocket("ws://localhost:8080/ws/stream");
ws.on("open", () => {
  const buf = readFileSync("tests/snippet.wav");
  ws.send(buf);
});
ws.on("message", (data) => {
  console.log("server:", data.toString());
  ws.close();
});
```

Run:

```bash
npm i -D ws
npx tsx scripts/ws-test.ts
```

Expected response:

```json
{"ok":true, "match": { "song_id":"...", "title":"Sparks", "artist":"Coldplay", "confidence":42, "delta_ms":-120 }}
```

* `confidence` is the number of consistent votes for the best `(songId, Δt)` cluster.
* `delta_ms` is the alignment offset (dbOffset − queryOffset).

> If your upload was MP3 and your backend expects WAV for the snippet, make sure your WS test sends **WAV/PCM** as shown above.

---

## Implementation notes

### Fingerprint data model (constellation map)

* Build a spectrogram (time × frequency). Detect strong **peaks**.
* For each “anchor” peak, pair with a few **target peaks** that occur shortly after.
* Each pair yields a **hash** from `(f1, f2, Δt)`; store postings `(songId, tOffsetMs)`.

### Redis index structure

* Key per hash: `fp:{hash}`
* Value: list of strings, each `"<songId>:<offsetMs>"`
* Writer uses **pipelining** for throughput; reader trims to a cap per lookup.

### BullMQ (why not pub/sub)

* Persistent, retryable **job queue** (`Queue`, `Worker`, `QueueEvents`).
* The worker acquires a **lock** on a job; if the process restarts or the event loop is blocked, the lock can expire. Use sensible options like `lockDuration`, `stalledInterval`, `concurrency: 1`, and avoid running the worker with file‑watch during long jobs.

### Content-Type & transcoding

* If S3 object has `application/octet-stream`, sniff the buffer to decide whether to transcode (`file-type` + `ffmpeg`).
* For MP3 uploads, convert to **WAV PCM 16‑bit mono @ 44.1 kHz** before fingerprinting.

---

## Minimal security & validation

* Use **Zod** to validate multipart fields (`title`, `artist`) and WS payloads if you adopt a framed message format.
* Add **JWT bearer** or an API key (per project) for `POST /tracks` and WS connections.
* Rate limit WS connections if needed.

---

## Troubleshooting

**Worker logs show “could not renew lock / missing lock for job X”**

* Don’t run worker with watch during long tasks → use `npm run worker:nowatch`.
* Set Worker options: `concurrency: 1`, `lockDuration: 300000`, `stalledInterval: 60000`.

**Track stuck in FINGERPRINTING**

* The job likely failed; check worker logs.
* Mark `FAILED` on catch and use `attempts` + `backoff` when adding jobs.

**No matches via WS**

* Ensure the track is `READY` and Redis has keys `fp:0x...` (with your chosen prefix):

  ```bash
  redis-cli KEYS <QUEUE_PREFIX>:fp:0x*
  ```
* Make sure the snippet is from the **same song** and long enough (2–5s).
* Verify FFT/frame params match between ingest and query.

**S3 object saved with `application/octet-stream`**

* Force type in upload (client) or **sniff in backend** and set `ContentType` in `PutObject`.
* In the worker, sniff the buffer to decide whether to transcode.

---

## Roadmap ideas

* WebSocket streaming (incremental fingerprinting) with sliding windows.
* Native/WASM FFT for speed.
* Better noise robustness (peak thresholds, band limits).
* Prometheus metrics (latency, match quality, queue depth).
* Horizontal scale: multiple workers; shard the Redis index.

---

**That’s it!** With these steps you can upload a track, fingerprint it in the background, and recognize it via WebSocket from a short snippet. BullMQ ensures jobs are reliable (not pub/sub), Redis makes lookups fast, and Postgres tracks metadata/state.
