// src/services/transcode.ts
import { spawn } from "node:child_process";

export async function anyToWavPCM16Mono44k(buf: Buffer): Promise<Buffer> {
  // Requer ffmpeg instalado no seu sistema (ou no container)
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", "pipe:0",
    "-ac", "1",            // mono
    "-ar", "44100",        // 44.1 kHz
    "-c:a", "pcm_s16le",   // PCM 16-bit
    "-f", "wav",
    "pipe:1"
  ];
  const ff = spawn("ffmpeg", args);
  const chunks: Buffer[] = [];
  let err = "";

  ff.stdin.write(buf);
  ff.stdin.end();
  ff.stdout.on("data", d => chunks.push(d as Buffer));
  ff.stderr.on("data", d => (err += d.toString()));

  await new Promise<void>((resolve, reject) => {
    ff.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err}`))));
  });

  return Buffer.concat(chunks);
}
