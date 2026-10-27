import "./style.css";
import { SUITS, RANKS, type Card, type Rank, type Suit } from "./deck";
import { clearEffect, playResultEffect } from "./effects";
import { derTeamOf, roundTotals } from "./result";
import type { Seat, TrickPlay, Annonce, AnnonceKind, HandResult } from "../../shared/game";
import type { ActionBodies, ClientState as GameState } from "../../shared/protocol";
import { GameConnection } from "./connection";
import { createTableAnimations } from "./animations";
import { renderWithFocus } from "./focus";
import { VoiceBidding, type VoiceTurn } from "./voice/bidding";

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
const sameCard = (a: Card, b: Card) => cardKey(a) === cardKey(b);
const includesCard = (cards: Card[], card: Card) =>
  cards.some((c) => sameCard(c, card));

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
  const interactive = Boolean(((opts.playable || opts.premoveable) && opts.onPlay) || opts.onUndo);
  const el = document.createElement(interactive ? "button" : "div");
  if (el instanceof HTMLButtonElement) {
    el.type = "button";
    el.dataset.focusKey = `card-${cardKey(card)}`;
    if (opts.premoveable) el.setAttribute("aria-pressed", String(Boolean(opts.premoved)));
  }
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
    `${opts.onUndo ? "Reprendre " : opts.premoveable ? "Préjouer " : opts.playable ? "Jouer " : ""}${RANK_NAME[card.rank]} de ${SUIT_NAME[card.suit]}`,
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

// Base URL of the Cloudflare Worker. Defaults to the local `wrangler dev`
// server; set VITE_WORKER_URL at build time to point at the deployed worker.
const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";
// The same endpoint over the WebSocket scheme (http→ws, https→wss).
const WS_URL = WORKER_URL.replace(/^http/, "ws");

/** Fire an action; authoritative state arrives through the connection. */
function send<P extends keyof ActionBodies>(path: P, body: ActionBodies[P]): void {
  connection.send(path, body);
}

// This tab plays for a single seat, chosen up front. The choice is held only
// in memory, so it must be made afresh whenever the page is opened or
// refreshed — letting several tabs each play a different seat. Only the chosen
// seat's hand is shown; the others stay covered.
function setMySeat(seat: Seat | null): void {
  mySeat = seat;
  premove = null; // a queued pre-move belongs to the seat that set it
  if (seat === null) {
    animations.cancel(); // leaving the table; stop any deal in progress
    render();
    return;
  }
  // Picking a seat on a freshly dealt hand starts the deal animation.
  animations.handleDeal();
}

let state: GameState | null = null;
let mySeat: Seat | null = null;
let offline = false;
// A card queued to play as soon as it's this seat's turn (a pre-move). Cleared
// once played, or if it stops being a legal/held card by the time the turn comes.
let premove: Card | null = null;
// Played-card keys shown last render, so only freshly played cards animate in
// (render rebuilds the DOM on every state update).
let lastPlayed = new Set<string>();
// The summary box waits a moment after the last card so the final trick stays
// on the table before the cards vanish and the box appears. `summaryRevealed`
// flips true once that pause elapses; the timer guards against arming twice.
const SUMMARY_DELAY_MS = 3000;
let summaryRevealed = false;
let summaryTimer: number | null = null;

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
  if (!state) return;
  if (state.phase !== "finished") {
    if (!window.confirm("Une partie est en cours. Distribuer une nouvelle donne ?"))
      return;
  }
  send("/new", { dealId: state.dealId });
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
  premove = premove && sameCard(premove, card) ? null : card;
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
  const held = includesCard(state.hands[mySeat], premove);
  if (!held) {
    premove = null;
    return;
  }
  if (state.turn === mySeat) {
    const card = premove;
    const legal = includesCard(state.legal, card);
    premove = null;
    if (legal) play(mySeat, card);
  }
}

/**
 * Start a new match: reshuffle a fresh pack and reset the cumulative scores to
 * zero. This is the only time the cards are shuffled — every other deal gathers
 * and cuts the pack. Confirms first if a match is already under way.
 */
function newMatch(): void {
  if (!state) return;
  if (
    state &&
    !window.confirm("Nouvelle partie ? Les scores seront remis à zéro.")
  )
    return;
  send("/new-match", { dealId: state.dealId });
}

// --- Rendering --------------------------------------------------------------

const table = document.querySelector<HTMLElement>("#table")!;
const scoreboard = document.querySelector<HTMLElement>("#scoreboard")!;
const newMatchBtn = document.querySelector<HTMLButtonElement>("#new-match")!;
const changeSeat = document.querySelector<HTMLButtonElement>("#change-seat")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const titleEl = document.querySelector<HTMLElement>("#title")!;
const workerMsg = document.querySelector<HTMLElement>("#worker-msg")!;
const voiceButton = document.querySelector<HTMLButtonElement>("#voice-bid")!;
const voiceMessage = document.querySelector<HTMLElement>("#voice-msg")!;
const voiceDebug = document.querySelector<HTMLElement>("#voice-debug")!;
const voiceTranscript = document.querySelector<HTMLElement>("#voice-transcript")!;
const voiceMatch = document.querySelector<HTMLElement>("#voice-match")!;

