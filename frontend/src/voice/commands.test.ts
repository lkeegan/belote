import { expect, it } from "vitest";
import { normalizeFrench, parseVoiceCommand, resolveVoiceBid } from "./commands";

it.each([
  ["Je prends à cœurs !", "hearts"], ["je prends a coeurs", "hearts"],
  ["Je prends au carreau.", "diamonds"], ["je prends aux piques", "spades"],
  ["je prends à trèfle", "clubs"], ["Trèfles", "clubs"], ["carreaux", "diamonds"],
  ["je prend a treflle", "clubs"],
])("parses French take phrase %s", (phrase, suit) => {
  expect(parseVoiceCommand(phrase)).toEqual({ kind: "take", suit });
});

it.each(["Bonjour", "Je ne prends pas", "Non, je prends à cœur", "Il a pris à pique", "Deux cafés", "un deux trois", "de", "Est-ce que tu prends à cœur ?", "Je pense à carreau"])("rejects conversation or ambiguity: %s", (text) => {
  expect(parseVoiceCommand(text)).toBeNull();
});

it("normalizes accents and maps short commands without fuzzy matching", () => {
  expect(normalizeFrench("CŒURS, TRÈFLE !")).toBe("coeurs trefle");
  expect(parseVoiceCommand("Non.")).toEqual({ kind: "pass", word: "non" });
  expect(parseVoiceCommand("Deux !")).toEqual({ kind: "pass", word: "deux" });
  expect(parseVoiceCommand("oui")).toEqual({ kind: "take", suit: null });
  expect(parseVoiceCommand("don")).toBeNull();
});

it("resolves only legal bids for the current round", () => {
  const round1 = { round: 1, turnedSuit: "hearts" } as const;
  const round2 = { round: 2, turnedSuit: "hearts" } as const;
  expect(resolveVoiceBid({ kind: "take", suit: null }, round1)).toEqual({ suit: "hearts" });
  expect(resolveVoiceBid({ kind: "take", suit: "clubs" }, round1)).toBeNull();
  expect(resolveVoiceBid({ kind: "take", suit: "hearts" }, round2)).toBeNull();
  expect(resolveVoiceBid({ kind: "take", suit: null }, round2)).toBeNull();
  expect(resolveVoiceBid({ kind: "take", suit: "clubs" }, round2)).toEqual({ suit: "clubs" });
  expect(resolveVoiceBid({ kind: "pass", word: "deux" }, round1)).toBeNull();
  expect(resolveVoiceBid({ kind: "pass", word: "deux" }, round2)).toEqual({ suit: null });
});
