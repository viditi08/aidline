class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.carry = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    const ratio = sampleRate / 24000;
    let index = this.carry;
    while (index < channel.length) {
      const sample = channel[Math.floor(index)] || 0;
      this.pending.push(sample);
      index += ratio;
    }
    this.carry = index - channel.length;

    const chunkSize = Math.round(24000 * 0.05);
    while (this.pending.length >= chunkSize) {
      const slice = this.pending.splice(0, chunkSize);
      const pcm = new Int16Array(slice.length);
      for (let i = 0; i < slice.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, slice[i]));
        pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
