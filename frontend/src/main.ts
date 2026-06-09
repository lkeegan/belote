import "./style.css";
import {
  dealBelote,
  completeDeal,
  SUITS,
  RANKS,
  type Card,
  type Rank,
  type Suit,
} from "./deck";

// Players sit in the four corners. Partners are diagonal, so Sebastian
// (top-left) pairs with Liam (bottom-right) and Maya (top-right) with Dadmor
// (bottom-left).
const PLAYERS = ["Sébastian", "Maya", "Dadmor", "Liam"];
const CORNERS = ["corner-tl", "corner-tr", "corner-bl", "corner-br"];

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

function renderCard(card: Card, isTrump = false): HTMLElement {
  const el = document.createElement("div");
  el.className = `card ${isRed(card.suit) ? "red" : "black"}${
    isTrump ? " trump" : ""
  }`;
  const label = RANK_LABEL[card.rank];
  const symbol = SUIT_SYMBOL[card.suit];
  el.innerHTML = `
    <span class="corner-mark top">${label}<br />${symbol}</span>
    <span class="pip">${symbol}</span>
    <span class="corner-mark bottom">${label}<br />${symbol}</span>
  `;
  el.setAttribute("aria-label", `${RANK_NAME[card.rank]} de ${SUIT_NAME[card.suit]}`);
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

// --- State ------------------------------------------------------------------

const seedInput = document.querySelector<HTMLInputElement>("#seed")!;
const table = document.querySelector<HTMLElement>("#table")!;

let seed = "";
let taker: number | null = null;
let revealed = [false, false, false, false];

const takerKey = (s: string) => `belote.taker.${s}`;

function loadTaker(s: string): number | null {
  if (!s) return null;
  try {
    const v = localStorage.getItem(takerKey(s));
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function saveTaker(s: string, t: number | null): void {
  try {
    if (t === null) localStorage.removeItem(takerKey(s));
    else localStorage.setItem(takerKey(s), String(t));
  } catch {
    /* storage unavailable — taker simply won't persist */
  }
}

function setTaker(t: number | null): void {
  taker = t;
  saveTaker(seed, t);
  render();
}

/** Seat that starts the bidding: game number mod 4, so it rotates each game. */
function firstBidder(s: string): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return 0;
  return ((n % PLAYERS.length) + PLAYERS.length) % PLAYERS.length;
}

// Reserve the last two digits as a game-of-day counter, so incrementing within
// a day (Partie suivante) never reaches the next day's default number.
const GAMES_PER_DAY = 100;

/**
 * Default game number for the day, shared by everyone that day. Encoded as
 * ((year - 2026) * 10000 + month * 100 + day) * 100, so 2026-06-08 is 60800,
 * its second game 60801, and tomorrow starts cleanly at 60900.
 */
function todaySeed(): string {
  const d = new Date();
  const dateCode =
    (d.getFullYear() - 2026) * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return String(dateCode * GAMES_PER_DAY);
}

// --- Rendering --------------------------------------------------------------

function renderQuadrant(
  seat: number,
  hand: Card[],
  trumpSuit: Suit | undefined,
  isStarter: boolean,
): HTMLElement {
  const q = document.createElement("div");
  q.className = `quadrant ${CORNERS[seat]}${taker === seat ? " taker" : ""}`;

  const head = document.createElement("div");
  head.className = "seat-head";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = PLAYERS[seat];
  head.appendChild(name);

  if (isStarter) {
    const badge = document.createElement("span");
    badge.className = "starter-badge";
    badge.textContent = "commence";
    head.appendChild(badge);
  }

  const take = document.createElement("button");
  take.type = "button";
  take.className = `take${taker === seat ? " active" : ""}`;
  take.textContent = taker === seat ? "A pris" : "Prend";
  take.addEventListener("click", (event) => {
    event.stopPropagation();
    setTaker(taker === seat ? null : seat);
  });

  head.appendChild(take);

  const area = document.createElement("div");
  area.className = "hand-area";
  if (revealed[seat]) {
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const card of sortHand(hand)) {
      cards.appendChild(renderCard(card, card.suit === trumpSuit));
    }
    area.appendChild(cards);
  } else {
    const backs = document.createElement("div");
    backs.className = "cards backs";
    for (let b = 0; b < hand.length; b++) backs.appendChild(renderBack());
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

function renderCenter(
  trumpCard: Card | undefined,
  trumpSuit: Suit | undefined,
): HTMLElement {
  const center = document.createElement("div");
  center.className = "table-center";

  if (taker === null && trumpCard) {
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `Retourne — ${SUIT_NAME[trumpCard.suit]}`;
    center.append(label, renderCard(trumpCard, true));
  } else if (trumpSuit !== undefined && taker !== null) {
    const info = document.createElement("p");
    info.className = "trump-info";
    info.innerHTML = `${PLAYERS[taker]}<br />a pris à<br />${SUIT_NAME[trumpSuit]}`;
    center.appendChild(info);
  }

  return center;
}

function render(): void {
  table.replaceChildren();

  if (!seed) {
    const msg = document.createElement("div");
    msg.className = "empty-msg";
    msg.textContent = "Entrez un numéro de partie ci-dessus pour distribuer.";
    table.appendChild(msg);
    return;
  }

  let hands: Card[][];
  let trumpCard: Card | undefined;
  let trumpSuit: Suit | undefined;

  if (taker === null) {
    const d = dealBelote(seed);
    hands = d.hands;
    trumpCard = d.trumpCard;
  } else {
    const d = completeDeal(seed, taker);
    hands = d.hands;
    trumpSuit = d.trumpSuit;
  }

  const starter = firstBidder(seed);
  for (let seat = 0; seat < PLAYERS.length; seat++) {
    table.appendChild(
      renderQuadrant(seat, hands[seat], trumpSuit, seat === starter),
    );
  }
  table.appendChild(renderCenter(trumpCard, trumpSuit));
}

// --- Wiring -----------------------------------------------------------------

/** Switch to a game number, updating the input and reloading per-game state. */
function setSeed(newSeed: string): void {
  seed = newSeed;
  seedInput.value = newSeed;
  taker = loadTaker(newSeed);
  revealed = [false, false, false, false];
  render();
}

// Typing in the field shouldn't overwrite the input's own value mid-edit.
seedInput.addEventListener("input", () => {
  seed = seedInput.value.trim();
  taker = loadTaker(seed);
  revealed = [false, false, false, false];
  render();
});

const nextGame = document.querySelector<HTMLButtonElement>("#next-game")!;
nextGame.addEventListener("click", () => {
  setSeed(String((parseInt(seed, 10) || 0) + 1));
});

// Default to today's date (YYYYMMDD) so everyone playing that day starts from
// the same number, but it differs day to day.
setSeed(todaySeed());

// --- Worker greeting --------------------------------------------------------

// Base URL of the Cloudflare Worker. Defaults to the local `wrangler dev`
// server; set VITE_WORKER_URL at build time to point at the deployed worker.
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";

async function showWorkerGreeting(): Promise<void> {
  const el = document.querySelector<HTMLElement>("#worker-msg");
  if (!el) return;
  try {
    const res = await fetch(WORKER_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    el.textContent = await res.text();
  } catch {
    el.textContent = "worker hors ligne";
  }
}

showWorkerGreeting();