function voiceTurn(): VoiceTurn | null {
  if (!state || mySeat === null || offline || state.phase !== "bidding" ||
      state.turn !== mySeat || animations.dealing || animations.sweeping) return null;
  return {
    key: `${state.dealId}:${state.biddingRound}:${state.turn}:${mySeat}`,
    seat: mySeat, round: state.biddingRound, turnedSuit: state.trumpCard.suit,
  };
}

function renderVoice(): void {
  voiceButton.hidden = voiceMessage.hidden = mySeat === null;
  voiceButton.disabled = !voice.available;
  voiceButton.textContent = voice.enabled ? "🎙 Désactiver l’audio" : "🎙 Activer l’audio";
  voiceButton.setAttribute("aria-pressed", String(voice.enabled));
  voiceMessage.textContent = voice.available ? voice.message : "Audio indisponible (HTTPS et navigateur récent requis).";
  voiceDebug.hidden = mySeat === null || (!voice.enabled && !voice.transcript);
  voiceTranscript.textContent = voice.transcript || "—";
  const command = voice.command;
  const label = command?.kind === "pass" ? `passe (${command.word})`
    : command?.kind === "take" ? `prend à ${command.suit ? SUIT_NAME[command.suit] : "la retourne"}` : "";
  voiceMatch.textContent = voice.outcome === "partial" ? "En cours…"
    : voice.outcome === "unrecognized" ? "Aucune commande reconnue"
    : voice.outcome === "unavailable" ? `Reconnu : ${label} — indisponible à ce tour`
    : voice.outcome === "ignored" ? "Ignoré : le tour a changé"
    : voice.outcome === "sent" ? `Reconnu : ${label} — envoyé` : "";
}

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

