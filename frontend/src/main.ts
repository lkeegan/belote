import "./style.css";
import { SUITS, RANKS, type Card, type Rank, type Suit } from "./deck";
import { clearEffect, playResultEffect } from "./effects";
import { derTeamOf, roundTotals } from "./result";

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

// A sequence is named by its top card with the correctly contracted article:
// "au roi", "à la dame", "à l'as" (à + le → au, à + la, à + l').
const RANK_A: Record<Rank, string> = {
  "7": "au 7",
  "8": "au 8",
  "9": "au 9",
  "10": "au 10",
  J: "au valet",
  Q: "à la dame",
  K: "au roi",
  A: "à l'as",
};

// A carré is named by its rank in the plural: "de valets", "de rois", "d'as".
const RANK_PLURAL: Record<Rank, string> = {
  "7": "de 7",
  "8": "de 8",
  "9": "de 9",
  "10": "de 10",
  J: "de valets",
  Q: "de dames",
  K: "de rois",
  A: "d'as",
};

function isRed(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

const cardKey = (c: Card) => `${c.rank}${c.suit}`;

interface CardOptions {
  trump?: boolean;
  playable?: boolean;
  illegal?: boolean;
  /** Click to queue this card as a pre-move (before it's your turn). */
  premoveable?: boolean;
  /** This card is the currently queued pre-move. */
  premoved?: boolean;
  onPlay?: () => void;
  /** Click to take the card back (the topmost card of the current trick). */
  onUndo?: () => void;
}

function renderCard(card: Card, opts: CardOptions = {}): HTMLElement {
  const el = document.createElement("div");
  el.className = [
    "card",
    isRed(card.suit) ? "red" : "black",
    opts.trump ? "trump" : "",
    opts.playable ? "playable" : "",
    opts.illegal ? "illegal" : "",
    opts.premoveable ? "premoveable" : "",
    opts.premoved ? "premoved" : "",
    opts.onUndo ? "takeback" : "",
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
  if ((opts.playable || opts.premoveable) && opts.onPlay) {
    el.addEventListener("click", (event) => {
      event.stopPropagation(); // don't toggle the quadrant's reveal
      opts.onPlay!();
    });
  } else if (opts.onUndo) {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      opts.onUndo!();
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
// The suits of each colour, in a stable canonical order.
const RED_SUITS = SUITS.filter(isRed);
const BLACK_SUITS = SUITS.filter((s) => !isRed(s));

/**
 * The order to lay a hand's suits out so that, where possible, no two
 * neighbouring suits share a colour: interleave the reds and blacks the hand
 * holds, starting with the larger colour group so the smaller one slots between
 * it. Same-colour neighbours remain only when one colour outnumbers the other
 * by more than one (e.g. a hand of two red suits and no black).
 */
function suitOrder(cards: Card[]): Suit[] {
  const present = (group: readonly Suit[]) =>
    group.filter((s) => cards.some((c) => c.suit === s));
  const reds = present(RED_SUITS);
  const blacks = present(BLACK_SUITS);
  const [first, second] =
    reds.length >= blacks.length ? [reds, blacks] : [blacks, reds];
  const order: Suit[] = [];
  for (let i = 0; i < first.length; i++) {
    order.push(first[i]);
    if (i < second.length) order.push(second[i]);
  }
  return order;
}

function sortHand(cards: Card[]): Card[] {
  const order = suitOrder(cards);
  return cards
    .slice()
    .sort(
      (a, b) =>
        order.indexOf(a.suit) - order.indexOf(b.suit) ||
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
type AnnonceKind = "tierce" | "cinquante" | "cent" | "carre";
interface Annonce {
  team: 0 | 1;
  kind: AnnonceKind;
  rank: Rank;
  suit?: Suit;
  points: number;
  /** The cards making up the declaration, in display order (low→high run). */
  cards: Card[];
}
interface HandResult {
  handPoints: [number, number];
  cardPoints: [number, number];
  madeContract: boolean;
  capot: boolean;
  beloteTeam: 0 | 1 | null;
  annonceTeam: 0 | 1 | null;
  annoncePoints: number;
  annonces: Annonce[];
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
  /** Cards the last player may swap their played card for (empty if none). */
  replaceLegal: Card[];
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
    if (data && typeof data === "object" && "reveal" in data) {
      // A player asked to show their annonces: flash them across the table.
      showReveal(data.reveal as { seat: Seat; annonces: Annonce[] });
      return;
    }
    const prev = state;
    state = data as GameState;
    offline = false;
    syncPremove(); // play a queued pre-move if it's now this seat's turn
    syncSummary(); // hold the summary box back briefly after the last card
    if (sweepNeeded(prev)) startSweep(); // gather the finished trick to its winner
    else handleDeal(); // animate a fresh deal, else render normally
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
  premove = null; // a queued pre-move belongs to the seat that set it
  if (seat === null) {
    cancelTableAnim(); // leaving the table; stop any deal in progress
    render();
    return;
  }
  // Picking a seat on a freshly dealt hand starts the deal animation.
  handleDeal();
}

let state: GameState | null = null;
let mySeat: Seat | null = null;
let offline = false;
// A card queued to play as soon as it's this seat's turn (a pre-move). Cleared
// once played, or if it stops being a legal/held card by the time the turn comes.
let premove: Card | null = null;
// Played-card keys shown last render, so only freshly played cards animate in
// (render rebuilds the DOM on every poll).
let lastPlayed = new Set<string>();
// The summary box waits a moment after the last card so the final trick stays
// on the table before the cards vanish and the box appears. `summaryRevealed`
// flips true once that pause elapses; the timer guards against arming twice.
const SUMMARY_DELAY_MS = 3000;
let summaryRevealed = false;
let summaryTimer: number | null = null;

// --- Deal animation ---------------------------------------------------------
// On a fresh deal the cards fly out one at a time from the table centre before
// bidding begins (see runDeal): first three to each seat, then two, then the
// turned-up card to the middle. These track the in-flight animation so a new
// deal, a seat change, or the game moving on can cancel it cleanly.
let dealing = false;
// Bumped to invalidate a running deal; runDeal aborts once its token is stale.
let dealToken = 0;
// Signature of the deal we've already animated, so each fresh deal animates once.
let animatedDealSig: string | null = null;
// Where each seat's cards landed during the deal (viewport coords, in deal
// order), so the real hand can settle in from those spots — and the player's
// cards turn over there — when the deal hands off to the live view.
let dealtSpots: { x: number; y: number }[][] = [[], [], [], []];
const DEAL_START_PAUSE_MS = 3000; // empty table before the first card
const DEAL_CARD_MS = 280; // flight time of one card
const DEAL_GAP_MS = 90; // gap between successive cards
const DEAL_MID_PAUSE_MS = 3000; // after all 5×4 cards, before the retourne

// When the winner leads the next trick, the completed trick's four cards first
// sweep across to that winner before the new card appears. These guard that
// brief animation the way the deal's do.
let sweeping = false;
let sweepToken = 0;
const SWEEP_MS = 420; // time for the gathered trick to reach the winner

// A player asking to show their annonces flashes the cards full-size across the
// whole table for a moment, hiding every hand, then everything reverts. The
// reveal is transient (not part of game state), so it can be requested again.
let reveal: { seat: Seat; annonces: Annonce[] } | null = null;
let revealTimer: number | null = null;
const REVEAL_MS = 3000;

/** Whether the round-summary box (and the hidden final trick) is now showing. */
function summaryShown(): boolean {
  return state?.phase === "finished" && summaryRevealed;
}

/**
 * Arm or reset the post-hand pause. On reaching "finished" the box is held back
 * for SUMMARY_DELAY_MS; any earlier phase clears the flag and pending timer so
 * the next hand starts clean.
 */
function syncSummary(): void {
  if (state?.phase === "finished") {
    if (!summaryRevealed && summaryTimer === null) {
      summaryTimer = window.setTimeout(() => {
        summaryTimer = null;
        summaryRevealed = true;
        // Match the effect to the outcome as the box appears.
        if (state?.result) playResultEffect(state.result);
        render();
      }, SUMMARY_DELAY_MS);
    }
  } else {
    summaryRevealed = false;
    clearEffect(); // stop any weather once the next hand starts
    if (summaryTimer !== null) {
      clearTimeout(summaryTimer);
      summaryTimer = null;
    }
  }
}

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
const undo = (seat: Seat) => send("/undo", { seat });
const replace = (seat: Seat, card: Card) => send("/replace", { seat, card });
// Reveal this seat's annonces to the whole table (on the second trick).
const showAnnonces = (seat: Seat) => send("/show-annonces", { seat });

/** Queue (or, if already queued, cancel) a card as a pre-move. */
function togglePremove(card: Card): void {
  premove = premove && cardKey(premove) === cardKey(card) ? null : card;
  render();
}

/**
 * Reconcile the queued pre-move against fresh state: drop it if it's no longer
 * a held card (a new hand, or it was taken back), and — once it's this seat's
 * turn — play it if still legal, otherwise drop it so the seat can choose.
 */
function syncPremove(): void {
  if (premove === null) return;
  if (mySeat === null || !state || state.phase !== "playing") {
    premove = null;
    return;
  }
  const held = state.hands[mySeat].some((c) => cardKey(c) === cardKey(premove!));
  if (!held) {
    premove = null;
    return;
  }
  if (state.turn === mySeat) {
    const card = premove;
    const legal = state.legal.some((c) => cardKey(c) === cardKey(card));
    premove = null;
    if (legal) play(mySeat, card);
  }
}

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

/**
 * The last card played that is still on top of the table — the one a player may
 * take back. It's the final card of the trick on show, whether that trick is in
 * progress or has just completed and not yet been led away from.
 */
function topPlay(s: GameState): TrickPlay | undefined {
  const trick = shownTrick(s);
  return trick[trick.length - 1];
}

/** A seat's header row: the player's name, with "(vous)" for your own seat. */
function renderSeatHead(seat: Seat): HTMLElement {
  const head = document.createElement("div");
  head.className = "seat-head";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = seat === mySeat ? `${PLAYERS[seat]} (vous)` : PLAYERS[seat];
  head.appendChild(name);
  return head;
}

/** One declaration drawn as its actual cards (a run reads low→high, a carré
 *  shows its four suits), labelled for accessibility. */
function renderAnnonceGroup(a: Annonce, trump: Suit | null): HTMLElement {
  const group = document.createElement("div");
  group.className = "annonce-group";
  group.setAttribute("aria-label", annonceLabel(a));
  for (const card of a.cards) {
    group.appendChild(renderCard(card, { trump: card.suit === trump }));
  }
  return group;
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

  const head = renderSeatHead(seat);

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
  // You own the topmost card on the table while no one has covered it, so it can
  // still be taken back. When it is not your turn, clicking another legal card
  // then swaps your played card for it.
  const top = topPlay(s);
  const iOwnTop = mine && s.phase === "playing" && top?.seat === seat;
  const canSwap = iOwnTop && !isTurn;
  const interactive = isTurn || canSwap;
  // Your turn highlights the legal plays; a pending swap highlights the legal
  // replacements for the card already on the table.
  const legalKeys = new Set((isTurn ? s.legal : s.replaceLegal).map(cardKey));

  // When it's not your turn (and there's no card to swap), you may queue a
  // pre-move: pick a card now and it plays automatically once your turn comes.
  const canPremove = mine && s.phase === "playing" && !interactive;

  if (mine) {
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const card of sortHand(s.hands[seat])) {
      const playable = interactive && legalKeys.has(cardKey(card));
      const illegal = interactive && !legalKeys.has(cardKey(card));
      const premoved = canPremove && premove !== null && cardKey(premove) === cardKey(card);
      cards.appendChild(
        renderCard(card, {
          trump: card.suit === s.trump,
          playable,
          illegal,
          premoveable: canPremove,
          premoved,
          onPlay: () => {
            if (isTurn) play(seat, card);
            else if (canSwap) replace(seat, card);
            else togglePremove(card);
          },
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

  q.append(head);
  q.append(area);

  // The card this seat has played to the current trick, shown full-size in the
  // quadrant's inner corner (nearest the table centre) so it's clear who played
  // what.
  // Once the summary box takes the centre (after a brief pause on the final
  // trick) the last four cards are hidden rather than left in the corners.
  const played = summaryShown()
    ? undefined
    : shownTrick(s).find((p) => p.seat === seat)?.card;
  if (played) {
    // Clicking your own card takes the move back entirely while it is still on
    // top — no one has covered it. (Covers a trick's fourth card too, which
    // lingers until the winner leads; the hand's forced final card is excluded
    // because the game is then finished, not playing.)
    const pc = renderCard(played, {
      trump: played.suit === s.trump,
      onUndo: iOwnTop ? () => void undo(seat) : undefined,
    });
    pc.classList.add("played");
    // Animate only when this card is newly played (not on every poll redraw).
    if (!lastPlayed.has(cardKey(played))) pc.classList.add("deal-in");
    q.appendChild(pc);
  }

  // Your bid controls, shown only on your turn during bidding (and not while
  // the deal is still being dealt out).
  if (bidding && mine && s.turn === seat && !dealing) {
    q.appendChild(renderBidControls(s, seat));
  }

  // During the second trick a player may flash their annonces to the whole
  // table, as often as asked, as long as they actually hold a declaration.
  if (
    mine &&
    s.phase === "playing" &&
    s.tricks.length === 1 &&
    detectAnnonces(s.hands[seat], seat).length > 0
  ) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "show-annonces";
    btn.textContent = "Montrer les annonces";
    btn.addEventListener("click", () => showAnnonces(seat));
    q.appendChild(btn);
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

/**
 * The round-summary box, shown in the middle of the table once the hand is
 * finished: a result heading, the points each team made this hand, the trump,
 * and each column's round total (the sum of its rows) at the bottom.
 */
function renderResultBox(s: GameState): HTMLElement {
  const r = s.result!;
  const heading = r.capot
    ? "Capot !"
    : r.madeContract
      ? "Contrat réussi"
      : "Dedans";
  // Dix de der (10 for the last trick) goes to whoever won the final trick.
  const derTeam = derTeamOf(s.tricks);
  // A cell showing `pts` only in the column of the team that earned it.
  const cell = (team: 0 | 1 | null, col: 0 | 1, pts: number) =>
    team === col ? `${pts}` : "—";
  // Column total for this round: the sum of every row shown above it.
  const totals = roundTotals(r, derTeam);

  const box = document.createElement("div");
  box.className = "result-box";
  box.innerHTML = `
    <div class="result-heading">${heading}</div>
    <div class="result-sub">preneur ${PLAYERS[s.taker!]}</div>
    <div class="result-grid">
      <span></span>
      <span class="gold">${TEAM_NAME[0]}</span>
      <span class="blue">${TEAM_NAME[1]}</span>

      <span class="rlabel">Points faits</span>
      <span>${r.cardPoints[0]}</span>
      <span>${r.cardPoints[1]}</span>

      <span class="rlabel">Annonces</span>
      <span>${cell(r.annonceTeam, 0, r.annoncePoints)}</span>
      <span>${cell(r.annonceTeam, 1, r.annoncePoints)}</span>

      <span class="rlabel">Dix de der</span>
      <span>${cell(derTeam, 0, 10)}</span>
      <span>${cell(derTeam, 1, 10)}</span>

      <span class="rlabel">Belote</span>
      <span>${cell(r.beloteTeam, 0, 20)}</span>
      <span>${cell(r.beloteTeam, 1, 20)}</span>

      <span class="rlabel total">Total</span>
      <span class="total">${totals[0]}</span>
      <span class="total">${totals[1]}</span>
    </div>
  `;

  // A "Nouvelle donne" button at the bottom both deals the next hand and, in
  // doing so, dismisses the box.
  const next = document.createElement("button");
  next.type = "button";
  next.className = "result-next";
  next.textContent = "Nouvelle donne";
  next.addEventListener("click", () => newGame());
  box.appendChild(next);

  return box;
}

/** A coloured suit symbol for the title-bar status line. */
function suitHtml(suit: Suit): string {
  return `<span class="suit ${isRed(suit) ? "red" : "black"}">${SUIT_SYMBOL[suit]}</span>`;
}

const TEAM_NAME = ["Séb·Liam", "Maya·Dadmor"];
// Carré (four of a kind) values; 7s and 8s don't count toward an annonce.
const CARRE_POINTS: Partial<Record<Rank, number>> = {
  J: 200,
  "9": 150,
  A: 100,
  K: 100,
  Q: 100,
  "10": 100,
};

/** Sequence value by length: tierce 20, cinquante 50, cent (5+) 100. */
function sequencePoints(length: number): number {
  if (length >= 5) return 100;
  if (length === 4) return 50;
  if (length === 3) return 20;
  return 0;
}

/**
 * The annonces in one hand: carrés (four of a counting rank) and the maximal
 * runs of three or more consecutive cards in a suit. Mirrors the worker's
 * scorer, just enough for the client to know when to offer "Montrer". The
 * authoritative award is still the worker's at the end of the hand.
 */
function detectAnnonces(hand: Card[], seat: Seat): Annonce[] {
  const team = (seat % 2) as 0 | 1;
  const found: Annonce[] = [];

  const counts = new Map<Rank, number>();
  for (const card of hand) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  for (const [rank, count] of counts) {
    const points = CARRE_POINTS[rank];
    if (count === 4 && points) {
      const cards = hand
        .filter((c) => c.rank === rank)
        .sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
      found.push({ team, kind: "carre", rank, points, cards });
    }
  }

  for (const suit of SUITS) {
    const suitCards = hand
      .filter((c) => c.suit === suit)
      .sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
    let start = 0;
    for (let i = 1; i <= suitCards.length; i++) {
      const consecutive =
        i < suitCards.length &&
        RANKS.indexOf(suitCards[i].rank) === RANKS.indexOf(suitCards[i - 1].rank) + 1;
      if (!consecutive) {
        const run = suitCards.slice(start, i);
        if (run.length >= 3) {
          found.push({
            team,
            kind: run.length >= 5 ? "cent" : run.length === 4 ? "cinquante" : "tierce",
            rank: run[run.length - 1].rank,
            suit,
            points: sequencePoints(run.length),
            cards: run,
          });
        }
        start = i;
      }
    }
  }

  return found;
}

const ANNONCE_NAME: Record<AnnonceKind, string> = {
  tierce: "Tierce",
  cinquante: "Cinquante",
  cent: "Cent",
  carre: "Carré",
};

/** One annonce as text: "Carré de valets" or "Tierce au roi ♠". */
function annonceHtml(a: Annonce): string {
  if (a.kind === "carre") return `Carré ${RANK_PLURAL[a.rank]}`;
  const suit = a.suit ? ` ${suitHtml(a.suit)}` : "";
  return `${ANNONCE_NAME[a.kind]} ${RANK_A[a.rank]}${suit}`;
}

/** A plain-text accessibility label for a revealed annonce. */
function annonceLabel(a: Annonce): string {
  if (a.kind === "carre") return `Carré ${RANK_PLURAL[a.rank]}`;
  const suit = a.suit ? ` de ${SUIT_NAME[a.suit]}` : "";
  return `${ANNONCE_NAME[a.kind]} ${RANK_A[a.rank]}${suit}`;
}

/** The annonces clause for the finished-hand line, or "" if there were none. */
function annoncesHtml(r: HandResult): string {
  if (r.annonceTeam === null || r.annonces.length === 0) return "";
  const list = r.annonces.map(annonceHtml).join(", ");
  return ` · ${TEAM_NAME[r.annonceTeam]} : ${list} (${r.annoncePoints})`;
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
    statusEl.innerHTML = `${head} · preneur ${PLAYERS[s.taker!]} · ${r.handPoints[0]}–${r.handPoints[1]}${belote}${annoncesHtml(r)}`;
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
  const title = mySeat === null ? "Belote" : `Belote :: ${PLAYERS[mySeat]}`;
  titleEl.textContent = title;
  // Mirror it in the document title so the browser tab names the seat too.
  document.title = title;
}

function render(): void {
  renderStatus();
  renderTitle();
  renderScoreboard(state);
  renderChangeSeat();
  renderHeaderStatus(mySeat === null ? null : state);

  // While a deal is dealt out, or a finished trick is sweeping to its winner,
  // the animation owns the table — leave its DOM untouched so an incoming
  // broadcast doesn't wipe the cards mid-flight.
  if (dealing || sweeping) return;

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

  // A reveal flashes one seat's annonces full-size and hides every hand, so it
  // takes over the whole table until its timer reverts it.
  if (reveal) {
    for (let seat = 0; seat < PLAYERS.length; seat++) {
      table.appendChild(renderRevealQuadrant(seat as Seat, reveal));
    }
    return;
  }

  for (let seat = 0; seat < PLAYERS.length; seat++) {
    table.appendChild(renderQuadrant(seat as Seat, state));
  }
  // The turned-up card sits in the middle only while bidding; once play starts
  // the centre is left clear and played cards appear in each quadrant's corner.
  if (state.phase === "bidding") table.appendChild(renderRetourne(state));
  // Once the hand is over, the centre shows the round-summary box instead —
  // after a brief pause that leaves the final trick on show (see syncSummary).
  if (summaryShown() && state.result)
    table.appendChild(renderResultBox(state));

  // Remember which cards are on the table so they don't re-animate next redraw.
  lastPlayed = new Set(shownTrick(state).map((p) => cardKey(p.card)));
}

// --- Deal animation ---------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * A signature that is stable across one deal's whole bidding (bids don't change
 * the hands or the turned-up card) but differs for the next deal, so each fresh
 * deal animates exactly once. Null outside bidding.
 */
function dealSignature(s: GameState | null): string | null {
  // The opener rotates every deal and the turned-up card is fixed for the whole
  // of a deal's bidding, so this is stable within one deal yet differs for the
  // next — without hashing all four hands.
  if (!s || s.phase !== "bidding") return null;
  return `${s.opener}|${cardKey(s.trumpCard)}`;
}

/**
 * Decide what to do with freshly arrived (or seat-changed) state: animate a
 * brand-new deal, let a running deal animation continue, or — once the game has
 * moved on — tear any animation down and render normally.
 */
function handleDeal(): void {
  const sig = dealSignature(state);
  if (sig && sig !== animatedDealSig && mySeat !== null) {
    animatedDealSig = sig;
    startDeal(state!);
    return;
  }
  // The deal we're animating is still the current one (e.g. another seat bid):
  // let the animation run on, ignoring the update.
  if (dealing && sig === animatedDealSig) return;
  if (dealing) cancelTableAnim();
  render();
}

/** Begin (or restart) the deal animation, unless motion is reduced. */
function startDeal(s: GameState): void {
  cancelTableAnim();
  if (prefersReducedMotion()) {
    render();
    return;
  }
  const token = ++dealToken;
  dealing = true;
  void runDeal(s, token);
}

/** Abort any running table animation (deal, trick-sweep, or annonce reveal) and
 *  clear its in-flight cards and timers. */
function cancelTableAnim(): void {
  dealToken++;
  sweepToken++;
  dealing = false;
  sweeping = false;
  reveal = null;
  if (revealTimer !== null) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
  table.querySelectorAll(".dealing-card").forEach((el) => el.remove());
}

/** The empty table shown during the deal: quadrants with headers but no cards. */
function renderDealSkeleton(s: GameState): void {
  table.replaceChildren();
  const empty: GameState = { ...s, hands: [[], [], [], []] };
  for (let seat = 0; seat < PLAYERS.length; seat++) {
    table.appendChild(renderQuadrant(seat as Seat, empty));
  }
}

/**
 * Run the deal: pause on an empty table, fly three cards to each seat then two
 * (one at a time from the centre), pause once everyone holds five, then turn
 * the trump card up in the middle. Aborts at any await if its token goes stale.
 */
async function runDeal(s: GameState, token: number): Promise<void> {
  const alive = () => token === dealToken;
  dealtSpots = [[], [], [], []];
  renderDealSkeleton(s);
  await sleep(DEAL_START_PAUSE_MS);
  if (!alive()) return;

  // Packets of three then two, dealt seat by seat — starting with the opener
  // (who holds the "commence" badge and plays first) and going clockwise.
  const order: Seat[] = [];
  for (const packet of [3, 2]) {
    for (let i = 0; i < PLAYERS.length; i++) {
      const seat = ((s.opener + i) % PLAYERS.length) as Seat;
      for (let c = 0; c < packet; c++) order.push(seat);
    }
  }
  const dealt: [number, number, number, number] = [0, 0, 0, 0];
  for (const seat of order) {
    if (!alive()) return;
    flyCard(seat, dealt[seat]++);
    await sleep(DEAL_CARD_MS + DEAL_GAP_MS);
  }
  if (!alive()) return;

  await sleep(DEAL_MID_PAUSE_MS);
  if (!alive()) return;
  flyRetourne(s);
  await sleep(DEAL_CARD_MS + 200);
  if (!alive()) return;

  dealing = false;
  render(); // hand off to the real, fully-dealt view
  settleHands(); // slide each card from where it was dealt, turning yours over
}

/**
 * Animate the freshly rendered hands in from where the deal left the cards: each
 * card starts at its dealt spot and eases to its place in the hand, and your own
 * cards turn over (a flip reveal) as they arrive. Runs right after render so the
 * cards never paint at their final spots first.
 */
function settleHands(): void {
  for (let seat = 0; seat < PLAYERS.length; seat++) {
    const q = quadrantEl(seat as Seat);
    if (!q) continue;
    const spots = dealtSpots[seat] ?? [];
    const cards = q.querySelectorAll<HTMLElement>(".cards .card");
    cards.forEach((el, i) => {
      const from = spots[i] ?? spots[spots.length - 1];
      if (!from) return;
      const c = rectCentre(el);
      el.style.setProperty("--dx", `${from.x - c.x}px`);
      el.style.setProperty("--dy", `${from.y - c.y}px`);
      el.classList.add("deal-settle");
      if (seat === mySeat) el.classList.add("reveal"); // your cards turn over
    });
  }
}

/**
 * Whether to sweep a finished trick to its winner: the previous state showed a
 * completed trick sitting on the table (no card led yet) and the new state has
 * just led the next trick's first card. The same completed trick is still the
 * last one in `tricks`, so its count is unchanged.
 */
function sweepNeeded(prev: GameState | null): boolean {
  return (
    !!prev &&
    !!state &&
    state.phase === "playing" &&
    prev.currentTrick.length === 0 &&
    prev.tricks.length > 0 &&
    state.currentTrick.length >= 1 &&
    state.tricks.length === prev.tricks.length
  );
}

/**
 * Gather the just-finished trick's four cards across to the player who won it,
 * then hand off to the real view so the newly led card appears. The cards from
 * the previous render are still on the table; animate those in place.
 */
function startSweep(): void {
  const winner = state!.tricks[state!.tricks.length - 1].winner;
  const cards = Array.from(table.querySelectorAll<HTMLElement>(".played"));
  if (prefersReducedMotion() || cards.length === 0) {
    render();
    return;
  }
  cancelTableAnim(); // never run a sweep and a deal at once
  const token = ++sweepToken;
  sweeping = true;

  const target = rectCentre(quadrantEl(winner)!);
  cards.forEach((el, i) => {
    const c = rectCentre(el);
    el.classList.remove("deal-in"); // its play-in is done; don't fight the sweep
    el.classList.add("sweeping");
    el.style.setProperty("--swx", `${target.x - c.x}px`);
    el.style.setProperty("--swy", `${target.y - c.y}px`);
    el.style.setProperty("--swr", `${(i - 1.5) * 8}deg`);
  });

  window.setTimeout(() => {
    if (token !== sweepToken) return;
    sweeping = false;
    render(); // now the newly led card appears
  }, SWEEP_MS);
}

/**
 * Flash a seat's annonces full-size across the whole table for REVEAL_MS, hiding
 * every hand, then revert. The reveal is transient, so a later request simply
 * replaces it (its timer reset). Only seated clients show it.
 */
function showReveal(r: { seat: Seat; annonces: Annonce[] }): void {
  if (mySeat === null) return;
  cancelTableAnim(); // clear any deal/sweep/reveal so this reveal owns the table
  reveal = r;
  render();
  revealTimer = window.setTimeout(() => {
    revealTimer = null;
    reveal = null;
    render(); // everything reverts to as it was before the button was pressed
  }, REVEAL_MS);
}

/** One quadrant during a reveal: the seat's name, and — for the revealing seat
 *  — its annonce cards full-size. Every hand is hidden. */
function renderRevealQuadrant(seat: Seat, r: { seat: Seat; annonces: Annonce[] }): HTMLElement {
  const q = document.createElement("div");
  q.className = ["quadrant", CORNERS[seat], seat === mySeat ? "mine" : ""]
    .filter(Boolean)
    .join(" ");
  q.appendChild(renderSeatHead(seat));

  if (seat === r.seat) {
    const wrap = document.createElement("div");
    wrap.className = "reveal-annonces";
    for (const a of r.annonces) wrap.appendChild(renderAnnonceGroup(a, state?.trump ?? null));
    q.appendChild(wrap);
  }
  return q;
}

/** The centre of an element's bounding box, in viewport coordinates. */
function rectCentre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

/** The DOM element for a seat's quadrant, if it is on the table. */
function quadrantEl(seat: Seat): HTMLElement | null {
  return table.querySelector<HTMLElement>("." + CORNERS[seat]);
}

/** Fly one face-down card from the centre to its place in `seat`'s hand. */
function flyCard(seat: Seat, k: number): void {
  const el = renderBack();
  el.classList.add("dealing-card");
  table.appendChild(el);
  const cw = el.offsetWidth;
  const ch = el.offsetHeight;
  const tableRect = table.getBoundingClientRect();
  const qr = quadrantEl(seat)!.getBoundingClientRect();
  // Land near the seat's centre, fanned out by card index so five cards spread
  // like a hand rather than stacking on one spot.
  const tx = (qr.left + qr.right) / 2 - tableRect.left + (k - 2) * cw * 0.28;
  const ty = (qr.top + qr.bottom) / 2 - tableRect.top;
  // Remember where this card lands so the real hand can settle in from here.
  dealtSpots[seat][k] = { x: tableRect.left + tx, y: tableRect.top + ty };
  const c = { x: tableRect.width / 2, y: tableRect.height / 2 };
  el.style.left = `${tx - cw / 2}px`;
  el.style.top = `${ty - ch / 2}px`;
  // Start stacked at the table centre, then ease out to the dealt spot. Both
  // transforms list the same functions so the path interpolates cleanly, and a
  // double rAF commits the centred start before it animates (a single reflow can
  // be skipped, leaving the card to just appear in place).
  el.style.transform = `translate(${c.x - tx}px, ${c.y - ty}px) rotate(0deg) scale(0.82)`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.style.transform = `translate(0px, 0px) rotate(${(k - 2) * 7}deg) scale(1)`;
    }),
  );
}

/** Turn the trump card up in the middle, the last step of the deal. */
function flyRetourne(s: GameState): void {
  const el = renderCard(s.trumpCard, { trump: true });
  el.classList.add("dealing-card", "retourne-deal");
  table.appendChild(el);
  const cw = el.offsetWidth;
  const ch = el.offsetHeight;
  const tableRect = table.getBoundingClientRect();
  const c = { x: tableRect.width / 2, y: tableRect.height / 2 };
  el.style.left = `${c.x - cw / 2}px`;
  el.style.top = `${c.y - ch / 2}px`;
  el.style.opacity = "0";
  el.style.transform = "translateY(-28px) scale(0.6)";
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "none";
    }),
  );
}

// --- Wiring -----------------------------------------------------------------

clearBtn.addEventListener("click", clearScores);
changeSeat.addEventListener("click", () => setMySeat(null));

const nextGame = document.querySelector<HTMLButtonElement>("#next-game")!;
nextGame.addEventListener("click", () => newGame());

// Open the socket. On connect the worker pushes the current game (or signals
// none, prompting the first deal), and every later move arrives as a broadcast.
connect();
