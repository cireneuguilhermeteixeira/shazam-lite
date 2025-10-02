// worklet/mic-processor.js
// run in AudioWorkletGlobalScope (other context).
// Envia blocos Float32 da entrada de áudio para o main thread via port.

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ch = 0; // usa canal 0 (mono)
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[this._ch] && input[this._ch].length) {
      // Copia o frame para não compartilhar o mesmo buffer
      const frame = new Float32Array(input[this._ch]);
      this.port.postMessage(frame, [frame.buffer]);
    }
    // true => continua processando
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
