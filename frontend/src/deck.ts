// A French Belote deck: 32 cards, ranks 7 through Ace in four suits.

export const SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;
export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

/** Build an ordered 32-card Belote deck. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** A pseudo-random number generator returning floats in [0, 1). */
export type Rng = () => number;

/**
 * Build a deterministic PRNG seeded from an arbitrary string. The same seed
 * always produces the same sequence, so every player who enters the same game
 * number derives an identical shuffle without any server.
 *
 * Uses a cyrb53-style hash to spread the seed, then a mulberry32 generator.
 */
export function makeRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Return a new array with the cards shuffled (Fisher–Yates), using `rng`. */
export function shuffle<T>(cards: readonly T[], rng: Rng = Math.random): T[] {
  const result = cards.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const BELOTE_PLAYERS = 4;

// Belote's opening deal is given in packets: three cards to each player, then
// two more, so everyone holds five cards before bidding.
const OPENING_PACKETS = [3, 2] as const;

export interface BeloteDeal {
  /** One five-card hand per player, in seating order. */
  hands: Card[][];
  /** The card turned face up to propose the trump suit. */
  trumpCard: Card;
  /** The remaining face-down cards, dealt out after bidding. */
  talon: Card[];
}

/**
 * Perform a Belote opening deal from a 32-card deck shuffled with `seed`: deal
 * the 3-then-2 packets to each of the four players, turn one card face up to
 * propose trump, and leave the rest as the talon. The same seed always yields
 * the same deal.
 */
export function dealBelote(seed: string): BeloteDeal {
  const deck = shuffle(createDeck(), makeRng(seed));
  const hands: Card[][] = Array.from({ length: BELOTE_PLAYERS }, () => []);

  let next = 0;
  for (const packetSize of OPENING_PACKETS) {
    for (let player = 0; player < BELOTE_PLAYERS; player++) {
      for (let c = 0; c < packetSize; c++) {
        hands[player].push(deck[next++]);
      }
    }
  }

  const trumpCard = deck[next++];
  const talon = deck.slice(next);
  return { hands, trumpCard, talon };
}

export interface CompletedDeal {
  /** One eight-card hand per player, in seating order. */
  hands: Card[][];
  /** The card that was turned up and taken into the taker's hand. */
  trumpCard: Card;
  /** The trump suit for the hand (the turned card's suit). */
  trumpSuit: Suit;
  /** Seat index of the player who took. */
  takerSeat: number;
}

// After a take, the taker keeps the turned card and draws two more; everyone
// else draws three. That accounts for all eleven talon cards (3 + 3 + 3 + 2).
const TAKER_DRAW = 2;
const OTHER_DRAW = 3;

/**
 * Complete the deal once bidding is settled and `takerSeat` has taken the
 * turned-up card. The taker keeps that card and draws two from the talon; the
 * other three players draw three each, leaving everyone with eight cards.
 *
 * Deterministic in (`seed`, `takerSeat`): every device that records the same
 * taker produces the same eight-card hands with no duplicate cards.
 */
export function completeDeal(seed: string, takerSeat: number): CompletedDeal {
  const { hands, trumpCard, talon } = dealBelote(seed);
  const finalHands = hands.map((hand) => hand.slice());
  finalHands[takerSeat].push(trumpCard);

  let next = 0;
  for (let seat = 0; seat < BELOTE_PLAYERS; seat++) {
    const draw = seat === takerSeat ? TAKER_DRAW : OTHER_DRAW;
    for (let c = 0; c < draw; c++) {
      finalHands[seat].push(talon[next++]);
    }
  }

  return {
    hands: finalHands,
    trumpCard,
    trumpSuit: trumpCard.suit,
    takerSeat,
  };
}
