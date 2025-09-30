// Utility: WAV encoder (PCM 16-bit LE, mono) + simple chunker for fixed-duration frames


export function floatTo16BitPCM(float32) {
const out = new Int16Array(float32.length);
for (let i = 0; i < float32.length; i++) {
let s = Math.max(-1, Math.min(1, float32[i]));
out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
}
return out;
}


function writeString(view, offset, str) { for (let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); }


export function encodeWavPCM16(samplesFloat32, sampleRate) {
const samples = floatTo16BitPCM(samplesFloat32);
const buffer = new ArrayBuffer(44 + samples.length * 2);
const view = new DataView(buffer);
writeString(view, 0, 'RIFF');
view.setUint32(4, 36 + samples.length * 2, true);
writeString(view, 8, 'WAVE');
writeString(view, 12, 'fmt ');
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, 1, true);
view.setUint32(24, sampleRate, true);
view.setUint32(28, sampleRate * 2, true);
view.setUint16(32, 2, true);
view.setUint16(34, 16, true);
writeString(view, 36, 'data');
view.setUint32(40, samples.length * 2, true);
const out = new Int16Array(buffer, 44, samples.length);
out.set(samples);
return buffer;
}


export function createChunker(sampleRate, seconds) {
const chunkFrames = Math.floor(sampleRate * seconds);
const buffers = []; // Float32Array[]
let bufferedFrames = 0;


function consume(frames) {
let need = frames; const out = new Float32Array(frames); let used = 0;
while (need > 0 && buffers.length) {
const head = buffers[0];
if (head.length <= need) {
out.set(head, used); used += head.length; need -= head.length; buffers.shift();
} else {
out.set(head.subarray(0, need), used); buffers[0] = head.subarray(need); used += need; need = 0;
}
}
bufferedFrames -= frames;
return out;
}


return {
push(float32) { buffers.push(float32); bufferedFrames += float32.length; },
hasChunk() { return bufferedFrames >= chunkFrames; },
takeChunk() { return consume(chunkFrames); },
chunkFrames,
};
}