/** Append a small labelled status tag (commence / passe / A pris) to a header. */
function headTag(head: HTMLElement, className: string, text: string): void {
  const tag = document.createElement("span");
  tag.className = className;
  tag.textContent = text;
  head.appendChild(tag);
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

  if (bidding && s.opener === seat) headTag(head, "starter-badge", "commence");

  // Seats earlier in the order than the current bidder have passed this round.
  if (bidding && ((seat - s.opener + 4) % 4) < s.passes) {
    headTag(head, "pass-tag", "passe");
  } else if (!bidding && s.taker === seat) {
    headTag(head, "take active", "A pris");
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
      const premoved = canPremove && premove !== null && sameCard(premove, card);
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
    // Animate only when this card is newly played (not on every state update redraw).
    if (!lastPlayed.has(cardKey(played))) pc.classList.add("deal-in");
    q.appendChild(pc);
  }

  // Your bid controls, shown only on your turn during bidding (and not while
  // the deal is still being dealt out).
  if (bidding && mine && s.turn === seat && !animations.dealing) {
    q.appendChild(renderBidControls(s, seat));
  }

  // During the second trick a player may flash their annonces to the whole
  // table, as often as asked, as long as they actually hold a declaration.
  if (mine && s.phase === "playing" && s.tricks.length === 1 && s.canShowAnnonces[seat]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.focusKey = "show-annonces";
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
  passBtn.dataset.focusKey = "bid-pass";
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
    btn.dataset.focusKey = `bid-${suit}`;
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
    btn.dataset.focusKey = `seat-${seat}`;
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

/** The cumulative score a team must reach to win the match. */
const WINNING_SCORE = 1000;

/**
 * The team that has won the match — reached the target score and is ahead — or
 * null if neither has yet (a tie at the target leaves the match going).
 */
function matchWinner(s: GameState): 0 | 1 | null {
  const [a, b] = s.scores;
  if (Math.max(a, b) < WINNING_SCORE || a === b) return null;
  return a > b ? 0 : 1;
}

/**
 * The match-over screen, shown in place of the round summary once a team reaches
 * the target: the winners, the final scores, and a button to start a new match.
 */
function renderWinBox(s: GameState, winner: 0 | 1): HTMLElement {
  const box = document.createElement("div");
  box.className = "result-box win-box";
  box.innerHTML = `
    <div class="result-heading">${TEAM_NAME[winner]} gagnent !</div>
    <div class="result-sub">Partie terminée</div>
    <div class="result-grid win-grid">
      <span class="gold">${TEAM_NAME[0]}</span>
      <span class="blue">${TEAM_NAME[1]}</span>
      <span class="total">${s.scores[0]}</span>
      <span class="total">${s.scores[1]}</span>
    </div>
  `;

  const again = document.createElement("button");
  again.type = "button";
  again.dataset.focusKey = "new-match";
  again.className = "result-next";
  again.textContent = "Nouvelle partie";
  // The match is over, so start a fresh one straight away (no confirm needed).
  again.addEventListener("click", () => send("/new-match", { dealId: s.dealId }));
  box.appendChild(again);
  return box;
}

/**
 * The round-summary box, shown in the middle of the table once the hand is
 * finished: a result heading, the points each team made this hand, each
 * column's round total (the sum of its rows), and below it the Résultat — the
 * score actually awarded, which differs from the total on a dedans or capot
 * (the failed taker's points all go to the defenders).
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

      <span class="rlabel outcome">Résultat</span>
      <span class="outcome">${r.handPoints[0]}</span>
      <span class="outcome">${r.handPoints[1]}</span>
    </div>
  `;

  // A "Nouvelle donne" button at the bottom both deals the next hand and, in
  // doing so, dismisses the box.
  const next = document.createElement("button");
  next.type = "button";
  next.dataset.focusKey = "next-deal";
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

const ANNONCE_NAME: Record<AnnonceKind, string> = {
  tierce: "Tierce",
  cinquante: "Cinquante",
  cent: "Cent",
  carre: "Carré",
};

/**
 * One annonce as text: "Carré de valets" or "Tierce au roi ♠". `suitText`
 * formats the trailing suit (a carré has none), differing only in HTML symbol
 * vs spoken French.
 */
function annonceText(a: Annonce, suitText: (s: Suit) => string): string {
  if (a.kind === "carre") return `Carré ${RANK_PLURAL[a.rank]}`;
  const suit = a.suit ? ` ${suitText(a.suit)}` : "";
  return `${ANNONCE_NAME[a.kind]} ${RANK_A[a.rank]}${suit}`;
}

/** An annonce with its suit as a coloured symbol, for on-table display. */
const annonceHtml = (a: Annonce) => annonceText(a, suitHtml);

/** An annonce with its suit spoken in French, for accessibility labels. */
const annonceLabel = (a: Annonce) => annonceText(a, (s) => `de ${SUIT_NAME[s]}`);

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
  // Starting a new match is available once you're seated.
  newMatchBtn.hidden = mySeat === null || state === null;
}

function renderTitle(): void {
  const title = mySeat === null ? "Belote" : `Belote :: ${PLAYERS[mySeat]}`;
  titleEl.textContent = title;
  // Mirror it in the document title so the browser tab names the seat too.
  document.title = title;
}

function render(): void {
  voice.update();
  renderVoice();
  renderStatus();
  renderTitle();
  renderScoreboard(state);
  renderChangeSeat();
  renderHeaderStatus(mySeat === null ? null : state);

  // While a deal is dealt out, or a finished trick is sweeping to its winner,
  // the animation owns the table — leave its DOM untouched so an incoming
  // broadcast doesn't wipe the cards mid-flight.
  if (animations.dealing || animations.sweeping) return;

  renderWithFocus(table, () => {
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
        : "Connexion à la partie…";
      table.appendChild(msg);
      return;
    }

    // A reveal flashes one seat's annonces full-size and hides every hand, so it
    // takes over the whole table until its timer reverts it.
    if (animations.reveal) {
      for (let seat = 0; seat < PLAYERS.length; seat++) {
        table.appendChild(renderRevealQuadrant(seat as Seat, animations.reveal));
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
    // If that hand carried a team past the target, the match is won, so the
    // final-scores screen takes its place.
    if (summaryShown() && state.result) {
      const winner = matchWinner(state);
      table.appendChild(
        winner !== null ? renderWinBox(state, winner) : renderResultBox(state),
      );
    }

    // Remember which cards are on the table so they don't re-animate next redraw.
    lastPlayed = new Set(shownTrick(state).map((p) => cardKey(p.card)));
  });
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

// --- Wiring -----------------------------------------------------------------

const animations = createTableAnimations({
  table, corners: CORNERS, getState: () => state, getSeat: () => mySeat,
  render, renderQuadrant, renderBack, renderCard,
});
const voice = new VoiceBidding({ seat: () => mySeat, turn: voiceTurn, bid, changed: renderVoice });
voiceButton.addEventListener("click", () => { if (voice.enabled) voice.cancel(); else void voice.start(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) voice.cancel();
});
window.addEventListener("pagehide", () => voice.cancel());

newMatchBtn.addEventListener("click", newMatch);
changeSeat.addEventListener("click", () => setMySeat(null));

// Render immediately, including while the first connection is unavailable.
const connection = new GameConnection(WS_URL, {
  offline(value) {
    offline = value;
    render();
  },
  error(message) {
    workerMsg.textContent = message === "stale deal"
      ? "La donne a déjà changé."
      : message;
  },
  reveal: animations.showReveal,
  state(next) {
    const prev = state;
    if (prev?.dealId !== next.dealId) premove = null;
    state = next;
    offline = false;
    syncPremove();
    syncSummary();
    if (animations.sweepNeeded(prev)) animations.startSweep();
    else animations.handleDeal();
  },
});
render();
connection.connect();
