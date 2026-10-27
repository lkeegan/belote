import { DurableObject } from "cloudflare:workers";
import { type Card } from "./game/deck";
import { type Seat, legalMoves } from "./game/rules";
import type { ClientState } from "../../shared/protocol";
import {
  type Action,
  type GameState,
  type ReduceResult,
  annoncesToReveal,
  isSeat,
  reduce,
  replaceOptions,
} from "./game/state";

/**
 * Derive the view facts the client would otherwise have to re-implement the
 * rules to compute: the current turn's legal moves, the take-back's legal
 * replacements, and a per-seat flag for "holds an annonce to show" — so the
 * frontend never duplicates the legality or annonce-detection rules.
 */
function toClientState(state: GameState): ClientState {
  const playing = state.phase === "playing" && state.trump !== null;
  const legal = playing
    ? legalMoves(state.hands[state.turn], state.currentTrick, state.trump!, state.turn)
    : [];
  // Annonces may only be shown on the second trick (matches annoncesToReveal).
  const canShowAnnonces = state.hands.map((_, seat) =>
    annoncesToReveal(state, seat as Seat).ok,
  );
  const { talon, ...rest } = state; // talon is server-only; never sent
  return { ...rest, legal, replaceLegal: replaceOptions(state), canShowAnnonces };
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
  // The authoritative state, held in memory. This object is the only writer of
  // its one storage key, so the field can serve reads without touching storage;
  // `undefined` means "not yet loaded" (the field is empty after a hibernation
  // eviction), which triggers a single reload.
  private cached: GameState | null | undefined;
  // The in-flight first deal, so several sockets connecting to an empty table
  // converge on one game instead of each racing to start its own.
  private firstDeal?: Promise<GameState>;

  /** The current game state, or null if no game has been started. */
  async getState(): Promise<GameState | null> {
    if (this.cached === undefined) {
      const stored = await this.ctx.storage.get<GameState>(STATE_KEY);
      // Preserve games saved before deal IDs were introduced.
      this.cached = stored ? { ...stored, dealId: stored.dealId ?? 0 } : null;
    }
    return this.cached;
  }

  /**
   * The current game, dealing the first hand if none exists yet. The deal is
   * memoised so concurrent connects to an empty table all get the same first
   * game rather than each dealing one (the `??=` assignment is synchronous, so
   * only the first caller past the null check starts it).
   */
  private async ensureGame(): Promise<GameState> {
    const existing = await this.getState();
    if (existing) return existing;
    this.firstDeal ??= this.apply({ type: "new" }).then(
      (r) => (r.ok ? r.state : (this.cached as GameState)),
    );
    return this.firstDeal;
  }

  /** Apply an action, persisting and returning the next state, or an error. */
  async apply(action: Action): Promise<ReduceResult> {
    const current = await this.getState();
    const result = reduce(current, action);
    if (result.ok) {
      this.cached = result.state;
      await this.ctx.storage.put(STATE_KEY, result.state);
    }
    return result;
  }

  /**
   * Handle a WebSocket upgrade. The top-level worker forwards upgrade requests
   * here after validating the Origin. The socket is accepted via the
   * hibernation API so the runtime may evict this object from memory while
   * connections stay open — idle tables are not billed for duration.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    // Send the current state immediately so the new client renders at once,
    // dealing the first hand if the table is still empty. Dealing here (rather
    // than telling each client to send /new) means several clients connecting at
    // once converge on one deal instead of racing to start several.
    const state = await this.ensureGame();
    server.send(JSON.stringify(toClientState(state)));
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Validate an action from a socket, apply it, and broadcast the new state.
   * Rejections go only to the sender, whose action changed nothing.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let envelope: { path?: unknown; body?: unknown };
    try {
      const text =
        typeof message === "string" ? message : new TextDecoder().decode(message);
      envelope = JSON.parse(text);
      if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope) ||
          typeof envelope.path !== "string") {
        throw new Error("invalid envelope");
      }
    } catch {
      ws.send(JSON.stringify({ error: "invalid message" }));
      return;
    }
    // Showing annonces is an ephemeral table-wide reveal, not a state change:
    // validate against the live state and broadcast the cards to everyone, so
    // every client flashes them full-size for a moment. Nothing is stored, so a
    // player may ask to show them again while the second trick is open.
    if (envelope.path === "/show-annonces") {
      const seat = asSeat((envelope.body as { seat?: unknown })?.seat);
      if (seat === null) {
        ws.send(JSON.stringify({ error: "seat must be 0–3" }));
        return;
      }
      const reveal = annoncesToReveal(await this.getState(), seat);
      if (!reveal.ok) {
        ws.send(JSON.stringify({ error: reveal.error }));
        return;
      }
      this.broadcast({ reveal: { seat, annonces: reveal.annonces } });
      return;
    }

    const parsed = parseAction(envelope.path, envelope.body);
    if ("error" in parsed) {
      ws.send(JSON.stringify({ error: parsed.error }));
      return;
    }
    const result = await this.apply(parsed.action);
    if (!result.ok) {
      ws.send(JSON.stringify({ error: result.error }));
      return;
    }
    this.broadcast(toClientState(result.state as GameState));
  }

  /**
   * A socket closed or errored. There is nothing to clean up — getWebSockets()
   * stops reporting it on its own — but a hibernatable object must define these
   * handlers, or the runtime throws when delivering the event.
   */
  webSocketClose(ws: WebSocket): void {
    ws.close();
  }
  webSocketError(): void {}

  /**
   * Send a payload to every open socket. getWebSockets() reflects the live
   * connections (and survives hibernation), so we keep no list of our own.
   */
  private broadcast(payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      // A socket caught mid-close can throw; don't let it starve the rest.
      try {
        ws.send(text);
      } catch {
        // The runtime drops it from getWebSockets() once the close completes.
      }
    }
  }
}

