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

/** Return a new array with the cards shuffled (Fisher–Yates). */
export function shuffle<T>(cards: readonly T[]): T[] {
  const result = cards.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
 * Perform a Belote opening deal from a freshly shuffled 32-card deck: deal the
 * 3-then-2 packets to each of the four players, turn one card face up to
 * propose trump, and leave the rest as the talon.
 */
export function dealBelote(): BeloteDeal {
  const deck = shuffle(createDeck());
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
