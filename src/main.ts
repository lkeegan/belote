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
const PLAYERS = ["Sebastian", "Maya", "Dadmor", "Liam"];
const CORNERS = ["corner-tl", "corner-tr", "corner-bl", "corner-br"];

const SUIT_SYMBOL: Record<Suit, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

// French card names: Valet, Dame, Roi, As.
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
  el.setAttribute("aria-label", `${label} of ${card.suit}`);
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
const LAST_SEED_KEY = "belote.seed";

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

// --- Rendering --------------------------------------------------------------

function renderQuadrant(
  seat: number,
  hand: Card[],
  trumpSuit: Suit | undefined,
): HTMLElement {
  const q = document.createElement("div");
  q.className = `quadrant ${CORNERS[seat]}${taker === seat ? " taker" : ""}`;

  const head = document.createElement("div");
  head.className = "seat-head";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = PLAYERS[seat];

  const take = document.createElement("button");
  take.type = "button";
  take.className = `take${taker === seat ? " active" : ""}`;
  take.textContent = taker === seat ? "Took" : "Take";
  take.addEventListener("click", (event) => {
    event.stopPropagation();
    setTaker(taker === seat ? null : seat);
  });

  head.append(name, take);

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
    for (let b = 0; b < 3; b++) backs.appendChild(renderBack());
    area.appendChild(backs);
    const hint = document.createElement("span");
    hint.className = "reveal-hint";
    hint.textContent = "tap to reveal";
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
    label.textContent = `Turned up — ${trumpCard.suit}`;
    center.append(label, renderCard(trumpCard, true));
  } else if (trumpSuit !== undefined && taker !== null) {
    const info = document.createElement("p");
    info.className = "trump-info";
    info.innerHTML = `Trump <strong>${SUIT_SYMBOL[trumpSuit]} ${trumpSuit}</strong><br />taken by ${PLAYERS[taker]}`;
    center.appendChild(info);
  }

  return center;
}

function render(): void {
  table.replaceChildren();

  if (!seed) {
    const msg = document.createElement("div");
    msg.className = "empty-msg";
    msg.textContent = "Enter a game number above to deal.";
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

  for (let seat = 0; seat < PLAYERS.length; seat++) {
    table.appendChild(renderQuadrant(seat, hands[seat], trumpSuit));
  }
  table.appendChild(renderCenter(trumpCard, trumpSuit));
}

// --- Wiring -----------------------------------------------------------------

seedInput.addEventListener("input", () => {
  seed = seedInput.value.trim();
  taker = loadTaker(seed);
  revealed = [false, false, false, false];
  try {
    localStorage.setItem(LAST_SEED_KEY, seed);
  } catch {
    /* ignore */
  }
  render();
});

try {
  const last = localStorage.getItem(LAST_SEED_KEY);
  if (last) {
    seedInput.value = last;
    seed = last;
    taker = loadTaker(last);
  }
} catch {
  /* ignore */
}

render();
