/** Minimal Web Speech types, including Safari's prefixed implementation. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{
    isFinal: boolean; [index: number]: { transcript: string; confidence: number };
  }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
interface Constructor {
  new(): Recognition;
  available?(options: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(options: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

function constructor(): Constructor | undefined {
  const browser = globalThis as typeof globalThis & {
    SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export const supportsBrowserSpeech = () => Boolean(constructor());

export async function localFrenchAvailability(): Promise<string> {
  return constructor()?.available?.({ langs: ["fr-FR"], processLocally: true }) ?? "unsupported";
}

export async function installLocalFrench(): Promise<boolean> {
  return constructor()?.install?.({ langs: ["fr-FR"], processLocally: true }) ?? false;
}

/** One user-initiated utterance. No automatic restarts or interim actions. */
export function recognizeFrench(handlers: {
  result(text: string, confidence: number): void;
  error(error: string): void;
  end(): void;
}, locally = false): () => void {
  const Speech = constructor();
  if (!Speech) throw new Error("Reconnaissance vocale indisponible sur ce navigateur.");
  const recognition = new Speech();
  recognition.lang = "fr-FR";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  if (locally) {
    if (!("processLocally" in recognition)) throw new Error("Reconnaissance locale indisponible.");
    recognition.processLocally = true;
  }
  let active = true;
  const abort = () => {
    active = false;
    recognition.onresult = recognition.onerror = recognition.onend = null;
    recognition.abort();
  };
  recognition.onresult = (event) => {
    if (!active) return;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const { transcript, confidence } = result[0];
      abort();
      handlers.result(transcript, confidence);
      handlers.end();
      return;
    }
  };
  recognition.onerror = (event) => {
    if (!active) return;
    abort();
    handlers.error(event.error);
    handlers.end();
  };
  recognition.onend = () => {
    if (!active) return;
    active = false;
    handlers.end();
  };
  try {
    recognition.start();
  } catch (error) {
    abort();
    throw error;
  }
  return abort;
}
