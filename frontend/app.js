import { createApp, reactive } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
import { createChunker, encodeWavPCM16 } from './utils/audio.js';

// ======== Config (adjust as needed) ========
const WS_URL = (window.WS_URL) || 'ws://localhost:8080/ws/stream';
const API_BASE = (window.API_BASE) || 'http://localhost:8080';
// If your MinIO/S3 bucket is public (or fronted by a proxy), set:
const MEDIA_BASE_URL = (window.MEDIA_BASE_URL) || 'http://localhost:9000/tunetrace-tracks/';
// Chunk length (seconds). The backend processes each chunk independently.
const CHUNK_SECONDS = 1.5;
const KEEPALIVE_MS = 15000; // manda ping no WS p/ não cair

createApp({
    setup() {
        const state = reactive({
            recording: false,
            status: 'idle',
            chunks: 0,
            sampleRate: null,
            match: null,
            mediaUrl: ''
        });

        let ws = null;
        let wsPing = null;
        let ctx = null, source = null, node = null, chunker = null;

        async function start() {
            try {
                state.status = 'requesting mic...';

                // 1) Permissão do microfone
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

                // 2) AudioContext (44100 é desejado; alguns browsers podem ignorar)
                ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
                state.sampleRate = ctx.sampleRate;

                // 3) Carrega o módulo do AudioWorklet e cria o node
                await ctx.audioWorklet.addModule('./worklet/mic-processor.js');

                source = ctx.createMediaStreamSource(stream);
                node = new AudioWorkletNode(ctx, 'mic-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 0,
                    channelCount: 1
                });

                chunker = createChunker(ctx.sampleRate, CHUNK_SECONDS);

                // Recebe frames do worklet (Float32) e monta chunks
                node.port.onmessage = (evt) => {
                    const frame = evt.data; // Float32Array
                    chunker.push(frame);
                    if (chunker.hasChunk()) {
                        const frames = chunker.takeChunk();
                        const wav = encodeWavPCM16(frames, ctx.sampleRate);
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(wav);
                            state.chunks += 1;
                        }
                    }
                };

                // IMPORTANTÍSSIMO: não conectar no destination p/ evitar eco
                source.connect(node);

                // 4) WebSocket
                ws = new WebSocket(WS_URL);
                ws.binaryType = 'arraybuffer';
                ws.onopen = () => {
                    state.status = 'listening';
                    // ping keepalive
                    wsPing = setInterval(() => {
                        try {
                            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
                        } catch { }
                    }, KEEPALIVE_MS);
                };
                ws.onmessage = (evt) => {
                    try {
                        const data = JSON.parse(evt.data);
                        if (data?.match) {
                            state.match = data.match;
                            state.status = 'matched';
                        } else if (data?.ok) {
                            // opcional: console.log('ACK', data);
                        }
                    } catch (_) { /* ignore non-JSON */ }
                };
                ws.onerror = () => { state.status = 'ws error'; };
                ws.onclose = () => {
                    // não chamar stop() aqui para não “auto-parar” em close curto
                    clearInterval(wsPing); wsPing = null;
                    console.log("WS closed");
                    if (state.recording) state.status = 'ws closed';
                };

                // 5) Marca estado
                state.recording = true;
                state.status = 'listening';

            } catch (e) {
                console.error(e);
                state.status = 'mic error';
                stop();
            }
        }

        function stop() {
            state.recording = false;
            if (wsPing) { clearInterval(wsPing); wsPing = null; }
            try { ws && ws.readyState === WebSocket.OPEN && ws.close(); } catch { }
            ws = null;

            try { node && node.port && (node.port.onmessage = null); } catch { }
            try { source && source.disconnect(); } catch { }
            try { node && node.disconnect && node.disconnect(); } catch { }
            try { ctx && ctx.close(); } catch { }
            ctx = source = node = chunker = null;

            state.status = 'idle';
        }

        async function toggle() { state.recording ? stop() : start(); }

        async function loadMedia() {
            if (!state.match) return;
            try {
                const r = await fetch(`${API_BASE}/tracks/${state.match.song_id}`);
                const meta = await r.json();
                if (MEDIA_BASE_URL && meta?.s3Key) {
                    state.mediaUrl = MEDIA_BASE_URL + meta.s3Key;
                } else {
                    state.mediaUrl = '';
                    alert('MEDIA_BASE_URL not set or s3Key missing. Configure a public/proxied URL for MinIO/S3.');
                }
            } catch (e) {
                console.error(e);
            }
        }


        return { state, toggle, loadMedia, WS_URL, API_BASE };
    }
}).mount('#app');