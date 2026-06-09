// Belote card ordering, point values, legal-move rules, and trick resolution.
//
// Seats use go-around numbering: play proceeds 0 → 1 → 2 → 3 → 0, partners sit
// opposite, so the two teams are {0, 2} and {1, 3}.

import { type Card, type Rank, type Suit } from "./deck";

export type Seat = 0 | 1 | 2 | 3;

/** A single card played to the current trick, tagged with who played it. */
export interface TrickPlay {
  seat: Seat;
  card: Card;
}

/** Team index (0 for seats {0,2}, 1 for seats {1,3}). */
export function teamOf(seat: Seat): 0 | 1 {
  return (seat % 2) as 0 | 1;
}

/** The seat sitting opposite — the player's partner. */
export function partnerOf(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}

/** The next seat to play, going around the table. */
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}

// Trump suit, strongest first: Jack, 9, Ace, 10, King, Queen, 8, 7.
const TRUMP_ORDER: readonly Rank[] = ["J", "9", "A", "10", "K", "Q", "8", "7"];
const TRUMP_POINTS: Record<Rank, number> = {
  J: 20,
  "9": 14,
  A: 11,
  "10": 10,
  K: 4,
  Q: 3,
  "8": 0,
  "7": 0,
};

// Plain (non-trump) suits, strongest first: Ace, 10, King, Queen, Jack, 9, 8, 7.
const PLAIN_ORDER: readonly Rank[] = ["A", "10", "K", "Q", "J", "9", "8", "7"];
const PLAIN_POINTS: Record<Rank, number> = {
  A: 11,
  "10": 10,
  K: 4,
  Q: 3,
  J: 2,
  "9": 0,
  "8": 0,
  "7": 0,
};

export function isTrump(card: Card, trump: Suit): boolean {
  return card.suit === trump;
}

/** Card point value, depending on whether it is a trump. */
export function cardPoints(card: Card, trump: Suit): number {
  return isTrump(card, trump) ? TRUMP_POINTS[card.rank] : PLAIN_POINTS[card.rank];
}

// Strength within a suit, strongest = 7, weakest = 0. Only meaningful when
// comparing cards of the same role (both trump, or both of the led suit).
function trumpStrength(rank: Rank): number {
  return TRUMP_ORDER.length - 1 - TRUMP_ORDER.indexOf(rank);
}
function plainStrength(rank: Rank): number {
  return PLAIN_ORDER.length - 1 - PLAIN_ORDER.indexOf(rank);
}

/**
 * A single comparable value for a played card given the trump suit and the suit
 * led. Trumps beat the led suit, which beats everything else; within each band
 * the suit's own ordering decides. The trick's highest value wins.
 */
function cardValue(card: Card, trump: Suit, ledSuit: Suit): number {
  if (isTrump(card, trump)) return 200 + trumpStrength(card.rank);
  if (card.suit === ledSuit) return 100 + plainStrength(card.rank);
  return plainStrength(card.rank);
}

/** Seat that wins a (complete or partial) trick. The first card sets the led suit. */
export function trickWinner(trick: TrickPlay[], trump: Suit): Seat {
  const ledSuit = trick[0].card.suit;
  let best = trick[0];
  let bestValue = cardValue(best.card, trump, ledSuit);
  for (const play of trick.slice(1)) {
    const value = cardValue(play.card, trump, ledSuit);
    if (value > bestValue) {
      best = play;
      bestValue = value;
    }
  }
  return best.seat;
}

/**
 * The cards `seat` may legally play from `hand`, given the cards already on the
 * current trick. Standard Belote obligations:
 *
 *  - Must follow the led suit if able.
 *  - Void in the led suit: must trump, and must over-trump a trump already in
 *    the trick if able (otherwise any trump). Exception — if the partner is
 *    currently winning the trick (and the lead is not itself trump), the player
 *    is free to discard anything.
 *  - When trump is led: must follow with trump and over-trump if able.
 *  - Holding no trump (when one would be required): free to discard anything.
 */
export function legalMoves(
  hand: Card[],
  trick: TrickPlay[],
  trump: Suit,
  seat: Seat,
): Card[] {
  // Leading: anything goes.
  if (trick.length === 0) return hand.slice();

  const ledSuit = trick[0].card.suit;
  const cardsOfLed = hand.filter((c) => c.suit === ledSuit);
  const trumps = hand.filter((c) => isTrump(c, trump));

  // Highest trump already on the trick, if any (-1 if none).
  const trumpsInTrick = trick.filter((p) => isTrump(p.card, trump));
  const highestTrumpStrength = trumpsInTrick.reduce(
    (max, p) => Math.max(max, trumpStrength(p.card.rank)),
    -1,
  );
  const overTrumps = trumps.filter(
    (c) => trumpStrength(c.rank) > highestTrumpStrength,
  );

  if (ledSuit === trump) {
    // Trump led: must follow trump and over-trump if possible.
    if (trumps.length === 0) return hand.slice();
    return overTrumps.length > 0 ? overTrumps : trumps;
  }

  // Plain suit led.
  if (cardsOfLed.length > 0) return cardsOfLed; // must follow

  // Void in the led suit. If the partner is currently winning, free discard.
  if (partnerOf(seat) === trickWinner(trick, trump)) return hand.slice();

  // Otherwise must trump if able, over-trumping when possible.
  if (trumps.length === 0) return hand.slice();
  return overTrumps.length > 0 ? overTrumps : trumps;
}

/** Whether two cards are the same card (suit + rank). */
export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}
