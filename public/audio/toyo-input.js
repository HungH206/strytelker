// Mono 16 kHz PCM, batched into 20 ms messages. No recordings are retained.
class ToyoInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.buffer = new Int16Array(320);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      value /= channels.length;
      this.sum += value;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        const average = Math.max(-1, Math.min(1, this.sum / this.count));
        while (this.phase >= sampleRate) {
          this.buffer[this.offset++] = Math.round(
            average * (average < 0 ? 32768 : 32767),
          );
          this.phase -= sampleRate;
          if (this.offset === this.buffer.length) {
            this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
            this.buffer = new Int16Array(320);
            this.offset = 0;
          }
        }
        this.sum = 0;
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor("toyo-input", ToyoInput);
