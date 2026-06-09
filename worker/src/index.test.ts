import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { legalMoves } from "./game/rules";
import { type GameState } from "./game/state";

type ClientState = GameState & { legal: unknown[] };

const BASE = "https://belote.test";
const get = (path: string) => SELF.fetch(`${BASE}${path}`);
const post = (path: string, body?: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Deal `seed`, then have the opener take the retourne suit (enter playing). */
async function newAndTake(seed: string): Promise<ClientState> {
  const dealt = (await (await post("/new", { seed })).json()) as GameState;
  return (await (
    await post("/bid", { seat: dealt.opener, suit: dealt.trumpCard.suit })
  ).json()) as ClientState;
}

describe("HTTP layer", () => {
  it("reports no game before one is started", async () => {
    const res = await get("/state");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no game in progress" });
  });

  it("deals on POST /new and persists across requests", async () => {
    const created = await post("/new", { seed: "42" });
    expect(created.status).toBe(200);
    const state = (await created.json()) as GameState;
    expect(state.phase).toBe("bidding");
    expect(state.seed).toBe("42");

    // A separate request sees the same persisted game.
    const fetched = (await (await get("/state")).json()) as GameState;
    expect(fetched.seed).toBe("42");
    expect(fetched.phase).toBe("bidding");
  });

  it("takes the contract and rejects out-of-turn / illegal moves", async () => {
    const taken = await newAndTake("42");
    expect(taken.phase).toBe("playing");
    expect(taken.hands.every((h) => h.length === 8)).toBe(true);

    // Out of turn (only the opener may lead first): rejected, state untouched.
    const before = await (await get("/state")).json();
    const offTurn = await post("/play", {
      seat: (taken.opener + 1) % 4,
      card: taken.hands[(taken.opener + 1) % 4][0],
    });
    expect(offTurn.status).toBe(400);
    expect(await (await get("/state")).json()).toEqual(before);
  });

  it("plays a full hand through to a finished score", async () => {
    let state: GameState = await newAndTake("42");
    let guard = 0;
    while (state.phase === "playing") {
      expect(guard++).toBeLessThan(40);
      const seat = state.turn;
      const card = legalMoves(
        state.hands[seat],
        state.currentTrick,
        state.trump!,
        seat,
      )[0];
      state = (await (await post("/play", { seat, card })).json()) as GameState;
    }

    expect(state.phase).toBe("finished");
    expect(state.tricks).toHaveLength(8);
    expect(state.result).toBeDefined();
    expect(state.scores).toEqual(state.result!.handPoints);

    // A new game keeps the cumulative scores; /clear resets them.
    const carried = (await (await post("/new", { seed: "43" })).json()) as GameState;
    expect(carried.scores).toEqual(state.scores);
    const cleared = (await (await post("/clear")).json()) as GameState;
    expect(cleared.scores).toEqual([0, 0]);
  });

  it("includes the current turn's legal cards while playing", async () => {
    const playing = await newAndTake("42");
    // The opener leads, so every card in hand is legal.
    expect(playing.legal).toHaveLength(8);

    const bidding = (await (await post("/new", { seed: "42" })).json()) as ClientState;
    expect(bidding.legal).toEqual([]); // no legal moves before a take
  });

  it("deals the next hand when everyone passes twice", async () => {
    let s = (await (await post("/new", { seed: "42" })).json()) as GameState;
    for (let i = 0; i < 8; i++) {
      s = (await (await post("/bid", { seat: s.turn, suit: null })).json()) as GameState;
    }
    expect(s.phase).toBe("bidding");
    expect(s.biddingRound).toBe(1);
    expect(s.seed).toBe("43");
  });

  it("validates request bodies", async () => {
    const badSeat = await post("/bid", { seat: 9 });
    expect(badSeat.status).toBe(400);
    const unknown = await post("/nope", {});
    expect(unknown.status).toBe(404);
  });
});
