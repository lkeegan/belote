import "./style.css";
import { SUITS, RANKS, type Card, type Rank, type Suit } from "./deck";

// Players sit in the four corners, numbered in go-around play order to match
// the worker's seats: 0 → 1 → 2 → 3 → 0 around the table. Partners sit
// opposite, so the teams are {0, 2} (Sébastian + Liam) and {1, 3}
// (Maya + Dadmor). The corner classes place each seat at its physical corner.
const PLAYERS = ["Sébastian", "Maya", "Liam", "Dadmor"];
const CORNERS = ["corner-tl", "corner-tr", "corner-br", "corner-bl"];

const SUIT_SYMBOL: Record<Suit, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

// French suit names.
const SUIT_NAME: Record<Suit, string> = {
  hearts: "cœur",
  diamonds: "carreau",
  clubs: "trèfle",
  spades: "pique",
};

// French card faces: Valet, Dame, Roi, As.
const RANK_LABEL: Record<Rank, string> = {
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "V",
  Q: "D",
  K: "R",
  A: "A",
};

// French rank names for accessibility labels.
const RANK_NAME: Record<Rank, string> = {
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "valet",
  Q: "dame",
  K: "roi",
  A: "as",
};

function isRed(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

const cardKey = (c: Card) => `${c.rank}${c.suit}`;

interface CardOptions {
  trump?: boolean;
  playable?: boolean;
  illegal?: boolean;
  onPlay?: () => void;
}

function renderCard(card: Card, opts: CardOptions = {}): HTMLElement {
  const el = document.createElement("div");
  el.className = [
    "card",
    isRed(card.suit) ? "red" : "black",
    opts.trump ? "trump" : "",
    opts.playable ? "playable" : "",
    opts.illegal ? "illegal" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const label = RANK_LABEL[card.rank];
  const symbol = SUIT_SYMBOL[card.suit];
  el.innerHTML = `
    <span class="corner-mark top">${label}<br />${symbol}</span>
    <span class="pip">${symbol}</span>
    <span class="corner-mark bottom">${label}<br />${symbol}</span>
  `;
  el.setAttribute(
    "aria-label",
    `${RANK_NAME[card.rank]} de ${SUIT_NAME[card.suit]}`,
  );
  if (opts.playable && opts.onPlay) {
    el.addEventListener("click", (event) => {
      event.stopPropagation(); // don't toggle the quadrant's reveal
      opts.onPlay!();
    });
  }
  return el;
}

function renderBack(): HTMLElement {
  const el = document.createElement("div");
  el.className = "card back";
  el.setAttribute("aria-hidden", "true");
  return el;
}

/** Sort a hand by suit, then by rank within each suit, for tidy display. */
function sortHand(cards: Card[]): Card[] {
  return cards
    .slice()
    .sort(
      (a, b) =>
        SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) ||
        RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank),
    );
}

// --- Worker state -----------------------------------------------------------

type Seat = 0 | 1 | 2 | 3;
type Phase = "bidding" | "playing" | "finished";

interface TrickPlay {
  seat: Seat;
  card: Card;
}
interface HandResult {
  handPoints: [number, number];
  madeContract: boolean;
  capot: boolean;
  beloteTeam: 0 | 1 | null;
}
interface GameState {
  phase: Phase;
  opener: Seat;
  hands: Card[][];
  trumpCard: Card;
  trump: Suit | null;
  taker: Seat | null;
  turn: Seat;
  biddingRound: 1 | 2;
  passes: number;
  currentTrick: TrickPlay[];
  tricks: { winner: Seat; cards: TrickPlay[] }[];
  scores: [number, number];
  result?: HandResult;
  legal: Card[];
}

// Base URL of the Cloudflare Worker. Defaults to the local `wrangler dev`
// server; set VITE_WORKER_URL at build time to point at the deployed worker.
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";
// The same endpoint over the WebSocket scheme (http→ws, https→wss).
const WS_URL = WORKER_URL.replace(/^http/, "ws");