// The deployed frontend; always allowed to read the worker's responses. The
// site is served from www.keegan.ch; the apex is included in case it is used.
const PROD_ORIGINS = new Set(["https://www.keegan.ch", "https://keegan.ch"]);

// The local Vite dev and preview servers; only allowed when the worker itself
// is running locally (under `wrangler dev`), never in production.
const DEV_ORIGINS = new Set(["http://localhost:5173", "http://localhost:4173"]);

/**
 * Whether a request's Origin is allowed to connect. WebSockets are not subject
 * to CORS — the browser sends an Origin header but does not block on it — so we
 * must enforce the allow-list ourselves before upgrading. localhost origins are
 * accepted only in local development, signalled by ENVIRONMENT=development
 * (set in .dev.vars, which `wrangler dev` loads; the deployed worker uses the
 * "production" value from wrangler.jsonc).
 */
function originAllowed(request: Request, env: Env): boolean {
  const isDev = env.ENVIRONMENT === "development";
  const allowed = isDev ? new Set([...PROD_ORIGINS, ...DEV_ORIGINS]) : PROD_ORIGINS;
  const origin = request.headers.get("Origin");
  return origin !== null && allowed.has(origin);
}

/** A seat index 0–3, if `value` is one. */
function asSeat(value: unknown): Seat | null {
  return isSeat(value) ? value : null;
}

/** Parse a WebSocket action body, or return an error message. */
function parseAction(
  path: string,
  body: unknown,
): { action: Action } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  switch (path) {
    case "/new":
    case "/new-match": {
      if (!Number.isSafeInteger(b.dealId) || (b.dealId as number) < 0)
        return { error: "dealId must be a non-negative integer" };
      return { action: { type: path === "/new" ? "new" : "match", dealId: b.dealId as number } };
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
    case "/undo": {
      const seat = asSeat(b.seat);
      if (seat === null) return { error: "seat must be 0–3" };
      return { action: { type: "undo", seat } };
    }
    case "/play": {
      const p = parseSeatCard(b);
      return "error" in p ? p : { action: { type: "play", ...p } };
    }
    case "/replace": {
      const p = parseSeatCard(b);
      return "error" in p ? p : { action: { type: "replace", ...p } };
    }
    default:
      return { error: "not found" };
  }
}

/** Parse a body carrying a seat and a card, shared by /play and /replace. */
function parseSeatCard(
  b: Record<string, unknown>,
): { seat: 0 | 1 | 2 | 3; card: Card } | { error: string } {
  const seat = asSeat(b.seat);
  if (seat === null) return { error: "seat must be 0–3" };
  const card = b.card as { suit?: unknown; rank?: unknown } | undefined;
  if (!card || typeof card.suit !== "string" || typeof card.rank !== "string")
    return { error: "card must have a suit and rank" };
  return { seat, card: { suit: card.suit as never, rank: card.rank as never } };
}

export default {
  async fetch(request, env): Promise<Response> {
    // The only route: a WebSocket upgrade. Clients open one socket, send
    // actions over it, and receive state broadcasts in return — there is no
    // longer any REST polling. Validate the Origin ourselves (CORS does not
    // apply to WebSockets) and hand the socket to the single game object.
    if (request.headers.get("Upgrade") === "websocket") {
      if (!originAllowed(request, env)) {
        return new Response("forbidden origin", { status: 403 });
      }
      const stub = env.BELOTE_GAME.getByName(GAME_NAME);
      return stub.fetch(request);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
