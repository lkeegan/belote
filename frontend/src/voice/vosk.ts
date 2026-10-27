import type { Model, KaldiRecognizer } from "vosk-browser";

const RATE = 16000;
const MODEL_URL = `${import.meta.env.BASE_URL}models/vosk-model-small-fr-0.22.tar.gz`;
const grammar = ["non", "deux", "oui", "je passe", "je prends"];
for (const suit of ["coeur", "cœur", "coeurs", "cœurs", "carreau", "carreaux", "pique", "piques", "trèfle", "trèfles"]) {
  grammar.push(suit, `je prends à ${suit}`, `je prends au ${suit}`, `je prends aux ${suit}`);
}
grammar.push("[unk]");

/** A single lazily loaded WASM worker/model shared by both Vosk decoders. */
export class BrowserVosk {
  private pending?: Promise<Model>;
  private model?: Model;
  private active = false;
  private cancelLoad?: () => void;
  private generation = 0;

  async load(): Promise<void> {
    if (!this.pending) {
      const generation = this.generation;
      this.pending = (async () => {
        const { Model } = await import("vosk-browser");
        if (generation !== this.generation) throw new DOMException("Chargement Vosk annulé.", "AbortError");
        const model = new Model(new URL(MODEL_URL, location.href).href, -1);
        this.model = model;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Chargement du modèle Vosk trop long.")), 120000);
          this.cancelLoad = () => {
            clearTimeout(timer);
            reject(new DOMException("Chargement Vosk annulé.", "AbortError"));
          };
          model.on("load", (message) => {
            clearTimeout(timer);
            if (generation === this.generation) this.cancelLoad = undefined;
            if (message.event === "load" && message.result) resolve();
            else reject(new Error("Chargement Vosk impossible."));
          });
          model.on("error", (message) => {
            clearTimeout(timer);
            if (generation === this.generation) this.cancelLoad = undefined;
            reject(new Error(message.event === "error" && message.error
              ? message.error : "Chargement Vosk impossible (modèle ou stockage du navigateur)."));
          });
        });
        return model;
      })().catch((error) => {
        if (generation === this.generation) this.dispose();
        throw error;
      });
    }
    await this.pending;
  }

  /** A grammar-constrained stream at the microphone's actual sample rate. */
  createStream(sampleRate: number, handlers: {
    partial(text: string): void;
    final(text: string): void;
    error(error: Error): void;
  }): { push(samples: Float32Array): void; close(): void } {
    if (!this.model?.ready) throw new Error("Modèle Vosk non chargé.");
    const recognizer = new this.model.KaldiRecognizer(sampleRate, JSON.stringify(grammar));
    let closed = false;
    let pending = 0;
    const close = () => {
      if (closed) return;
      closed = true;
      recognizer.remove();
    };
    const fail = (error: Error) => {
      if (closed) return;
      close();
      handlers.error(error);
    };
    recognizer.on("partialresult", (message) => {
      if (closed || message.event !== "partialresult") return;
      pending--;
      handlers.partial(message.result.partial);
    });
    recognizer.on("result", (message) => {
      if (closed || message.event !== "result") return;
      pending--;
      handlers.final(message.result.text);
    });
    recognizer.on("error", (message) => {
      fail(new Error(message.event === "error" ? message.error : "Erreur Vosk"));
    });
    return {
      push(samples) {
        if (closed) return;
        // Bound queued audio instead of building an ever-older backlog on slow devices.
        if (pending >= 16) return fail(new Error("Reconnaissance trop lente sur cet appareil. Réactivez l’audio pour réessayer."));
        pending++;
        try { recognizer.acceptWaveformFloat(samples, sampleRate); }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      },
      close,
    };
  }

  /** Decode uploaded/recorded audio entirely on-device, at the model's 16 kHz. */
  async transcribe(audio: Blob, constrained: boolean): Promise<{ text: string; inference_ms: number }> {
    const context = new OfflineAudioContext(1, 1, RATE);
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    if (decoded.duration > 15 || decoded.length === 0) throw new Error("Utilisez une phrase de 15 secondes maximum.");
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] += data[i] / decoded.numberOfChannels;
    }
    return this.transcribeSamples(samples, constrained);
  }

  async transcribeSamples(samples: Float32Array, constrained: boolean): Promise<{ text: string; inference_ms: number }> {
    if (this.active) throw new Error("Une transcription Vosk est déjà en cours.");
    if (!samples.length || samples.length > RATE * 15) throw new Error("Durée audio invalide.");
    this.active = true;
    let recognizer: KaldiRecognizer | undefined;
    try {
      await this.load();
      const started = performance.now();
      recognizer = new this.model!.KaldiRecognizer(RATE, constrained ? JSON.stringify(grammar) : undefined);
      const current = recognizer;
      return await new Promise((resolve, reject) => {
        const text: string[] = [];
        const chunks = Math.ceil(samples.length / 8000);
        let received = 0;
        let draining = false;
        const timer = setTimeout(() => reject(new Error("Transcription Vosk trop longue.")), 60000);
        const acknowledge = () => {
          if (++received === chunks) {
            draining = true;
            current.retrieveFinalResult();
          }
        };
        current.on("error", (message) => {
          clearTimeout(timer);
          reject(new Error(message.event === "error" ? message.error : "Erreur Vosk"));
        });
        current.on("partialresult", acknowledge);
        current.on("result", (message) => {
          if (message.event !== "result") return;
          if (message.result.text) text.push(message.result.text);
          if (draining) {
            clearTimeout(timer);
            resolve({ text: text.join(" "), inference_ms: Math.round(performance.now() - started) });
          } else acknowledge();
        });
        for (let offset = 0; offset < samples.length; offset += 8000) {
          current.acceptWaveformFloat(samples.slice(offset, offset + 8000), RATE);
        }
      });
    } finally {
      recognizer?.remove();
      this.active = false;
    }
  }

  dispose(): void {
    this.generation++;
    const cancelLoad = this.cancelLoad;
    this.cancelLoad = undefined;
    cancelLoad?.();
    if (this.model?.ready) this.model.terminate();
    else if (this.model) {
      // vosk-browser 0.0.8's public terminate assumes its native model exists.
      // A failed or cancelled load needs to stop the worker directly instead.
      (this.model as unknown as { worker: Worker }).worker.terminate();
    }
    this.model = undefined;
    this.pending = undefined;
  }
}