// The single live socket to the worker. Actions are sent over it; state
// arrives as broadcasts pushed by the worker, so there is no polling.
let socket: WebSocket | null = null;
// Delay before the next reconnect attempt. It doubles on each failure (up to a
// cap) so a redeploy or network blip doesn't turn into a tight reconnect loop —
// each attempt is a billed worker request — and resets once a connection opens.
const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;
let reconnectDelay = RECONNECT_MIN;

/** Open the socket and keep it open, reconnecting if it drops. */
function connect(): void {
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    offline = false;
    reconnectDelay = RECONNECT_MIN;
    renderStatus();
  });

  socket.addEventListener("message", (ev) => {
    const data = JSON.parse(ev.data as string);
    if (data && typeof data === "object" && "error" in data) {
      // No game yet → deal the first hand. Action rejections (e.g. an illegal
      // move) need no handling: every client already holds authoritative state.
      if (data.error === "no game in progress") send("/new", undefined);
      return;
    }
    state = data as GameState;
    offline = false;
    render();
  });

  socket.addEventListener("close", () => {
    offline = true;
    renderStatus();
    // Reconnect with backoff; the worker pushes fresh state once it opens.
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
  });

  socket.addEventListener("error", () => socket?.close());
}

/** Fire an action. The resulting state arrives as a broadcast, not a reply. */
function send(path: string, body: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ path, body }));
  } else {
    offline = true;
    renderStatus();
  }
}

// This tab plays for a single seat, chosen up front. The choice is held only
// in memory, so it must be made afresh whenever the page is opened or
// refreshed — letting several tabs each play a different seat. Only the chosen
// seat's hand is shown; the others stay covered.
function setMySeat(seat: Seat | null): void {
  mySeat = seat;
  render();
}

let state: GameState | null = null;
let mySeat: Seat | null = null;
let offline = false;
// Played-card keys shown last render, so only freshly played cards animate in
// (render rebuilds the DOM on every poll).
let lastPlayed = new Set<string>();

// --- Actions ----------------------------------------------------------------

/** Deal a fresh hand, confirming first if one is already under way. */
function newGame(): void {
  if (state && state.phase !== "finished") {
    if (!window.confirm("Une partie est en cours. Distribuer une nouvelle donne ?"))
      return;
  }
  send("/new", undefined);
}

// A bid: pass (suit null) or take at a suit.
const bid = (seat: Seat, suit: Suit | null) => send("/bid", { seat, suit });
const play = (seat: Seat, card: Card) => send("/play", { seat, card });

/** Reset the cumulative scores (kept across games on the worker). */
function clearScores(): void {
  if (!state) return;
  if (window.confirm("Effacer les scores cumulés ?")) send("/clear", undefined);
}

// --- Rendering --------------------------------------------------------------

const table = document.querySelector<HTMLElement>("#table")!;
const scoreboard = document.querySelector<HTMLElement>("#scoreboard")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clear-scores")!;
const changeSeat = document.querySelector<HTMLButtonElement>("#change-seat")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const titleEl = document.querySelector<HTMLElement>("#title")!;
const workerMsg = document.querySelector<HTMLElement>("#worker-msg")!;

/**
 * The cards to show on the table: the trick in progress, or — while it's empty
 * between tricks — the trick just completed, so a finished trick lingers on the
 * table until the winner leads the next card.
 */
function shownTrick(s: GameState): TrickPlay[] {
  if (s.currentTrick.length > 0) return s.currentTrick;
  if (s.phase !== "bidding" && s.tricks.length > 0)
    return s.tricks[s.tricks.length - 1].cards;
  return [];
}

