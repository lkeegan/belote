import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceBidding, type VoiceTurn } from "./bidding";
import type { CaptureHandlers, VoiceCapture } from "./microphone";

vi.mock("./microphone", () => ({ canUseVoskMicrophone: () => true }));

class FakeCapture implements VoiceCapture {
  handlers!: CaptureHandlers;
  listen = vi.fn();
  close = vi.fn();
  start = vi.fn(async (handlers: CaptureHandlers) => { this.handlers = handlers; });
}

let turn: VoiceTurn | null;
let seat: 0 | 1 | null;
let voice: VoiceBidding;
let capture: FakeCapture;
const bid = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  seat = 0;
  turn = { key: "deal-1-round-1-seat-0", seat: 0, round: 1, turnedSuit: "hearts" };
  capture = new FakeCapture();
  voice = new VoiceBidding({ seat: () => seat, turn: () => turn, bid, changed: vi.fn(), createCapture: () => capture });
});
afterEach(() => voice.cancel());

it("only activates on request, displays partials, and sends a final bid once", async () => {
  voice.update();
  expect(capture.start).not.toHaveBeenCalled();
  await voice.start();
  expect(capture.listen).toHaveBeenLastCalledWith(turn!.key);
  capture.handlers.partial(turn!.key, "cœur");
  expect(voice.transcript).toBe("cœur");
  expect(voice.outcome).toBe("partial");
  expect(bid).not.toHaveBeenCalled();
  capture.handlers.final(turn!.key, "cœur", [{ word: "cœur", conf: 1, start: 0, end: 0.3 }]);
  capture.handlers.final(turn!.key, "non");
  expect(bid).toHaveBeenCalledExactlyOnceWith(0, "hearts");
  expect(capture.listen).toHaveBeenLastCalledWith(null);
  voice.update();
  expect(capture.listen).toHaveBeenLastCalledWith(null);
});

it("waits between turns and resumes automatically with a fresh turn key", async () => {
  turn = null;
  await voice.start();
  expect(voice.enabled).toBe(true);
  expect(voice.listening).toBe(false);
  turn = { key: "round-2", seat: 0, round: 2, turnedSuit: "hearts" };
  voice.update();
  expect(capture.listen).toHaveBeenLastCalledWith("round-2");
  capture.handlers.final("round-2", "Deux", [{ word: "deux", conf: 1, start: 0, end: 0.3 }]);
  expect(bid).toHaveBeenCalledExactlyOnceWith(0, null);
});

it("rejects results when the turn changes before rendering", async () => {
  await voice.start();
  turn = { ...turn!, key: "another-deal" };
  capture.handlers.final("deal-1-round-1-seat-0", "oui");
  expect(bid).not.toHaveBeenCalled();
  expect(voice.outcome).toBe("ignored");
  expect(capture.listen).toHaveBeenLastCalledWith("another-deal");
});

it("pauses on a turn change and switches audio off on a seat change", async () => {
  await voice.start();
  turn = null;
  voice.update();
  expect(capture.listen).toHaveBeenLastCalledWith(null);
  expect(voice.enabled).toBe(true);
  seat = 1;
  voice.update();
  expect(capture.close).toHaveBeenCalled();
  expect(voice.enabled).toBe(false);
});

it("keeps raw text and distinguishes unmatched from unavailable commands", async () => {
  await voice.start();
  capture.handlers.final(turn!.key, "bonjour");
  expect(voice.transcript).toBe("bonjour");
  expect(voice.outcome).toBe("unrecognized");
  capture.handlers.final(turn!.key, "trèfles");
  expect(voice.command).toEqual({ kind: "take", suit: "clubs" });
  expect(voice.outcome).toBe("unavailable");
  expect(bid).not.toHaveBeenCalled();
  capture.handlers.final(turn!.key, "Non", [{ word: "non", conf: 1, start: 0, end: 0.3 }]);
  expect(voice.outcome).toBe("sent");
  expect(bid).toHaveBeenCalledExactlyOnceWith(0, null);
});

it.each([undefined, 0.9999999999, NaN, 1.1])("requires exact 1.0 confidence, rejects %s, and keeps listening", async (score) => {
  await voice.start();
  const words = score === undefined ? undefined : [{ word: "non", conf: score, start: 0, end: 0.3 }];
  capture.handlers.final(turn!.key, "non", words);
  expect(bid).not.toHaveBeenCalled();
  expect(voice.transcript).toBe("non");
  expect(voice.outcome).toBe("low-confidence");
  expect(voice.listening).toBe(true);
  capture.handlers.final(turn!.key, "non", [{ word: "non", conf: 1, start: 0, end: 0.3 }]);
  expect(bid).toHaveBeenCalledExactlyOnceWith(0, null);
});

it("handles microphone denial and shuts down the capture", async () => {
  capture.start.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  await voice.start();
  expect(voice.enabled).toBe(false);
  expect(voice.message).toContain("non autorisé");
  expect(capture.close).toHaveBeenCalled();
});

it("can be disabled while loading and ignores late callbacks", async () => {
  let resolve!: () => void;
  capture.start.mockImplementation((handlers) => {
    capture.handlers = handlers;
    return new Promise<void>((done) => { resolve = done; });
  });
  const started = voice.start();
  expect(voice.loading).toBe(true);
  voice.cancel();
  resolve();
  await started;
  capture.handlers.final(turn!.key, "Non");
  expect(voice.enabled).toBe(false);
  expect(capture.close).toHaveBeenCalled();
  expect(bid).not.toHaveBeenCalled();
});
