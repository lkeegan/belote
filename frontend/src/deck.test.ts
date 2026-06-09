import { describe, it, expect } from "vitest";
import {
  createDeck,
  makeRng,
  shuffle,
  dealBelote,
  completeDeal,
  SUITS,
  RANKS,
  BELOTE_PLAYERS,
  type Card,
} from "./deck";

const key = (c: Card) => `${c.rank}${c.suit}`;
const keys = (cards: Card[]) => cards.map(key);

describe("createDeck", () => {
  it("builds 32 unique cards covering every suit and rank", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(32);
    expect(new Set(keys(deck)).size).toBe(32);
    for (const suit of SUITS) {
      expect(deck.filter((c) => c.suit === suit)).toHaveLength(RANKS.length);
    }
  });
});

describe("makeRng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng("42");
    const b = makeRng("42");
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const rng = makeRng("seed");
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs between seeds", () => {
    expect(makeRng("42")()).not.toBe(makeRng("43")());
  });
});

describe("shuffle", () => {
  it("returns a permutation without mutating the input", () => {
    const deck = createDeck();
    const before = keys(deck);
    const shuffled = shuffle(deck, makeRng("x"));
    expect(keys(deck)).toEqual(before); // input untouched
    expect(new Set(keys(shuffled))).toEqual(new Set(before)); // same cards
    expect(shuffled).toHaveLength(deck.length);
  });

  it("is deterministic for a given seeded rng", () => {
    expect(keys(shuffle(createDeck(), makeRng("7")))).toEqual(
      keys(shuffle(createDeck(), makeRng("7"))),
    );
  });
});

describe("dealBelote", () => {
  it("deals four five-card hands, a trump card, and an 11-card talon", () => {
    const { hands, trumpCard, talon } = dealBelote("42");
    expect(hands).toHaveLength(BELOTE_PLAYERS);
    for (const hand of hands) expect(hand).toHaveLength(5);
    expect(talon).toHaveLength(11);
    expect(trumpCard).toBeDefined();
  });

  it("uses all 32 cards exactly once", () => {
    const { hands, trumpCard, talon } = dealBelote("42");
    const all = [...hands.flat(), trumpCard, ...talon];
    expect(all).toHaveLength(32);
    expect(new Set(keys(all)).size).toBe(32);
  });

  it("is deterministic per seed and varies across seeds", () => {
    const flat = (s: string) => {
      const d = dealBelote(s);
      return keys([...d.hands.flat(), d.trumpCard, ...d.talon]);
    };
    expect(flat("42")).toEqual(flat("42"));
    expect(flat("42")).not.toEqual(flat("43"));
  });
});

describe("completeDeal", () => {
  it("gives every player eight cards using all 32 once, for any taker", () => {
    for (let taker = 0; taker < BELOTE_PLAYERS; taker++) {
      const { hands } = completeDeal("42", taker);
      const all = hands.flat();
      expect(hands.every((h) => h.length === 8)).toBe(true);
      expect(all).toHaveLength(32);
      expect(new Set(keys(all)).size).toBe(32);
    }
  });

  it("gives the taker the turned card plus two, others three", () => {
    const opening = dealBelote("42");
    const taker = 1;
    const { hands, trumpCard } = completeDeal("42", taker);

    // Each final hand extends that player's opening hand.
    for (let seat = 0; seat < BELOTE_PLAYERS; seat++) {
      expect(keys(hands[seat]).slice(0, 5)).toEqual(keys(opening.hands[seat]));
    }

    // The taker holds the turned-up card; others do not.
    expect(keys(hands[taker])).toContain(key(trumpCard));
    for (let seat = 0; seat < BELOTE_PLAYERS; seat++) {
      if (seat === taker) continue;
      expect(keys(hands[seat])).not.toContain(key(trumpCard));
    }

    // Taker drew 2 from the talon (5 + turned + 2), others drew 3.
    const drawn = (seat: number) => hands[seat].length - 5;
    expect(drawn(taker)).toBe(2 + 1); // two talon cards + the turned card
    for (let seat = 0; seat < BELOTE_PLAYERS; seat++) {
      if (seat !== taker) expect(drawn(seat)).toBe(3);
    }
  });

  it("reports the trump suit as the turned card's suit", () => {
    const { trumpCard, trumpSuit } = completeDeal("42", 0);
    expect(trumpSuit).toBe(trumpCard.suit);
  });

  it("is deterministic in (seed, taker)", () => {
    expect(keys(completeDeal("42", 2).hands.flat())).toEqual(
      keys(completeDeal("42", 2).hands.flat()),
    );
  });
});