function renderQuadrant(seat: Seat, s: GameState): HTMLElement {
  const mine = seat === mySeat;
  const bidding = s.phase === "bidding";
  const q = document.createElement("div");
  const classes = ["quadrant", CORNERS[seat]];
  if (mine) classes.push("mine");
  if (s.taker === seat) classes.push("taker");
  if ((s.phase === "playing" || bidding) && s.turn === seat) classes.push("turn");
  q.className = classes.join(" ");

  const head = document.createElement("div");
  head.className = "seat-head";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = mine ? `${PLAYERS[seat]} (vous)` : PLAYERS[seat];
  head.appendChild(name);

  if (bidding && s.opener === seat) {
    const badge = document.createElement("span");
    badge.className = "starter-badge";
    badge.textContent = "commence";
    head.appendChild(badge);
  }

  // Seats earlier in the order than the current bidder have passed this round.
  if (bidding && ((seat - s.opener + 4) % 4) < s.passes) {
    const tag = document.createElement("span");
    tag.className = "pass-tag";
    tag.textContent = "passe";
    head.appendChild(tag);
  } else if (!bidding && s.taker === seat) {
    const tag = document.createElement("span");
    tag.className = "take active";
    tag.textContent = "A pris";
    head.appendChild(tag);
  }

  const area = document.createElement("div");
  area.className = "hand-area";

  const isTurn = s.phase === "playing" && s.turn === seat;
  const legalKeys = new Set(s.legal.map(cardKey));

  if (mine) {
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const card of sortHand(s.hands[seat])) {
      const playable = isTurn && legalKeys.has(cardKey(card));
      const illegal = isTurn && !legalKeys.has(cardKey(card));
      cards.appendChild(
        renderCard(card, {
          trump: card.suit === s.trump,
          playable,
          illegal,
          onPlay: () => void play(seat, card),
        }),
      );
    }
    area.appendChild(cards);
  } else {
    const backs = document.createElement("div");
    backs.className = "cards backs";
    for (let b = 0; b < s.hands[seat].length; b++) backs.appendChild(renderBack());
    area.appendChild(backs);
  }

  q.append(head, area);

  // The card this seat has played to the current trick, shown full-size in the
  // quadrant's inner corner (nearest the table centre) so it's clear who played
  // what.
  const played = shownTrick(s).find((p) => p.seat === seat)?.card;
  if (played) {
    const pc = renderCard(played, { trump: played.suit === s.trump });
    pc.classList.add("played");
    // Animate only when this card is newly played (not on every poll redraw).
    if (!lastPlayed.has(cardKey(played))) pc.classList.add("deal-in");
    q.appendChild(pc);
  }

  // Your bid controls, shown only on your turn during bidding.
  if (bidding && mine && s.turn === seat) {
    q.appendChild(renderBidControls(s, seat));
  }
  return q;
}

/** Pass / take buttons for the seat currently bidding. */
function renderBidControls(s: GameState, seat: Seat): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "bid-controls";

  const passBtn = document.createElement("button");
  passBtn.type = "button";
  passBtn.className = "bid pass";
  passBtn.textContent = s.biddingRound === 1 ? "Non" : "Deux";
  passBtn.addEventListener("click", () => void bid(seat, null));
  wrap.appendChild(passBtn);

  // Round 1 takes the retourne suit; round 2 names one of the other three.
  const takeSuits =
    s.biddingRound === 1
      ? [s.trumpCard.suit]
      : SUITS.filter((suit) => suit !== s.trumpCard.suit);
  for (const suit of takeSuits) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `bid take-suit ${isRed(suit) ? "red" : "black"}`;
    btn.innerHTML = `Prend <span class="suit">${SUIT_SYMBOL[suit]}</span>`;
    btn.addEventListener("click", () => void bid(seat, suit));
    wrap.appendChild(btn);
  }
  return wrap;
}

/** The initial "who are you?" screen: one button per seat. */
function renderSeatSelect(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "seat-select";

  const prompt = document.createElement("p");
  prompt.className = "seat-select-prompt";
  prompt.textContent = "Qui êtes-vous ?";
  wrap.appendChild(prompt);

  const buttons = document.createElement("div");
  buttons.className = "seat-buttons";
  // Lay the buttons out like the players around the table: TL, TR, BL, BR,
  // which in go-around seat order is 0, 1, 3, 2.
  for (const seat of [0, 1, 3, 2] as Seat[]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `seat-pick ${seat % 2 === 0 ? "gold" : "blue"}`;
    btn.textContent = PLAYERS[seat];
    btn.addEventListener("click", () => setMySeat(seat));
    buttons.appendChild(btn);
  }
  wrap.appendChild(buttons);
  return wrap;
}

