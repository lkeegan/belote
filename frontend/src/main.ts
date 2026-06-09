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
  mini?: boolean;
  onPlay?: () => void;
}

function renderCard(card: Card, opts: CardOptions = {}): HTMLElement {
  const el = document.createElement("div");
  el.className = [
    "card",
    isRed(card.suit) ? "red" : "black",
    opts.trump ? "trump" : "",
    opts.mini ? "mini" : "",
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
  seed: string;
  opener: Seat;
  hands: Card[][];
  trumpCard: Card;
  trump: Suit | null;
  taker: Seat | null;
  turn: Seat;
  currentTrick: TrickPlay[];
  tricks: { winner: Seat; cards: TrickPlay[] }[];
  scores: [number, number];
  result?: HandResult;
  legal: Card[];
}

// Base URL of the Cloudflare Worker. Defaults to the local `wrangler dev`
// server; set VITE_WORKER_URL at build time to point at the deployed worker.
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";

/** Call the worker. Returns the game state, or null when no game exists. */
async function api(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<GameState | null> {
  const res = await fetch(WORKER_URL + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as GameState;
}

// Reserve the last two digits as a game-of-day counter, matching the worker's
// default so the field shows a familiar number.
const GAMES_PER_DAY = 100;

/** Default game number for the day, shared by everyone that day. */
function todaySeed(): string {
  const d = new Date();
  const dateCode =
    (d.getFullYear() - 2026) * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return String(dateCode * GAMES_PER_DAY);
}

let state: GameState | null = null;
let revealed = [false, false, false, false];
let renderedSeed: string | null = null;
let busy = false; // an action is in flight; pause polling
let offline = false;

// --- Actions ----------------------------------------------------------------

/** Fetch the current game and re-render (skipped while an action is running). */
async function refresh(): Promise<void> {
  if (busy) return;
  try {
    state = await api("/state");
    offline = false;
    render();
  } catch {
    offline = true;
    renderStatus();
  }
}

/** Run an action against the worker, adopting the returned state. */
async function act(
  path: string,
  body: unknown,
  onError?: (message: string) => void,
): Promise<void> {
  busy = true;
  try {
    const next = await api(path, "POST", body);
    offline = false;
    if (next) state = next;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("HTTP")) offline = true;
    onError?.(e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
    render();
  }
}

/** Deal a fresh game, confirming first if one is already under way. */
function newGame(seed: string): void {
  if (state && state.phase !== "finished") {
    const ok = window.confirm(
      `Une partie est en cours (n° ${state.seed}). La remplacer par la n° ${seed} ?`,
    );
    if (!ok) {
      seedInput.value = state.seed; // revert the field
      return;
    }
  }
  void act("/new", { seed });
}

const take = (seat: Seat) => act("/take", { seat });
const play = (seat: Seat, card: Card) =>
  act("/play", { seat, card }, () => void refresh());

// --- Rendering --------------------------------------------------------------

const seedInput = document.querySelector<HTMLInputElement>("#seed")!;
const table = document.querySelector<HTMLElement>("#table")!;
const scoreboard = document.querySelector<HTMLElement>("#scoreboard")!;
const workerMsg = document.querySelector<HTMLElement>("#worker-msg")!;

function renderQuadrant(seat: Seat, s: GameState): HTMLElement {
  const q = document.createElement("div");
  const classes = ["quadrant", CORNERS[seat]];
  if (s.taker === seat) classes.push("taker");
  if (s.phase === "playing" && s.turn === seat) classes.push("turn");
  q.className = classes.join(" ");

  const head = document.createElement("div");
  head.className = "seat-head";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = PLAYERS[seat];
  head.appendChild(name);

  if (s.phase === "bidding" && s.opener === seat) {
    const badge = document.createElement("span");
    badge.className = "starter-badge";
    badge.textContent = "commence";
    head.appendChild(badge);
  }

  // The "Prend" button only appears during bidding; afterwards the gold ring
  // marks the taker.
  if (s.phase === "bidding") {
    const takeBtn = document.createElement("button");
    takeBtn.type = "button";
    takeBtn.className = "take";
    takeBtn.textContent = "Prend";
    takeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void take(seat);
    });
    head.appendChild(takeBtn);
  } else if (s.taker === seat) {
    const tag = document.createElement("span");
    tag.className = "take active";
    tag.textContent = "A pris";
    head.appendChild(tag);
  }

  const area = document.createElement("div");
  area.className = "hand-area";

  const isTurn = s.phase === "playing" && s.turn === seat;
  const legalKeys = new Set(s.legal.map(cardKey));

  if (revealed[seat]) {
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
    const hint = document.createElement("span");
    hint.className = "reveal-hint";
    hint.textContent = "toucher pour voir";
    area.appendChild(hint);
  }

  q.append(head, area);
  q.addEventListener("click", () => {
    revealed[seat] = !revealed[seat];
    render();
  });
  return q;
}

function renderCenter(s: GameState): HTMLElement {
  const center = document.createElement("div");
  center.className = `table-center ${s.phase}`;

  if (s.phase === "bidding") {
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `Retourne — ${SUIT_NAME[s.trumpCard.suit]}`;
    center.append(label, renderCard(s.trumpCard, { trump: true }));
    return center;
  }

  // playing / finished: trump line, current trick, and turn or result.
  if (s.trump !== null && s.taker !== null) {
    const info = document.createElement("p");
    info.className = "trump-info";
    info.innerHTML = `Atout ${SUIT_SYMBOL[s.trump]}<br />${PLAYERS[s.taker]} a pris`;
    center.appendChild(info);
  }

  if (s.currentTrick.length > 0) {
    const trick = document.createElement("div");
    trick.className = "trick";
    for (const { card } of s.currentTrick) {
      trick.appendChild(renderCard(card, { mini: true, trump: card.suit === s.trump }));
    }
    center.appendChild(trick);
  }

  if (s.phase === "playing") {
    const turn = document.createElement("span");
    turn.className = "label";
    turn.textContent = `Au tour de ${PLAYERS[s.turn]}`;
    center.appendChild(turn);
  } else if (s.result) {
    center.appendChild(renderResult(s.result, s.taker!));
  }

  return center;
}

function renderResult(r: HandResult, taker: Seat): HTMLElement {
  const box = document.createElement("div");
  box.className = "result";
  const head = r.capot
    ? "Capot !"
    : r.madeContract
      ? "Contrat réussi"
      : "Chute (dedans)";
  const lines = [
    head,
    `Preneur : ${PLAYERS[taker]}`,
    `${r.handPoints[0]} – ${r.handPoints[1]}`,
  ];
  if (r.beloteTeam !== null) lines.push("Belote-rebelote +20");
  box.innerHTML = lines.map((l) => `<span>${l}</span>`).join("");
  return box;
}

function renderScoreboard(s: GameState | null): void {
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

function render(): void {
  renderStatus();
  renderScoreboard(state);
  table.replaceChildren();

  if (!state) {
    const msg = document.createElement("div");
    msg.className = "empty-msg";
    msg.textContent = offline
      ? "Worker hors ligne — nouvelle tentative…"
      : "Aucune partie. Entrez un numéro pour distribuer.";
    table.appendChild(msg);
    return;
  }

  // Reset reveals when the game changes; keep the active hand open during play.
  if (state.seed !== renderedSeed) {
    revealed = [false, false, false, false];
    renderedSeed = state.seed;
  }
  if (state.phase === "playing") revealed[state.turn] = true;

  if (seedInput.value !== state.seed) seedInput.value = state.seed;

  for (let seat = 0; seat < PLAYERS.length; seat++) {
    table.appendChild(renderQuadrant(seat as Seat, state));
  }
  table.appendChild(renderCenter(state));
}

// --- Wiring -----------------------------------------------------------------

// Commit the seed only when the field is left or Enter is pressed, not on every
// keystroke, so typing a number doesn't repeatedly re-deal.
seedInput.addEventListener("change", () => {
  const value = seedInput.value.trim();
  if (value) newGame(value);
});

const nextGame = document.querySelector<HTMLButtonElement>("#next-game")!;
nextGame.addEventListener("click", () => {
  const current = state ? parseInt(state.seed, 10) : parseInt(seedInput.value, 10);
  newGame(String((current || 0) + 1));
});

/** On load, adopt the worker's current game, or deal today's if there is none. */
async function init(): Promise<void> {
  try {
    state = await api("/state");
    offline = false;
    if (!state) await act("/new", { seed: todaySeed() });
    else render();
  } catch {
    offline = true;
    render();
  }
}

void init();
// Poll for other players' moves.
setInterval(() => void refresh(), 2000);
