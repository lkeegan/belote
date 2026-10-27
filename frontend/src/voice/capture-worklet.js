// Collect mono microphone audio without doing recognition on the audio thread.
class BeloteCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.key = null;
    this.buffer = new Float32Array(4096);
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      this.key = data.key;
      this.offset = 0; // discard any audio belonging to the previous turn
    };
  }

  process(inputs) {
    const channels = inputs[0];
    if (this.key === null || !channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.buffer[this.offset++] = sample;
      if (this.offset === this.buffer.length) {
        this.port.postMessage({ key: this.key, samples: this.buffer }, [this.buffer.buffer]);
        this.buffer = new Float32Array(4096);
        this.offset = 0;
      }
    }
    // Outputs remain silent: microphone audio is never played through speakers.
    return true;
  }
}

registerProcessor("belote-capture", BeloteCapture);
