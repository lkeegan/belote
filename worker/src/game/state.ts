// The Belote game state machine: a GameState plus a pure reduce(state, action).
//
// reduce never throws on bad input and never mutates its argument; it returns
// either the next state or a validation error. All the rules live here and in
// rules.ts / scoring.ts, so the Durable Object stays a thin persistence layer.

import { type Card, type Suit, SUITS, dealBelote, completeDeal } from "./deck";
import {
  type Seat,
  type TrickPlay,
  legalMoves,
  nextSeat,
  sameCard,
  trickWinner,
} from "./rules";
import { type CompletedTrick, type HandResult, scoreHand } from "./scoring";

export type Phase = "bidding" | "playing" | "finished";

export interface GameState {
  phase: Phase;
  seed: string;
  /** Seat that opens (leads the first trick): game number mod 4. */
  opener: Seat;
  /** Four hands, all visible (no hidden information). Cards leave as they're played. */
  hands: Card[][];
  /** The turned-up card proposing trump (the retourne). */
  trumpCard: Card;
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
  | { type: "new"; seed?: string }
  // A bid: `suit === null` passes; otherwise the seat takes at that suit.
  | { type: "bid"; seat: Seat; suit: Suit | null }
  | { type: "play"; seat: Seat; card: Card }
  | { type: "clear" };

export type ReduceResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

const TRICKS_PER_HAND = 8;

// Reserve the last two digits as a game-of-day counter, matching the frontend's
// encoding so the worker's default game number agrees with the UI's.
const GAMES_PER_DAY = 100;

/**
 * Default game number for the day. Encoded as
 * ((year - 2026) * 10000 + month * 100 + day) * 100 — the same scheme the
 * frontend uses, so everyone playing that day shares a number.
 */
export function todaySeed(): string {
  const d = new Date();
  const dateCode =
    (d.getFullYear() - 2026) * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return String(dateCode * GAMES_PER_DAY);
}

/** Seat that opens the hand: game number mod 4, rotating each game. */
export function openerOf(seed: string): Seat {
  const n = parseInt(seed, 10);
  if (Number.isNaN(n)) return 0;
  return ((((n % 4) + 4) % 4) as Seat);
}

/** Deal a fresh hand from `seed` and enter the bidding phase. */
export function createGame(seed: string): GameState {
  const { hands, trumpCard } = dealBelote(seed);
  const opener = openerOf(seed);
  return {
    phase: "bidding",
    seed,
    opener,
    hands,
    trumpCard,
    trump: null,
    taker: null,
    turn: opener,
    biddingRound: 1,
    passes: 0,
    currentTrick: [],
    tricks: [],
    scores: [0, 0],
  };
}

function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function err(message: string): ReduceResult {
  return { ok: false, error: message };
}

/** Apply an action to the state, returning the next state or a validation error. */
export function reduce(state: GameState | null, action: Action): ReduceResult {
  if (action.type === "new") {
    const game = createGame(action.seed ?? todaySeed());
    // Carry cumulative scores across games; the "clear" action resets them.
    if (state) game.scores = [...state.scores];
    return { ok: true, state: game };
  }

  if (!state) return err("no game in progress");

  switch (action.type) {
    case "bid":
      return bid(state, action.seat, action.suit);
    case "play":
      return play(state, action.seat, action.card);
    case "clear":
      return { ok: true, state: { ...state, scores: [0, 0] } };
  }
}

/**
 * A bid by `seat`. `suit === null` is a pass; otherwise the seat takes at that
 * suit — in round 1 it must be the turned-up suit, in round 2 a different one.
 * Four passes ends the round: round 1 opens round 2, round 2 deals the next
 * hand (keeping the running scores).
 */
function bid(state: GameState, seat: Seat, suit: Suit | null): ReduceResult {
  if (state.phase !== "bidding") return err("not in bidding phase");
  if (!isSeat(seat)) return err("invalid seat");
  if (seat !== state.turn) return err("not your turn");

  if (suit === null) {
    const passes = state.passes + 1;
    if (passes < 4) {
      return { ok: true, state: { ...state, passes, turn: nextSeat(seat) } };
    }
    if (state.biddingRound === 1) {
      // Everyone passed the retourne; open the second round from the opener.
      return {
        ok: true,
        state: { ...state, biddingRound: 2, passes: 0, turn: state.opener },
      };
    }
    // Passed twice over: redeal the next hand, keeping cumulative scores.
    const next = createGame(String((parseInt(state.seed, 10) || 0) + 1));
    next.scores = [...state.scores];
    return { ok: true, state: next };
  }

  if (!SUITS.includes(suit)) return err("invalid suit");
  if (state.biddingRound === 1 && suit !== state.trumpCard.suit)
    return err("first round takes the turned-up suit");
  if (state.biddingRound === 2 && suit === state.trumpCard.suit)
    return err("second round must name a different suit");

  const { hands } = completeDeal(state.seed, seat);
  return {
    ok: true,
    state: {
      ...state,
      phase: "playing",
      hands,
      trump: suit,
      taker: seat,
      turn: state.opener,
      currentTrick: [],
      tricks: [],
    },
  };
}

function play(state: GameState, seat: Seat, card: Card): ReduceResult {
  if (state.phase !== "playing") return err("not in playing phase");
  if (state.trump === null) return err("no trump set");
  if (!isSeat(seat)) return err("invalid seat");
  if (seat !== state.turn) return err("not your turn");

  const hand = state.hands[seat];
  if (!hand.some((c) => sameCard(c, card))) return err("card not in hand");

  const legal = legalMoves(hand, state.currentTrick, state.trump, seat);
  if (!legal.some((c) => sameCard(c, card))) return err("illegal move");

  // Remove the played card from the seat's hand.
  const hands = state.hands.map((h, s) =>
    s === seat ? h.filter((c) => !sameCard(c, card)) : h,
  );
  const currentTrick = [...state.currentTrick, { seat, card }];

  // Trick still in progress.
  if (currentTrick.length < 4) {
    return {
      ok: true,
      state: { ...state, hands, currentTrick, turn: nextSeat(seat) },
    };
  }

  // Fourth card: resolve the trick.
  const winner = trickWinner(currentTrick, state.trump);
  const tricks = [...state.tricks, { winner, cards: currentTrick }];

  if (tricks.length < TRICKS_PER_HAND) {
    return {
      ok: true,
      state: { ...state, hands, currentTrick: [], tricks, turn: winner },
    };
  }

  // Eighth trick: score the hand and finish.
  const result = scoreHand(tricks, state.trump, state.taker!);
  const scores: [number, number] = [
    state.scores[0] + result.handPoints[0],
    state.scores[1] + result.handPoints[1],
  ];
  return {
    ok: true,
    state: {
      ...state,
      phase: "finished",
      hands,
      currentTrick: [],
      tricks,
      turn: winner,
      scores,
      result,
    },
  };
}
