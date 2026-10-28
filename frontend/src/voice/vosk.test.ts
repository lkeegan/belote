import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserVosk } from "./vosk";

class Recognizer {
  static last: Recognizer;
  events = new Map<string, (message: any) => void>();
  acceptWaveformFloat = vi.fn();
  setWords = vi.fn();
  remove = vi.fn();
  constructor(readonly rate: number, readonly grammar: string) { Recognizer.last = this; }
  on(event: string, callback: (message: any) => void) { this.events.set(event, callback); }
  emit(event: string, result: object) { this.events.get(event)?.({ event, result }); }
}
class Model {
  static instances: Model[] = [];
  ready = false;
  events = new Map<string, (message: any) => void>();
  worker = { terminate: vi.fn() };
  terminate = vi.fn();
  KaldiRecognizer = Recognizer;
  constructor() { Model.instances.push(this); }
  on(event: string, callback: (message: any) => void) { this.events.set(event, callback); }
  loaded() { this.ready = true; this.events.get("load")?.({ event: "load", result: true }); }
}
vi.mock("vosk-browser", () => ({ Model }));

beforeEach(() => {
  Model.instances = [];
  vi.stubGlobal("location", { href: "https://example.com/belote/" });
});
afterEach(() => vi.unstubAllGlobals());

async function loaded() {
  const vosk = new BrowserVosk();
  const loading = vosk.load();
  await vi.waitFor(() => expect(Model.instances).toHaveLength(1));
  Model.instances[0].loaded();
  await loading;
  return vosk;
}

it("does not start a worker if disabled during the lazy import", async () => {
  const vosk = new BrowserVosk();
  const loading = vosk.load();
  vosk.dispose();
  await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  expect(Model.instances).toHaveLength(0);
});

it("cancels an in-flight model load and can load again", async () => {
  const vosk = new BrowserVosk();
  const loading = vosk.load();
  const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(Model.instances).toHaveLength(1));
  vosk.dispose();
  await rejected;
  expect(Model.instances[0].worker.terminate).toHaveBeenCalled();
  const next = vosk.load();
  await vi.waitFor(() => expect(Model.instances).toHaveLength(2));
  Model.instances[1].loaded();
  await next;
  vosk.dispose();
});

it("constrains live recognition and separates partials from final results", async () => {
  const vosk = await loaded();
  const handlers = { partial: vi.fn(), final: vi.fn(), error: vi.fn() };
  const stream = vosk.createStream(48000, handlers);
  const recognizer = Recognizer.last;
  expect(JSON.parse(recognizer.grammar)).toEqual(["oui", "non", "deux", "cœur", "piques", "carreaux", "trèfles", "[unk]"]);
  expect(recognizer.rate).toBe(48000);
  expect(recognizer.setWords).toHaveBeenCalledWith(true);
  stream.push(new Float32Array(4096));
  recognizer.emit("partialresult", { partial: "cœur" });
  expect(handlers.partial).toHaveBeenCalledWith("cœur");
  expect(handlers.final).not.toHaveBeenCalled();
  stream.push(new Float32Array(4096));
  const words = [{ word: "cœur", conf: 0.9, start: 0, end: 0.5 }];
  recognizer.emit("result", { text: "cœur", result: words });
  expect(handlers.final).toHaveBeenCalledWith("cœur", words);
  stream.close();
  recognizer.emit("result", { text: "non" });
  expect(handlers.final).toHaveBeenCalledTimes(1);
  expect(recognizer.remove).toHaveBeenCalledTimes(1);
  vosk.dispose();
});

it("stops an unresponsive recognizer instead of accumulating old audio", async () => {
  const vosk = await loaded();
  const handlers = { partial: vi.fn(), final: vi.fn(), error: vi.fn() };
  const stream = vosk.createStream(16000, handlers);
  for (let i = 0; i < 100; i++) stream.push(new Float32Array(4096));
  expect(handlers.error).toHaveBeenCalledTimes(1);
  expect(Recognizer.last.remove).toHaveBeenCalledTimes(1);
  vosk.dispose();
});
