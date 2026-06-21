import { DurableObject } from "cloudflare:workers";
import { type Card } from "./game/deck";
import { legalMoves } from "./game/rules";
import {
  type Action,
  type GameState,
  type ReduceResult,
  annoncesToReveal,
  reduce,
  replaceOptions,
} from "./game/state";

/**
 * State as sent to clients: the game, the current turn's legal cards, and the
 * cards the last player may swap their move for (when a take-back is available).
 */
type ClientState = GameState & { legal: Card[]; replaceLegal: Card[] };

/**
 * Attach the cards the current turn may legally play, derived from the rules
 * engine so the frontend can highlight them without duplicating the rules.
 */
function toClientState(state: GameState): ClientState {
  const legal =
    state.phase === "playing" && state.trump
      ? legalMoves(state.hands[state.turn], state.currentTrick, state.trump, state.turn)
      : [];
  return { ...state, legal, replaceLegal: replaceOptions(state) };
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

  /** The current game state, or null if no game has been started. */
  async getState(): Promise<GameState | null> {
    if (this.cached === undefined) {
      this.cached = (await this.ctx.storage.get<GameState>(STATE_KEY)) ?? null;
    }
    return this.cached;
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

    // Send the current state immediately so the new client renders at once.
    const state = await this.getState();
    server.send(
      JSON.stringify(state ? toClientState(state) : { error: "no game in progress" }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A client sent an action over its socket. Validate it with the same parser
   * the REST endpoints used, apply it, and broadcast the new state to everyone.
   * Rejections go only to the sender, whose action changed nothing.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let envelope: { path?: unknown; body?: unknown };
    try {
      const text =
        typeof message === "string" ? message : new TextDecoder().decode(message);
      envelope = JSON.parse(text);
    } catch {
      ws.send(JSON.stringify({ error: "invalid message" }));
      return;
    }
    // Showing annonces is an ephemeral table-wide reveal, not a state change:
    // validate against the live state and broadcast the cards to everyone, so
    // every client flashes them full-size for a moment. Nothing is stored, so a
    // player may ask to show them again while the second trick is open.
    if (String(envelope.path) === "/show-annonces") {
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

    const parsed = parseAction(String(envelope.path), envelope.body);
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
    for (const ws of this.ctx.getWebSockets()) ws.send(text);
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
    case "/new":
      return { action: { type: "new" } };
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
