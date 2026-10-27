// Shared card vocabulary and game/protocol types. No runtime or UI dependencies.

export const SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;
export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type Seat = 0 | 1 | 2 | 3;

/** A single card played to the current trick, tagged with who played it. */
export interface TrickPlay {
  seat: Seat;
  card: Card;
}

export interface CompletedTrick {
  winner: Seat;
  cards: TrickPlay[];
}

/** A declaration (annonce): a run of cards or a four-of-a-kind in one hand. */
export type AnnonceKind = "tierce" | "cinquante" | "cent" | "carre";

export interface Annonce {
  team: 0 | 1;
  kind: AnnonceKind;
  /** Top card of a sequence, or the shared rank of a carré. */
  rank: Rank;
  /** Suit of a sequence; omitted for a carré (it spans all four suits). */
  suit?: Suit;
  points: number;
  /**
   * The cards that make up the declaration, in display order: a sequence runs
   * low→high (7-8-9…), a carré lists its four suits. Lets clients show the
   * actual cards when a player reveals their annonces.
   */
  cards: Card[];
}

export interface HandResult {
  /** Points added to each team this hand, [team {0,2}, team {1,3}]. */
  handPoints: [number, number];
  /** Raw card points each team captured in tricks, before dix de der. */
  cardPoints: [number, number];
  /** Whether the taker's team fulfilled the contract. */
  madeContract: boolean;
  /** Whether one team swept all eight tricks. */
  capot: boolean;
  /** Team awarded belote-rebelote (+20), or null if no one held K+Q of trump. */
  beloteTeam: 0 | 1 | null;
  /** Team awarded the annonces, or null if there were none (or a top-tie). */
  annonceTeam: 0 | 1 | null;
  /** Total annonce points awarded to annonceTeam (0 if none). */
  annoncePoints: number;
  /** The winning team's annonces, for display. */
  annonces: Annonce[];
}

export type Phase = "bidding" | "playing" | "finished";

export interface GameState {
  /** Monotonically increasing across deals and matches, including passed hands. */
  dealId: number;
  phase: Phase;
  /** Seat that opens (bids first and leads the first trick); rotates each deal. */
  opener: Seat;
  /** Four hands, all visible (no hidden information). Cards leave as they're played. */
  hands: Card[][];
  /** The turned-up card proposing trump (the retourne). */
  trumpCard: Card;
  /** Face-down cards drawn to complete the hands once someone takes. */
  talon: Card[];
  /** Trump suit, set once someone takes. */
  trump: Suit | null;
  taker: Seat | null;
  /** Whose move it is — the current bidder, or the player to move. */
  turn: Seat;
  /** Which bidding round is open: 1 takes the retourne suit, 2 names another. */
  biddingRound: 1 | 2;
  /** Passes so far in the current bidding round (4 ends the round). */
  passes: number;
  currentTrick: TrickPlay[];
  tricks: CompletedTrick[];
  /** Cumulative points, [team {0,2}, team {1,3}]. */
  scores: [number, number];
  /** Set once the hand is finished. */
  result?: HandResult;
}

export type Action =
  | { type: "new"; dealId?: number }
  // A bid: `suit === null` passes; otherwise the seat takes at that suit.
  | { type: "bid"; seat: Seat; suit: Suit | null }
  | { type: "play"; seat: Seat; card: Card }
  // Take back the last card played to the current trick (only its player may).
  | { type: "undo"; seat: Seat }
  // Swap the last played card for another (take back, then play in its place).
  | { type: "replace"; seat: Seat; card: Card }
  // Start a new match: reshuffle a fresh pack and reset the scores to zero.
  | { type: "match"; dealId?: number };

