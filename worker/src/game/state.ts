// The Belote game state machine: a GameState plus a pure reduce(state, action).
//
// reduce never throws on bad input and never mutates its argument; it returns
// either the next state or a validation error. All the rules live here and in
// rules.ts / scoring.ts, so the Durable Object stays a thin persistence layer.

import {
  type BeloteDeal,
  type Card,
  type Rng,
  type Suit,
  SUITS,
  dealBelote,
  completeDeal,
} from "./deck";
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
  | { type: "new" }
  // A bid: `suit === null` passes; otherwise the seat takes at that suit.
  | { type: "bid"; seat: Seat; suit: Suit | null }
  | { type: "play"; seat: Seat; card: Card }
  | { type: "clear" };

export type ReduceResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

const TRICKS_PER_HAND = 8;

/** Deal a fresh random hand opened by `opener` and enter the bidding phase. */
export function createGame(opener: Seat, rng: Rng = Math.random): GameState {
  const { hands, trumpCard, talon } = dealBelote(rng);
  return {
    phase: "bidding",
    opener,
    hands,
    trumpCard,
    talon,
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

/** Deal the next hand: rotate the opener one seat clockwise, keep the scores. */
function dealNext(prev: GameState, rng: Rng): GameState {
  const game = createGame(nextSeat(prev.opener), rng);
  game.scores = [...prev.scores];
  return game;
}

/** Apply an action to the state, returning the next state or a validation error. */
export function reduce(
  state: GameState | null,
  action: Action,
  rng: Rng = Math.random,
): ReduceResult {
  if (action.type === "new") {
    // The first deal opens with seat 0; later deals rotate clockwise.
    const game = state ? dealNext(state, rng) : createGame(0, rng);
    return { ok: true, state: game };
  }

  if (!state) return err("no game in progress");

  switch (action.type) {
    case "bid":
      return bid(state, action.seat, action.suit, rng);
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
function bid(
  state: GameState,
  seat: Seat,
  suit: Suit | null,
  rng: Rng,
): ReduceResult {
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
    // Passed twice over: deal the next hand.
    return { ok: true, state: dealNext(state, rng) };
  }

  if (!SUITS.includes(suit)) return err("invalid suit");
  if (state.biddingRound === 1 && suit !== state.trumpCard.suit)
    return err("first round takes the turned-up suit");
  if (state.biddingRound === 2 && suit === state.trumpCard.suit)
    return err("second round must name a different suit");

  const deal: BeloteDeal = {
    hands: state.hands,
    trumpCard: state.trumpCard,
    talon: state.talon,
  };
  const hands = completeDeal(deal, seat);
  return {
    ok: true,
    state: {
      ...state,
      phase: "playing",
      hands,
      trump: suit,
      taker: seat,
      turn: state.opener,
      talon: [], // dealt out into the hands
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
