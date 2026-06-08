import "./style.css";
import { dealBelote, type Card, type Suit } from "./deck";

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

function isRed(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

function renderCard(card: Card): HTMLElement {
  const el = document.createElement("div");
  el.className = `card ${isRed(card.suit) ? "red" : "black"}`;
  el.innerHTML = `
    <span class="corner top">${card.rank}<br />${SUIT_SYMBOL[card.suit]}</span>
    <span class="pip">${SUIT_SYMBOL[card.suit]}</span>
    <span class="corner bottom">${card.rank}<br />${SUIT_SYMBOL[card.suit]}</span>
  `;
  el.setAttribute("aria-label", `${card.rank} of ${card.suit}`);
  return el;
}

function cardRow(cards: Card[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "cards";
  for (const card of cards) {
    row.appendChild(renderCard(card));
  }
  return row;
}

const setup = document.querySelector<HTMLFormElement>("#setup")!;
const result = document.querySelector<HTMLElement>("#result")!;

function showResult(seed: string, seat: number): void {
  const { hands, trumpCard } = dealBelote(seed);

  result.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = `${PLAYERS[seat]} — game ${seed}`;
  result.appendChild(heading);

  const handPanel = document.createElement("div");
  handPanel.className = "hand";
  const handLabel = document.createElement("h3");
  handLabel.textContent = "Your hand";
  handPanel.append(handLabel, cardRow(hands[seat]));
  result.appendChild(handPanel);

  const trumpPanel = document.createElement("div");
  trumpPanel.className = "hand";
  const trumpLabel = document.createElement("h3");
  trumpLabel.textContent = `Proposed trump — ${trumpCard.suit}`;
  trumpPanel.append(trumpLabel, cardRow([trumpCard]));
  result.appendChild(trumpPanel);

  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary";
  back.textContent = "Change seat or game";
  back.addEventListener("click", showSetup);
  result.appendChild(back);

  setup.hidden = true;
  result.hidden = false;
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
  showResult(seed, seat);
});
