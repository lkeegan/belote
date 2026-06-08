import "./style.css";
import { dealBelote, type Card, type Suit } from "./deck";

const PLAYERS = ["North", "East", "South", "West"];

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

function renderCardBack(): HTMLElement {
  const el = document.createElement("div");
  el.className = "card back";
  el.setAttribute("aria-hidden", "true");
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

function renderTrump(trumpCard: Card): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "hand center";

  const heading = document.createElement("h2");
  heading.textContent = `Proposed trump — ${trumpCard.suit}`;
  wrapper.appendChild(heading);

  const cards = document.createElement("div");
  cards.className = "cards";
  cards.appendChild(renderCard(trumpCard));
  wrapper.appendChild(cards);

  return wrapper;
}

function renderTalon(count: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "hand center";

  const heading = document.createElement("h2");
  heading.textContent = `Talon — ${count} cards`;
  wrapper.appendChild(heading);

  const stack = document.createElement("div");
  stack.className = "cards talon";
  // Show a small fanned stack rather than all 11 backs.
  for (let i = 0; i < Math.min(count, 4); i++) {
    stack.appendChild(renderCardBack());
  }
  wrapper.appendChild(stack);

  return wrapper;
}

function dealAndRender(): void {
  const table = document.querySelector<HTMLElement>("#table");
  if (!table) return;

  const { hands, trumpCard, talon } = dealBelote();
  table.replaceChildren(
    ...PLAYERS.map((player, i) => renderHand(player, hands[i])),
    renderTrump(trumpCard),
    renderTalon(talon.length),
  );
}

document
  .querySelector<HTMLButtonElement>("#deal")
  ?.addEventListener("click", dealAndRender);

dealAndRender();
