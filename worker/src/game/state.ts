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
import {
  type Annonce,
  type CompletedTrick,
  type HandResult,
  handAnnonces,
  scoreHand,
} from "./scoring";

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
  // Take back the last card played to the current trick (only its player may).
  | { type: "undo"; seat: Seat }
  // Swap the last played card for another (take back, then play in its place).
  | { type: "replace"; seat: Seat; card: Card }
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
    case "undo":
      return undo(state, action.seat);
    case "replace":
      return replace(state, action.seat, action.card);
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

/**
 * Take back the most recently played card. Only the seat that played it may,
 * and only while it is still the topmost card on the table — once the next card
 * is played over it the move is locked in. The card returns to that seat's hand
 * and the turn rewinds to them.
 *
 * The fourth card of a trick counts too: a completed trick lingers on the table
 * until the winner leads, so until then its last card can still be taken back,
 * un-resolving the trick to three cards in progress. The exception is the eighth
 * trick, which finishes the hand: its last card was the player's only legal one,
 * so there is nothing to reconsider, and `phase !== "playing"` rules it out.
 */
/** The cards of the trick on the table: the one in progress, or — when none is
 *  — the trick that just completed and still shows until the winner leads. */
function tableTrick(state: GameState): TrickPlay[] {
  return state.currentTrick.length > 0
    ? state.currentTrick
    : (state.tricks[state.tricks.length - 1]?.cards ?? []);
}

function undo(state: GameState, seat: Seat): ReduceResult {
  if (state.phase !== "playing") return err("not in playing phase");
  if (!isSeat(seat)) return err("invalid seat");

  const inProgress = state.currentTrick.length > 0;
  const cards = tableTrick(state);
  const top = cards[cards.length - 1];
  if (!top) return err("no card to take back");
  if (top.seat !== seat)
    return err("only the last card played can be taken back");

  // Return the card to its hand and rewind the turn. A completed trick is
  // un-resolved back to three cards in progress (and dropped from `tricks`).
  const hands = state.hands.map((h, s) => (s === seat ? [...h, top.card] : h));
  return {
    ok: true,
    state: {
      ...state,
      hands,
      currentTrick: cards.slice(0, -1),
      tricks: inProgress ? state.tricks : state.tricks.slice(0, -1),
      turn: seat,
    },
  };
}

/**
 * Swap the last played card for another: take it back, then play `card` in its
 * place. Only the seat that played the topmost card may, and only for a legal
 * replacement — both checks fall out of composing `undo` with `play`.
 */
function replace(state: GameState, seat: Seat, card: Card): ReduceResult {
  const undone = undo(state, seat);
  if (!undone.ok) return undone;
  return play(undone.state, seat, card);
}

/**
 * The annonces a seat may reveal right now, or an error if it can't. The rules
 * let opponents ask to see declarations on the second trick, so that is the only
 * window; the reveal is ephemeral (a transient broadcast, not stored in state),
 * so it may be requested repeatedly while the window is open. The combinations
 * are read from the cards still held.
 */
export function annoncesToReveal(
  state: GameState | null,
  seat: Seat,
): { ok: true; annonces: Annonce[] } | { ok: false; error: string } {
  if (!state) return { ok: false, error: "no game in progress" };
  if (state.phase !== "playing") return { ok: false, error: "not in playing phase" };
  if (state.trump === null) return { ok: false, error: "no trump set" };
  if (!isSeat(seat)) return { ok: false, error: "invalid seat" };
  if (state.tricks.length !== 1)
    return { ok: false, error: "annonces are shown on the second trick" };
  const annonces = handAnnonces(state.hands[seat], seat, state.trump);
  if (annonces.length === 0) return { ok: false, error: "no annonces to show" };
  return { ok: true, annonces };
}

/**
 * The cards the player who made the last move could legally swap it for, so the
 * client can highlight them. Empty unless a take-back is available.
 */
export function replaceOptions(state: GameState): Card[] {
  if (state.phase !== "playing" || state.trump === null) return [];
  const cards = tableTrick(state);
  const top = cards[cards.length - 1];
  if (!top) return [];
  const undone = undo(state, top.seat);
  if (!undone.ok) return [];
  return legalMoves(
    undone.state.hands[top.seat],
    undone.state.currentTrick,
    state.trump,
    top.seat,
  );
}
