// French Belote card vocabulary: the four suits and eight ranks, plus the
// types built from them. The deal itself lives on the worker; the frontend
// only needs these to render cards and type the game state.

export const SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;
export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}
