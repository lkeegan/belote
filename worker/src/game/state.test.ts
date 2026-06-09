import { describe, it, expect } from "vitest";
import { type Card, type Suit } from "./deck";
import { type Seat, legalMoves } from "./rules";
import {
  type GameState,
  createGame,
  openerOf,
  reduce,
} from "./state";

const handSizes = (s: GameState) => s.hands.map((h) => h.length);

describe("openerOf / createGame", () => {
  it("opens with game number mod 4", () => {
    expect(openerOf("40")).toBe(0);
    expect(openerOf("41")).toBe(1);
    expect(openerOf("43")).toBe(3);
    expect(openerOf("not-a-number")).toBe(0);
  });

  it("deals a five-card bidding hand to everyone", () => {
    const s = createGame("42");
    expect(s.phase).toBe("bidding");
    expect(handSizes(s)).toEqual([5, 5, 5, 5]);
    expect(s.trump).toBe(null);
    expect(s.taker).toBe(null);
    expect(s.turn).toBe(s.opener);
    expect(s.scores).toEqual([0, 0]);
  });
});

describe("reduce — new and guards", () => {
  it("creates a fresh game for an explicit seed", () => {
    const r = reduce(null, { type: "new", seed: "42" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.seed).toBe("42");
  });

  it("rejects actions when there is no game", () => {
    const r = reduce(null, { type: "take", seat: 0 });
    expect(r).toEqual({ ok: false, error: "no game in progress" });
  });

  it("starts the first game with zero scores", () => {
    const r = reduce(null, { type: "new", seed: "42" });
    expect(r.ok && r.state.scores).toEqual([0, 0]);
  });

  it("carries cumulative scores into a new game", () => {
    const prev = { ...createGame("42"), scores: [120, 42] as [number, number] };
    const r = reduce(prev, { type: "new", seed: "43" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.seed).toBe("43");
    expect(r.state.scores).toEqual([120, 42]); // accumulated, not reset
    expect(r.state.phase).toBe("bidding"); // a fresh hand
  });

  it("clears accumulated scores", () => {
    const playing = { ...createGame("42"), scores: [120, 42] as [number, number] };
    const r = reduce(playing, { type: "clear" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.scores).toEqual([0, 0]);
    expect(r.state.seed).toBe("42"); // same game, only scores reset
  });

  it("rejects clear when there is no game", () => {
    expect(reduce(null, { type: "clear" })).toEqual({
      ok: false,
      error: "no game in progress",
    });
  });
});

describe("reduce — take", () => {
  it("completes the deal, sets trump, and enters playing", () => {
    const bidding = createGame("42");
    const r = reduce(bidding, { type: "take", seat: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("playing");
    expect(handSizes(r.state)).toEqual([8, 8, 8, 8]);
    expect(r.state.taker).toBe(1);
    expect(r.state.trump).toBe(r.state.trumpCard.suit);
    expect(r.state.turn).toBe(r.state.opener); // opener leads
  });

  it("cannot take twice", () => {
    const playing = reduce(createGame("42"), { type: "take", seat: 1 });
    expect(playing.ok).toBe(true);
    if (!playing.ok) return;
    const again = reduce(playing.state, { type: "take", seat: 2 });
    expect(again).toEqual({ ok: false, error: "not in bidding phase" });
  });

  it("does not mutate the input state", () => {
    const bidding = createGame("42");
    const before = JSON.stringify(bidding);
    reduce(bidding, { type: "take", seat: 1 });
    expect(JSON.stringify(bidding)).toBe(before);
  });
});

describe("reduce — play validation", () => {
  // A crafted mid-trick state: spades led, seat 1 to move holding a spade.
  const craftTrick = (): GameState => ({
    ...createGame("42"),
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
    const taken = reduce(createGame("42"), { type: "take", seat: 0 });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;

    const final = playToFinish(taken.state);
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

  it("is deterministic for a given seed and taker", () => {
    const run = () => {
      const taken = reduce(createGame("77"), { type: "take", seat: 3 });
      if (!taken.ok) throw new Error("take failed");
      return playToFinish(taken.state).scores;
    };
    expect(run()).toEqual(run());
  });

  it("rejects play once the hand is finished", () => {
    const taken = reduce(createGame("42"), { type: "take", seat: 0 });
    if (!taken.ok) return;
    const final = playToFinish(taken.state);
    const seat = final.tricks[7].winner;
    const r = reduce(final, {
      type: "play",
      seat,
      card: { suit: "hearts", rank: "7" },
    });
    expect(r.ok).toBe(false);
  });
});