/** The turned-up card, shown in the middle of the table during bidding. */
function renderRetourne(s: GameState): HTMLElement {
  const card = renderCard(s.trumpCard, { trump: true });
  card.classList.add("retourne");
  return card;
}

/** A coloured suit symbol for the title-bar status line. */
function suitHtml(suit: Suit): string {
  return `<span class="suit ${isRed(suit) ? "red" : "black"}">${SUIT_SYMBOL[suit]}</span>`;
}

/** Phase-appropriate status text, shown in the title bar. */
function renderHeaderStatus(s: GameState | null): void {
  if (!s) {
    statusEl.innerHTML = "";
    return;
  }
  if (s.phase === "bidding") {
    const round = s.biddingRound === 1 ? "1er" : "2e";
    statusEl.innerHTML = `Retourne ${suitHtml(s.trumpCard.suit)} · ${round} tour · à ${PLAYERS[s.turn]} de parler`;
  } else if (s.phase === "playing" && s.trump !== null && s.taker !== null) {
    statusEl.innerHTML = `Atout ${suitHtml(s.trump)} · ${PLAYERS[s.taker]} a pris · à ${PLAYERS[s.turn]} de jouer`;
  } else if (s.phase === "finished" && s.result) {
    const r = s.result;
    const head = r.capot
      ? "Capot !"
      : r.madeContract
        ? "Contrat réussi"
        : "Chute (dedans)";
    const belote = r.beloteTeam !== null ? " · Belote" : "";
    statusEl.innerHTML = `${head} · preneur ${PLAYERS[s.taker!]} · ${r.handPoints[0]}–${r.handPoints[1]}${belote}`;
  } else {
    statusEl.innerHTML = "";
  }
}

function renderScoreboard(s: GameState | null): void {
  clearBtn.hidden = !s;
  if (!s) {
    scoreboard.textContent = "";
    return;
  }
  scoreboard.innerHTML =
    `<span class="team gold">Séb·Liam ${s.scores[0]}</span>` +
    `<span class="sep">—</span>` +
    `<span class="team blue">Maya·Dadmor ${s.scores[1]}</span>`;
}

function renderStatus(): void {
  workerMsg.textContent = offline ? "worker hors ligne" : "";
}

function renderChangeSeat(): void {
  changeSeat.hidden = mySeat === null;
}

function renderTitle(): void {
  titleEl.textContent =
    mySeat === null ? "Belote" : `Belote :: ${PLAYERS[mySeat]}`;
}

function render(): void {
  renderStatus();
  renderTitle();
  renderScoreboard(state);
  renderChangeSeat();
  renderHeaderStatus(mySeat === null ? null : state);
  table.replaceChildren();

  // Choose a seat before anything else; this device plays only for it.
  if (mySeat === null) {
    lastPlayed = new Set();
    table.appendChild(renderSeatSelect());
    return;
  }

  if (!state) {
    lastPlayed = new Set();
    const msg = document.createElement("div");
    msg.className = "empty-msg";
    msg.textContent = offline
      ? "Worker hors ligne — nouvelle tentative…"
      : "Aucune partie. Touchez « Nouvelle donne » pour distribuer.";
    table.appendChild(msg);
    return;
  }

  for (let seat = 0; seat < PLAYERS.length; seat++) {
    table.appendChild(renderQuadrant(seat as Seat, state));
  }
  // The turned-up card sits in the middle only while bidding; once play starts
  // the centre is left clear and played cards appear in each quadrant's corner.
  if (state.phase === "bidding") table.appendChild(renderRetourne(state));

  // Remember which cards are on the table so they don't re-animate next redraw.
  lastPlayed = new Set(shownTrick(state).map((p) => cardKey(p.card)));
}

// --- Wiring -----------------------------------------------------------------

clearBtn.addEventListener("click", clearScores);
changeSeat.addEventListener("click", () => setMySeat(null));

const nextGame = document.querySelector<HTMLButtonElement>("#next-game")!;
nextGame.addEventListener("click", () => newGame());

// Open the socket. On connect the worker pushes the current game (or signals
// none, prompting the first deal), and every later move arrives as a broadcast.
connect();
