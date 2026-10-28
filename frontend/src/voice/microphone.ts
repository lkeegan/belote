import { BrowserVosk, type VoskWord } from "./vosk";
import captureWorkletURL from "./capture-worklet.js?url&no-inline";

export interface CaptureHandlers {
  partial(key: string, text: string): void;
  final(key: string, text: string, words?: readonly VoskWord[]): void;
  error(error: Error): void;
}

export interface VoiceCapture {
  start(handlers: CaptureHandlers): Promise<void>;
  listen(key: string | null): void;
  close(): void;
}

export const canUseVoskMicrophone = () => Boolean(
  typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function" &&
  typeof globalThis.AudioContext === "function" && typeof globalThis.AudioWorkletNode === "function" &&
  typeof globalThis.WebAssembly === "object",
);

/** Owns the microphone and a WASM model; a fresh recognizer is used for each turn. */
export class VoskMicrophone implements VoiceCapture {
  private model = new BrowserVosk();
  private context?: AudioContext;
  private media?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private recognition?: ReturnType<BrowserVosk["createStream"]>;
  private handlers?: CaptureHandlers;
  private key: string | null = null;
  private closed = false;
  private ready = false;

  async start(handlers: CaptureHandlers): Promise<void> {
    this.handlers = handlers;
    if (!canUseVoskMicrophone()) throw new Error("Audio indisponible : utilisez HTTPS et un navigateur récent.");
    let stage = "initialisation audio";
    try {
      // Start both calls on the button's user gesture, before downloading the model.
      const context = this.context = new AudioContext();
      const resumed = context.resume();
      void resumed.catch(() => {}); // Promise.all below reports it; avoid an early unhandled rejection.
      const requested = navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true,
      } });
      stage = "accès au microphone";
      const media = await requested;
      if (this.closed) { media.getTracks().forEach((track) => track.stop()); return; }
      this.media = media;
      stage = "chargement Vosk et audio";
      await Promise.all([
        resumed,
        this.model.load(),
        context.audioWorklet.addModule(captureWorkletURL),
      ]);
      if (this.closed) return;
      stage = "capture audio";
      this.source = context.createMediaStreamSource(media);
      const node = this.node = new AudioWorkletNode(context, "belote-capture", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      });
      node.port.onmessage = ({ data }: MessageEvent<{ key: string; samples: Float32Array }>) => {
        if (!this.closed && data.key === this.key) this.recognition?.push(data.samples);
      };
      node.onprocessorerror = () => this.fail(new Error("Capture audio interrompue."));
      this.source.connect(node);
      node.connect(context.destination);
      this.ready = true;
      context.onstatechange = () => {
        if (!this.closed && context.state !== "running") this.fail(new Error("Microphone interrompu. Réactivez l’audio."));
      };
      for (const track of media.getTracks()) {
        track.addEventListener("ended", () => this.fail(new Error("Microphone déconnecté.")));
      }
    } catch (error) {
      this.close();
      console.error(`Vosk : ${stage}`, error);
      throw error;
    }
  }

  listen(key: string | null): void {
    if (this.closed || !this.ready || key === this.key) return;
    this.recognition?.close();
    this.recognition = undefined;
    this.key = key;
    this.node!.port.postMessage({ key });
    if (key === null) return;
    const current = () => !this.closed && this.key === key;
    this.recognition = this.model.createStream(this.context!.sampleRate, {
      partial: (text) => { if (current()) this.handlers!.partial(key, text); },
      final: (text, words) => { if (current()) this.handlers!.final(key, text, words); },
      error: (error) => { if (current()) this.fail(error); },
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.close();
    this.handlers?.error(error);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.key = null;
    this.recognition?.close();
    this.node?.disconnect();
    this.node?.port.close();
    this.source?.disconnect();
    this.media?.getTracks().forEach((track) => track.stop());
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    this.model.dispose();
  }
}
