import type { Model } from "vosk-browser";
import { VOSK_GRAMMAR } from "./grammar";

const MODEL_URL = `${import.meta.env.BASE_URL}models/vosk-model-small-fr-0.22.tar.gz`;

export interface VoskWord { word: string; conf: number; start: number; end: number }

/** Owns a lazily loaded WASM worker and the French model for voice bidding. */
export class BrowserVosk {
  private pending?: Promise<Model>;
  private model?: Model;
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
    final(text: string, words: readonly VoskWord[]): void;
    error(error: Error): void;
  }): { push(samples: Float32Array): void; close(): void } {
    if (!this.model?.ready) throw new Error("Modèle Vosk non chargé.");
    const recognizer = new this.model.KaldiRecognizer(sampleRate, JSON.stringify(VOSK_GRAMMAR));
    recognizer.setWords(true);
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
      handlers.final(message.result.text, message.result.result ?? []);
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
