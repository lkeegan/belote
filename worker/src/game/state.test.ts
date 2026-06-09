import { describe, it, expect } from "vitest";
import { type Card, type Suit, SUITS, makeRng } from "./deck";
import { type Seat, legalMoves, nextSeat } from "./rules";
import { type GameState, createGame, reduce } from "./state";

const handSizes = (s: GameState) => s.hands.map((h) => h.length);

/** A deterministic deal for tests: fixed opener and seeded shuffle. */
const deal = (opener: Seat = 0, seed = "seed"): GameState =>
  createGame(opener, makeRng(seed));

describe("createGame", () => {
  it("deals a five-card bidding hand to everyone, opened by `opener`", () => {
    const s = deal(2);
    expect(s.phase).toBe("bidding");
    expect(handSizes(s)).toEqual([5, 5, 5, 5]);
    expect(s.talon).toHaveLength(11);
    expect(s.opener).toBe(2);
    expect(s.turn).toBe(2);
    expect(s.trump).toBe(null);
    expect(s.taker).toBe(null);
    expect(s.scores).toEqual([0, 0]);
  });
});

describe("reduce — new and guards", () => {
  it("opens the first deal with seat 0 and zero scores", () => {
    const r = reduce(null, { type: "new" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("bidding");
    expect(r.state.opener).toBe(0);
    expect(r.state.scores).toEqual([0, 0]);
  });

  it("rejects actions when there is no game", () => {
    const r = reduce(null, { type: "bid", seat: 0, suit: null });
    expect(r).toEqual({ ok: false, error: "no game in progress" });
  });

  it("rotates the opener clockwise and carries scores into a new deal", () => {
    const prev = { ...deal(1), scores: [120, 42] as [number, number] };
    const r = reduce(prev, { type: "new" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.opener).toBe(2); // 1 -> 2, clockwise
    expect(r.state.turn).toBe(2);
    expect(r.state.scores).toEqual([120, 42]); // accumulated, not reset
    expect(r.state.phase).toBe("bidding");
  });

  it("clears accumulated scores without redealing", () => {
    const playing = { ...deal(0), scores: [120, 42] as [number, number] };
    const r = reduce(playing, { type: "clear" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.scores).toEqual([0, 0]);
    expect(r.state.hands).toEqual(playing.hands); // same deal, only scores reset
  });

  it("rejects clear when there is no game", () => {
    expect(reduce(null, { type: "clear" })).toEqual({
      ok: false,
      error: "no game in progress",
    });
  });
});

/** Pass the bid for whoever is on turn. */
function passOnce(s: GameState): GameState {
  const r = reduce(s, { type: "bid", seat: s.turn, suit: null });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("reduce — bidding", () => {
  it("advances the turn on a pass", () => {
    const s = deal(0);
    const r = reduce(s, { type: "bid", seat: s.opener, suit: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("bidding");
    expect(r.state.turn).toBe(nextSeat(s.opener));
    expect(r.state.passes).toBe(1);
  });

  it("rejects a bid out of turn", () => {
    const s = deal(0);
    const r = reduce(s, { type: "bid", seat: nextSeat(s.opener), suit: null });
    expect(r).toEqual({ ok: false, error: "not your turn" });
  });

  it("takes the retourne suit in the first round and enters playing", () => {
    const s = deal(0);
    const r = reduce(s, { type: "bid", seat: s.opener, suit: s.trumpCard.suit });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("playing");
    expect(handSizes(r.state)).toEqual([8, 8, 8, 8]);
    expect(r.state.taker).toBe(s.opener);
    expect(r.state.trump).toBe(s.trumpCard.suit);
    expect(r.state.turn).toBe(s.opener); // opener leads
  });

  it("rejects taking a different suit in the first round", () => {
    const s = deal(0);
    const other = SUITS.find((x) => x !== s.trumpCard.suit)!;
    const r = reduce(s, { type: "bid", seat: s.opener, suit: other });
    expect(r).toEqual({ ok: false, error: "first round takes the turned-up suit" });
  });

  it("opens the second round after four passes", () => {
    let s = deal(0);
    for (let i = 0; i < 4; i++) s = passOnce(s);
    expect(s.phase).toBe("bidding");
    expect(s.biddingRound).toBe(2);
    expect(s.passes).toBe(0);
    expect(s.turn).toBe(s.opener);
  });

  it("takes a different suit in the second round", () => {
    let s = deal(0);
    const retourne = s.trumpCard.suit;
    for (let i = 0; i < 4; i++) s = passOnce(s);
    const other = SUITS.find((x) => x !== retourne)!;
    const r = reduce(s, { type: "bid", seat: s.opener, suit: other });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("playing");
    expect(r.state.trump).toBe(other);
    expect(r.state.taker).toBe(s.opener);
  });

  it("rejects taking the retourne suit in the second round", () => {
    let s = deal(0);
    const retourne = s.trumpCard.suit;
    for (let i = 0; i < 4; i++) s = passOnce(s);
    const r = reduce(s, { type: "bid", seat: s.opener, suit: retourne });
    expect(r).toEqual({
      ok: false,
      error: "second round must name a different suit",
    });
  });

  it("deals the next hand (rotating the opener) when everyone passes twice", () => {
    const start = { ...deal(0), scores: [50, 30] as [number, number] };
    let s = start;
    for (let i = 0; i < 8; i++) s = passOnce(s);
    expect(s.phase).toBe("bidding");
    expect(s.biddingRound).toBe(1);
    expect(s.opener).toBe(nextSeat(start.opener)); // dealer moves on
    expect(s.scores).toEqual([50, 30]); // scores carried over
    expect(handSizes(s)).toEqual([5, 5, 5, 5]);
  });

  it("does not mutate the input state", () => {
    const s = deal(0);
    const before = JSON.stringify(s);
    reduce(s, { type: "bid", seat: s.opener, suit: s.trumpCard.suit });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("reduce — play validation", () => {
  // A crafted mid-trick state: spades led, seat 1 to move holding a spade.
  const craftTrick = (): GameState => ({
    ...deal(0),
    phase: "playing",
    trump: "hearts" as Suit,
    taker: 0,
    turn: 1,
    hands: [
      [],
      [
        { suit: "spades", rank: "K" },
        { suit: "hearts", rank: "7" },
      ],
      [],
      [],
    ] as Card[][],
    currentTrick: [{ seat: 0, card: { suit: "spades", rank: "A" } }],
  });

  it("rejects a move that is out of turn", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 2,
      card: { suit: "spades", rank: "K" },
    });
    expect(r).toEqual({ ok: false, error: "not your turn" });
  });

  it("rejects a card the player does not hold", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 1,
      card: { suit: "clubs", rank: "A" },
    });
    expect(r).toEqual({ ok: false, error: "card not in hand" });
  });

  it("rejects an illegal move (not following suit)", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 1,
      card: { suit: "hearts", rank: "7" }, // must follow spades
    });
    expect(r).toEqual({ ok: false, error: "illegal move" });
  });

  it("accepts a legal move and advances the turn", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 1,
      card: { suit: "spades", rank: "K" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.currentTrick).toHaveLength(2);
    expect(r.state.turn).toBe(2);
    expect(r.state.hands[1]).toHaveLength(1);
  });
});

/** Deal (seeded) and have the opener take the retourne suit (enter playing). */
function takeGame(seed: string, opener: Seat = 0): GameState {
  const g = createGame(opener, makeRng(seed));
  const r = reduce(g, { type: "bid", seat: g.opener, suit: g.trumpCard.suit });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Drive a taken game to the finish, always playing the first legal card. */
function playToFinish(start: GameState): GameState {
  let state = start;
  let guard = 0;
  while (state.phase === "playing") {
    if (guard++ > 40) throw new Error("did not finish");
    const seat = state.turn;
    const legal = legalMoves(
      state.hands[seat],
      state.currentTrick,
      state.trump!,
      seat,
    );
    const r = reduce(state, { type: "play", seat, card: legal[0] });
    if (!r.ok) throw new Error(`unexpected rejection: ${r.error}`);
    state = r.state;
  }
  return state;
}

describe("reduce — a full hand", () => {
  it("plays eight tricks, scores once, and finishes", () => {
    const final = playToFinish(takeGame("42"));
    expect(final.phase).toBe("finished");
    expect(final.tricks).toHaveLength(8);
    expect(handSizes(final)).toEqual([0, 0, 0, 0]);
    expect(final.result).toBeDefined();

    // Cumulative scores equal this hand's points, which total 162 (no capot)
    // plus any belote bonus.
    const total = final.scores[0] + final.scores[1];
    const belote = final.result!.beloteTeam === null ? 0 : 20;
    expect(final.result!.capot ? total : total - belote).toBe(
      final.result!.capot ? 252 + belote : 162,
    );
    expect(final.scores).toEqual(final.result!.handPoints);
  });

  it("is deterministic for a given deal and taker", () => {
    const run = () => playToFinish(takeGame("77")).scores;
    expect(run()).toEqual(run());
  });

  it("rejects play once the hand is finished", () => {
    const final = playToFinish(takeGame("42"));
    const seat = final.tricks[7].winner;
    const r = reduce(final, {
      type: "play",
      seat,
      card: { suit: "hearts", rank: "7" },
    });
    expect(r.ok).toBe(false);
  });
});
