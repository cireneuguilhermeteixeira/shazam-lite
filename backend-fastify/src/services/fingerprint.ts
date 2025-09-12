import wavefile from "wavefile";
import FFT from "fft.js";

// ---- Tunables ----
export const TARGET_SR = 44100;
const FRAME_SIZE = 2048;   // ~46 ms
const HOP_SIZE = 512;      // 75% overlap
const PEAK_NEIGH_T = 5;    // +/- frames
const PEAK_NEIGH_F = 5;    // +/- bins
const PEAK_MIN_DB = -60;   // ignore very low energy
const PAIR_DT_FRAMES = { min: 1, max: 20 }; // ~ (0.02s .. 0.45s)
const MAX_PAIRS_PER_ANCHOR = 5;

export type Posting = { hash: string; tOffsetMs: number };

export async function createFingerprint(audioBuf: Buffer): Promise<Posting[]> {
  const { pcm, sr } = decodeWavToMono(audioBuf);
  const resampled = (sr === TARGET_SR) ? pcm : resampleLinear(pcm, sr, TARGET_SR);
  const mag = stftMag(resampled, FRAME_SIZE, HOP_SIZE);
  const magDb = mag.map(col => col.map(v => 20 * Math.log10(v + 1e-9)));
  const peaks = pickPeaks(magDb);

  const postings: Posting[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const [t1, f1] = peaks[i];
    let pairs = 0;
    for (let j = i + 1; j < peaks.length; j++) {
      const [t2, f2] = peaks[j];
      const dt = t2 - t1;
      if (dt < PAIR_DT_FRAMES.min) continue;
      if (dt > PAIR_DT_FRAMES.max) break;
      postings.push({ hash: makeHash(f1, f2, dt), tOffsetMs: framesToMs(t1) });
      if (++pairs >= MAX_PAIRS_PER_ANCHOR) break;
    }
  }
  return postings;
}

// ---- Helpers ----
export function decodeWavToMono(buf: Buffer): { pcm: Float32Array; sr: number } {
  const wav = new wavefile.WaveFile(buf);

  const fmtAny: any = wav.fmt as any;
  const numCh: number = (fmtAny && typeof fmtAny.numChannels === "number") ? fmtAny.numChannels : 1;
  if (numCh > 1) {
    const toMono = (wav as any).toMono as (undefined | (() => void));
    const toChannels = (wav as any).toChannels as (undefined | ((n: number) => void));
    if (typeof toMono === "function") toMono.call(wav);
    else if (typeof toChannels === "function") toChannels.call(wav, 1);
  }

  const toBitDepth = (wav as any).toBitDepth as (undefined | ((d: string) => void));
  if (typeof toBitDepth === "function") toBitDepth.call(wav, "32f");

  const sr: number = ((wav.fmt as any).sampleRate as number) ?? 44100;

  const samples64 = wav.getSamples(true) as Float64Array;
  const pcm = new Float32Array(samples64.length);
  for (let i = 0; i < samples64.length; i++) pcm[i] = samples64[i] as number;
  return { pcm, sr };
}

function resampleLinear(src: Float32Array, srFrom: number, srTo: number): Float32Array {
  const ratio = srTo / srFrom;
  const outLen = Math.floor(src.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i / ratio;
    const x0 = Math.floor(x);
    const x1 = Math.min(x0 + 1, src.length - 1);
    const frac = x - x0;
    out[i] = src[x0] * (1 - frac) + src[x1] * frac;
  }
  return out;
}

function hann(N: number): Float32Array {
  const w = new Float32Array(N);
  for (let n = 0; n < N; n++) w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  return w;
}

function stftMag(signal: Float32Array, frame: number, hop: number): number[][] {
  const window = hann(frame);
  const bins = frame / 2 + 1;
  const fft = new FFT(frame);
  const columns: number[][] = [];
  const input = fft.createComplexArray();
  const spectrum = fft.createComplexArray();

  for (let start = 0; start + frame <= signal.length; start += hop) {
    for (let n = 0; n < frame; n++) {
      const s = signal[start + n] * window[n];
      input[2*n] = s; input[2*n+1] = 0;
    }
    fft.transform(spectrum, input);

    const mag = new Array(bins);
    for (let k = 0; k < bins; k++) {
      const re = spectrum[2*k];
      const im = spectrum[2*k+1];
      mag[k] = Math.hypot(re, im);
    }
    columns.push(mag);
  }
  return columns; // [timeFrames][freqBins]
}

function pickPeaks(magDb: number[][]): Array<[number, number]> {
  const peaks: Array<[number, number]> = [];
  const T = magDb.length; if (T === 0) return peaks;
  const F = magDb[0].length;
  for (let t = PEAK_NEIGH_T; t < T - PEAK_NEIGH_T; t++) {
    for (let f = PEAK_NEIGH_F; f < F - PEAK_NEIGH_F; f++) {
      const val = magDb[t][f];
      if (val < PEAK_MIN_DB) continue;
      let isMax = true;
      for (let dt = -PEAK_NEIGH_T; dt <= PEAK_NEIGH_T && isMax; dt++) {
        for (let df = -PEAK_NEIGH_F; df <= PEAK_NEIGH_F; df++) {
          if (dt === 0 && df === 0) continue;
          if (magDb[t+dt][f+df] > val) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push([t, f]);
    }
  }
  peaks.sort((a,b) => a[0]-b[0]);
  return peaks;
}

function makeHash(f1: number, f2: number, dtFrames: number): string {
  const v1 = BigInt(f1 & 0xFFFFF);
  const v2 = BigInt(f2 & 0xFFFFF);
  const v3 = BigInt(dtFrames & 0xFFF);
  const packed = (v1 << BigInt(32)) | (v2 << BigInt(12)) | v3;
  return "0x" + packed.toString(16);
}

function framesToMs(tFrame: number): number { return Math.round((tFrame * HOP_SIZE) * 1000 / TARGET_SR); }
