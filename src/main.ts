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

// Seats are laid out in a 2x2 grid, so indices 0/3 share one diagonal and 1/2
// the other. Sebastian (0) and Liam (3) are therefore diagonally opposite
// partners, as are Maya (1) and Dadmor (2).
const PLAYERS = ["Sebastian", "Maya", "Dadmor", "Liam"];

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
    <span class="corner top">${label}<br />${symbol}</span>
    <span class="pip">${symbol}</span>
    <span class="corner bottom">${label}<br />${symbol}</span>
  `;
  el.setAttribute("aria-label", `${label} of ${card.suit}`);
  return el;
}

function cardRow(cards: Card[], trumpSuit?: Suit): HTMLElement {
  const row = document.createElement("div");
  row.className = "cards";
  for (const card of cards) {
    row.appendChild(renderCard(card, card.suit === trumpSuit));
  }
  return row;
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

function panel(title: string, body: HTMLElement): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "hand";
  const heading = document.createElement("h3");
  heading.textContent = title;
  wrapper.append(heading, body);
  return wrapper;
}

const setup = document.querySelector<HTMLFormElement>("#setup")!;
const result = document.querySelector<HTMLElement>("#result")!;

function backButton(): HTMLButtonElement {
  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary";
  back.textContent = "Change seat or game";
  back.addEventListener("click", showSetup);
  return back;
}

/** Phase 1: opening five-card deal, plus controls to record the bidding. */
function showOpening(seed: string, seat: number): void {
  const { hands, trumpCard } = dealBelote(seed);
  result.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = `${PLAYERS[seat]} — game ${seed}`;
  result.appendChild(heading);

  result.appendChild(panel("Your hand", cardRow(hands[seat])));
  result.appendChild(
    panel(`Turned up — ${trumpCard.suit}`, cardRow([trumpCard])),
  );

  const bidding = document.createElement("div");
  bidding.className = "bidding";
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent =
    "Once everyone has bid in person, record who took the turned card to deal the rest.";
  bidding.appendChild(note);

  const buttons = document.createElement("div");
  buttons.className = "bids";
  for (let taker = 0; taker < PLAYERS.length; taker++) {
    const btn = document.createElement("button");
    btn.type = "button";
    if (taker === seat) {
      btn.textContent = "I take";
    } else {
      btn.className = "secondary";
      btn.textContent = `${PLAYERS[taker]} took`;
    }
    btn.addEventListener("click", () => showFinal(seed, seat, taker));
    buttons.appendChild(btn);
  }
  bidding.appendChild(buttons);

  const passed = document.createElement("button");
  passed.type = "button";
  passed.className = "secondary passed";
  passed.textContent = "All four passed";
  passed.addEventListener("click", () => showPassed(seed, seat));
  bidding.appendChild(passed);

  result.appendChild(panel("After bidding", bidding));
  result.appendChild(backButton());

  setup.hidden = true;
  result.hidden = false;
}

/** Phase 2: the completed eight-card hand once a taker is recorded. */
function showFinal(seed: string, seat: number, takerSeat: number): void {
  const { hands, trumpSuit } = completeDeal(seed, takerSeat);
  result.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = `${PLAYERS[seat]} — game ${seed}`;
  result.appendChild(heading);

  const info = document.createElement("p");
  info.className = "trump-info";
  const takerName =
    takerSeat === seat ? "you" : PLAYERS[takerSeat];
  info.innerHTML = `Trump: <strong>${SUIT_SYMBOL[trumpSuit]} ${trumpSuit}</strong> — taken by ${takerName}`;
  result.appendChild(info);

  result.appendChild(
    panel("Your hand (8 cards)", cardRow(sortHand(hands[seat]), trumpSuit)),
  );

  const redo = document.createElement("button");
  redo.type = "button";
  redo.className = "secondary";
  redo.textContent = "Back to bidding";
  redo.addEventListener("click", () => showOpening(seed, seat));
  result.append(redo, backButton());
}

/** All four passed: nothing more to deal — agree a new number and redeal. */
function showPassed(seed: string, seat: number): void {
  result.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = `${PLAYERS[seat]} — game ${seed}`;
  result.appendChild(heading);

  const msg = document.createElement("p");
  msg.className = "hint";
  msg.textContent =
    "All four players passed, so this hand is dead. Agree a new game number and deal again.";
  result.appendChild(msg);

  const redo = document.createElement("button");
  redo.type = "button";
  redo.className = "secondary";
  redo.textContent = "Back to bidding";
  redo.addEventListener("click", () => showOpening(seed, seat));
  result.append(redo, backButton());
}

function showSetup(): void {
  result.hidden = true;
  setup.hidden = false;
}

setup.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(setup);
  const seed = String(data.get("seed") ?? "").trim();
  const seat = Number(data.get("seat"));
  if (!seed || Number.isNaN(seat)) return;
  showOpening(seed, seat);
});
