import { createApp, reactive } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';


// ======== Config (adjust as needed) ========
const WS_URL = (window.WS_URL) || 'ws://localhost:8080/ws/stream';
const API_BASE = (window.API_BASE) || 'http://localhost:8080';
// If your MinIO/S3 bucket is public (or fronted by a proxy), set:
const MEDIA_BASE_URL = (window.MEDIA_BASE_URL) || 'http://localhost:9000/tunetrace-tracks/';
// Chunk length (seconds). The backend processes each chunk independently.
const CHUNK_SECONDS = 1.5;


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
        let ctx = null, source = null, proc = null, chunker = null;


        async function start() {
            try {
                state.status = 'requesting mic...';
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
                state.sampleRate = ctx.sampleRate;


                source = ctx.createMediaStreamSource(stream);
                proc = ctx.createScriptProcessor(4096, 1, 1);
                chunker = createChunker(ctx.sampleRate, CHUNK_SECONDS);


                proc.onaudioprocess = (e) => {
                    const ch0 = e.inputBuffer.getChannelData(0);
                    // copy frame
                    chunker.push(new Float32Array(ch0));
                    if (chunker.hasChunk()) {
                        const frames = chunker.takeChunk();
                        const wav = encodeWavPCM16(frames, ctx.sampleRate);
                        if (ws && ws.readyState === WebSocket.OPEN) ws.send(wav);
                        state.chunks += 1;
                    }
                };


                source.connect(proc);
                proc.connect(ctx.destination);


                ws = new WebSocket(WS_URL);
                ws.binaryType = 'arraybuffer';
                ws.onopen = () => { state.status = 'listening'; };
                ws.onmessage = (evt) => {
                    try {
                        const data = JSON.parse(evt.data);
                        if (data?.match) {
                            state.match = data.match;
                            state.status = 'matched';
                        }
                    } catch (_) { }
                };
                ws.onerror = () => { state.status = 'ws error'; };
                ws.onclose = () => { if (state.recording) stop(); };


                state.recording = true; state.status = 'listening';
            } catch (e) {
                console.error(e);
                state.status = 'mic error';
            }
        }


        function stop() {
            state.recording = false; state.status = 'idle';
            try { proc && proc.disconnect(); } catch { }
            try { source && source.disconnect(); } catch { }
            try { ctx && ctx.close(); } catch { }
            try { ws && ws.close(); } catch { }
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