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

/**
 * Deal `cardsPerHand` cards to each of `playerCount` players from a freshly
 * shuffled deck. Returns one hand (array of cards) per player.
 */
export function deal(playerCount: number, cardsPerHand: number): Card[][] {
  if (playerCount * cardsPerHand > 32) {
    throw new Error("Not enough cards in a Belote deck for that deal.");
  }
  const deck = shuffle(createDeck());
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < playerCount * cardsPerHand; i++) {
    hands[i % playerCount].push(deck[i]);
  }
  return hands;
}
