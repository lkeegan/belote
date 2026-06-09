import { DurableObject } from "cloudflare:workers";
import { type Card } from "./game/deck";
import { legalMoves } from "./game/rules";
import {
  type Action,
  type GameState,
  type ReduceResult,
  reduce,
} from "./game/state";

/** State as sent to clients: the game plus the current turn's legal cards. */
type ClientState = GameState & { legal: Card[] };

/**
 * Attach the cards the current turn may legally play, derived from the rules
 * engine so the frontend can highlight them without duplicating the rules.
 */
function toClientState(state: GameState): ClientState {
  const legal =
    state.phase === "playing" && state.trump
      ? legalMoves(state.hands[state.turn], state.currentTrick, state.trump, state.turn)
      : [];
  return { ...state, legal };
}

// There is one global Belote game, so every request goes to a single named
// Durable Object instance.
const GAME_NAME = "foo";
const STATE_KEY = "state";

/**
 * The single global Belote game. A thin wrapper around the pure game core: it
 * loads the state from storage, runs an action through `reduce`, persists the
 * result, and reports back. All the rules live in `./game`.
 */
export class BeloteGame extends DurableObject<Env> {
  /** The current game state, or null if no game has been started. */
  async getState(): Promise<GameState | null> {
    return (await this.ctx.storage.get<GameState>(STATE_KEY)) ?? null;
  }

  /** Apply an action, persisting and returning the next state, or an error. */
  async apply(action: Action): Promise<ReduceResult> {
    const current = await this.getState();
    const result = reduce(current, action);
    if (result.ok) await this.ctx.storage.put(STATE_KEY, result.state);
    return result;
  }
}

// The deployed frontend; always allowed to read the worker's responses. The
// site is served from www.keegan.ch; the apex is included in case it is used.
const PROD_ORIGINS = new Set(["https://www.keegan.ch", "https://keegan.ch"]);

// The local Vite dev and preview servers; only allowed when the worker itself
// is running locally (under `wrangler dev`), never in production.
const DEV_ORIGINS = new Set(["http://localhost:5173", "http://localhost:4173"]);

/**
 * CORS headers for a request: reflect the Origin back only when it is allowed,
 * so other sites' browser JS cannot read the response. localhost origins are
 * accepted only in local development, signalled by ENVIRONMENT=development
 * (set in .dev.vars, which `wrangler dev` loads; the deployed worker uses the
 * "production" value from wrangler.jsonc).
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const isDev = env.ENVIRONMENT === "development";
  const allowed = isDev ? new Set([...PROD_ORIGINS, ...DEV_ORIGINS]) : PROD_ORIGINS;
  const origin = request.headers.get("Origin");
  if (origin && allowed.has(origin)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { Vary: "Origin" };
}

/** A seat index 0–3, if `value` is one. */
function asSeat(value: unknown): 0 | 1 | 2 | 3 | null {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : null;
}

/** Parse a POST body into an Action, or return an error message. */
function parseAction(
  path: string,
  body: unknown,
): { action: Action } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  switch (path) {
    case "/new": {
      const seed = b.seed;
      if (seed !== undefined && typeof seed !== "string")
        return { error: "seed must be a string" };
      return { action: { type: "new", seed } };
    }
    case "/bid": {
      const seat = asSeat(b.seat);
      if (seat === null) return { error: "seat must be 0–3" };
      // No suit (or null) is a pass; otherwise it's a take at that suit.
      const suit = b.suit;
      if (suit === undefined || suit === null)
        return { action: { type: "bid", seat, suit: null } };
      if (
        suit !== "hearts" &&
        suit !== "diamonds" &&
        suit !== "clubs" &&
        suit !== "spades"
      )
        return { error: "invalid suit" };
      return { action: { type: "bid", seat, suit } };
    }
    case "/clear":
      return { action: { type: "clear" } };
    case "/play": {
      const seat = asSeat(b.seat);
      if (seat === null) return { error: "seat must be 0–3" };
      const card = b.card as { suit?: unknown; rank?: unknown } | undefined;
      if (!card || typeof card.suit !== "string" || typeof card.rank !== "string")
        return { error: "card must have a suit and rank" };
      return {
        action: {
          type: "play",
          seat,
          card: { suit: card.suit as never, rank: card.rank as never },
        },
      };
    }
    default:
      return { error: "not found" };
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const stub = env.BELOTE_GAME.getByName(GAME_NAME);

    if (request.method === "GET" && url.pathname === "/state") {
      // The Durable Object RPC boundary widens tuple types (e.g. scores) to
      // arrays; the runtime value is unchanged, so cast back to GameState.
      const state = (await stub.getState()) as GameState | null;
      return state
        ? json(toClientState(state))
        : json({ error: "no game in progress" }, 404);
    }

    if (request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const parsed = parseAction(url.pathname, body);
      if ("error" in parsed) {
        return json({ error: parsed.error }, parsed.error === "not found" ? 404 : 400);
      }
      const result = await stub.apply(parsed.action);
      return result.ok
        ? json(toClientState(result.state as GameState))
        : json({ error: result.error }, 400);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
