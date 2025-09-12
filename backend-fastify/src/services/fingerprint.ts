// NOTE: This is a minimal placeholder. Meyda in Node requires an AudioContext-like environment.
// For the POC, we'll parse PCM and compute an FFT using a small library or custom code, then select peaks.
// Later we can integrate Meyda/WASM or a native addon for performance.


export async function createFingerprint(audio: Buffer): Promise<Array<{ hash: string; tOffsetMs: number }>> {
// TODO: decode audio (e.g., WAV/MP3) to PCM mono 44.1kHz
// TODO: STFT -> magnitude spectrogram
// TODO: peak picking -> constellation
// TODO: pair peaks -> hashes
// For now, return a dummy list
return [ { hash: "deadbeef", tOffsetMs: 0 } ];
}