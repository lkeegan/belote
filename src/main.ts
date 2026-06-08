import "./style.css";
import { deal, type Card, type Suit } from "./deck";

const PLAYERS = ["North", "East", "South", "West"];
const CARDS_PER_HAND = 5;

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

function renderHand(player: string, hand: Card[]): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "hand";

  const heading = document.createElement("h2");
  heading.textContent = player;
  wrapper.appendChild(heading);

  const cards = document.createElement("div");
  cards.className = "cards";
  for (const card of hand) {
    cards.appendChild(renderCard(card));
  }
  wrapper.appendChild(cards);

  return wrapper;
}

function dealAndRender(): void {
  const table = document.querySelector<HTMLElement>("#table");
  if (!table) return;

  const hands = deal(PLAYERS.length, CARDS_PER_HAND);
  table.replaceChildren(
    ...PLAYERS.map((player, i) => renderHand(player, hands[i])),
  );
}

document.querySelector<HTMLButtonElement>("#deal")?.addEventListener(
  "click",
  dealAndRender,
);

dealAndRender();
