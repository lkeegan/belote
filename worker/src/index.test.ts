import { SELF, env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { legalMoves } from "./game/rules";
import { type GameState } from "./game/state";

type ClientState = GameState & { legal: unknown[] };
type Message = ClientState | { error: string };

const BASE = "https://belote.test";
// A production origin, which the worker always allows to connect.
const ORIGIN = "https://www.keegan.ch";
// The single global game, as named in the worker (GAME_NAME).
const GAME_NAME = "foo";

// This plugin version does not isolate Durable Object storage between tests, so
// wipe the game before each one and close sockets after, leaving every test a
// fresh, unconnected game object.
const openSockets: WebSocket[] = [];

beforeEach(async () => {
  const stub = env.BELOTE_GAME.getByName(GAME_NAME);
  await runInDurableObject(stub, async (instance, state) => {
    await state.storage.deleteAll();
    // The object caches state in memory; clearing storage out-of-band (as only
    // a test does) would otherwise leave the cache holding the previous game.
    (instance as unknown as { cached: undefined }).cached = undefined;
  });
});

afterEach(() => {
  for (const ws of openSockets.splice(0)) ws.close();
});

/** A test client over the worker's WebSocket: send actions, await broadcasts. */
interface Client {
  /** The next message pushed by the worker (the initial state, or a broadcast). */
  next(): Promise<Message>;
  /** Send an action, exactly as the frontend does. */
  send(path: string, body?: unknown): void;
  close(): void;
}

/** Open a socket to the single game and wrap it as a {@link Client}. */
async function connect(
  origin = ORIGIN,
): Promise<{ status: number; client?: Client; initial?: Message }> {
  const res = await SELF.fetch(BASE, {
    headers: { Upgrade: "websocket", Origin: origin },
  });
  if (!res.webSocket) return { status: res.status };
  const ws = res.webSocket;
  openSockets.push(ws);

  // Buffer messages and hand them out one at a time. Register the listener
  // before accepting so the initial state the worker sends on connect is kept.
  const queue: Message[] = [];
  const waiters: ((m: Message) => void)[] = [];
  ws.addEventListener("message", (e) => {
    const data = JSON.parse(e.data as string) as Message;
    const waiter = waiters.shift();
    if (waiter) waiter(data);
    else queue.push(data);
  });
  ws.accept();

  const client: Client = {
    next: () =>
      new Promise<Message>((resolve, reject) => {
        const queued = queue.shift();
        if (queued) return resolve(queued);
        const timer = setTimeout(() => reject(new Error("no message")), 5000);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      }),
    send: (path, body) => ws.send(JSON.stringify({ path, body })),
    close: () => ws.close(),
  };
  // The worker pushes the current state (or "no game") as soon as it accepts;
  // consume it here so callers see a clean queue and can assert it separately.
  const initial = await client.next();
  return { status: res.status, client, initial };
}

/** Send /new, then take the retourne suit (enter the playing phase). */
async function newAndTake(client: Client): Promise<ClientState> {
  client.send("/new");
  const dealt = (await client.next()) as GameState;
  client.send("/bid", { seat: dealt.opener, suit: dealt.trumpCard.suit });
  return (await client.next()) as ClientState;
}

describe("WebSocket layer", () => {
  it("rejects connections from a disallowed origin", async () => {
    const { status } = await connect("https://evil.example");
    expect(status).toBe(403);
  });

  it("reports no game on connect before one is started", async () => {
    const { initial } = await connect();
    expect(initial).toEqual({ error: "no game in progress" });
  });

  it("deals on /new and persists for a later connection", async () => {
    const { client, initial } = await connect();
    expect(initial).toEqual({ error: "no game in progress" });

    client!.send("/new");
    const state = (await client!.next()) as GameState;
    expect(state.phase).toBe("bidding");
    expect(state.opener).toBe(0); // first deal opens with seat 0

    // A separate connection sees the same persisted game on connect.
    const { initial: fetched } = (await connect()) as { initial: GameState };
    expect(fetched.phase).toBe("bidding");
    expect(fetched.hands.every((h) => h.length === 5)).toBe(true);
  });

  it("broadcasts a move to every connected client", async () => {
    const { client: a } = await connect();
    const taken = await newAndTake(a!);
    expect(taken.phase).toBe("playing");

    // A second client connects and receives the same state on connect.
    const { client: b, initial } = await connect();
    expect(initial as ClientState).toEqual(taken);

    // The opener leads; both clients receive the resulting state.
    const seat = taken.turn;
    const card = taken.hands[seat][0];
    a!.send("/play", { seat, card });
    const fromA = (await a!.next()) as GameState;
    const fromB = (await b!.next()) as GameState;
    expect(fromA.currentTrick).toHaveLength(1);
    expect(fromB).toEqual(fromA);
  });

  it("takes the contract and rejects out-of-turn / illegal moves", async () => {
    const { client } = await connect();
    const taken = await newAndTake(client!);
    expect(taken.phase).toBe("playing");
    expect(taken.hands.every((h) => h.length === 8)).toBe(true);

    // Out of turn (only the opener may lead first): the sender gets an error,
    // and no broadcast — the persisted state is untouched.
    const offSeat = (taken.opener + 1) % 4;
    client!.send("/play", { seat: offSeat, card: taken.hands[offSeat][0] });
    expect(await client!.next()).toEqual({ error: expect.any(String) });

    const { initial } = await connect();
    expect(initial as ClientState).toEqual(taken);
  });

  it("plays a full hand through to a finished score", async () => {
    const { client } = await connect();
    let state: GameState = await newAndTake(client!);
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
      client!.send("/play", { seat, card });
      state = (await client!.next()) as GameState;
    }

    expect(state.phase).toBe("finished");
    expect(state.tricks).toHaveLength(8);
    expect(state.result).toBeDefined();
    expect(state.scores).toEqual(state.result!.handPoints);

    // A new deal keeps the cumulative scores; a new match resets them.
    client!.send("/new");
    const carried = (await client!.next()) as GameState;
    expect(carried.scores).toEqual(state.scores);
    client!.send("/new-match");
    const reset = (await client!.next()) as GameState;
    expect(reset.scores).toEqual([0, 0]);
  });

  it("includes the current turn's legal cards while playing", async () => {
    const { client } = await connect();
    const playing = await newAndTake(client!);
    // The opener leads, so every card in hand is legal.
    expect(playing.legal).toHaveLength(8);

    client!.send("/new");
    const bidding = (await client!.next()) as ClientState;
    expect(bidding.legal).toEqual([]); // no legal moves before a take
  });

  it("deals the next hand (rotating the opener) when everyone passes twice", async () => {
    const { client } = await connect();
    client!.send("/new");
    let s = (await client!.next()) as GameState;
    const firstOpener = s.opener;
    for (let i = 0; i < 8; i++) {
      client!.send("/bid", { seat: s.turn, suit: null });
      s = (await client!.next()) as GameState;
    }
    expect(s.phase).toBe("bidding");
    expect(s.biddingRound).toBe(1);
    expect(s.opener).toBe((firstOpener + 1) % 4);
  });

  it("validates action messages", async () => {
    const { client, initial } = await connect();
    expect(initial).toEqual({ error: "no game in progress" });

    client!.send("/bid", { seat: 9 });
    expect(await client!.next()).toEqual({ error: expect.any(String) });

    client!.send("/nope", {});
    expect(await client!.next()).toEqual({ error: "not found" });
  });
});
