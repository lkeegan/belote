// End-of-hand Belote scoring: card points, dix de der, belote-rebelote,
// annonces (sequences and carrés), the made/dedans contract decision, and capot.

import { type Card, type Rank, type Suit, RANKS, SUITS } from "./deck";
import { type Seat, type TrickPlay, cardPoints, teamOf } from "./rules";

export interface CompletedTrick {
  winner: Seat;
  cards: TrickPlay[];
}

/** A declaration (annonce): a run of cards or a four-of-a-kind in one hand. */
export type AnnonceKind = "tierce" | "cinquante" | "cent" | "carre";

export interface Annonce {
  team: 0 | 1;
  kind: AnnonceKind;
  /** Top card of a sequence, or the shared rank of a carré. */
  rank: Rank;
  /** Suit of a sequence; omitted for a carré (it spans all four suits). */
  suit?: Suit;
  points: number;
  /**
   * The cards that make up the declaration, in display order: a sequence runs
   * low→high (7-8-9…), a carré lists its four suits. Lets clients show the
   * actual cards when a player reveals their annonces.
   */
  cards: Card[];
}

export interface HandResult {
  /** Points added to each team this hand, [team {0,2}, team {1,3}]. */
  handPoints: [number, number];
  /** Raw card points each team captured in tricks, before dix de der. */
  cardPoints: [number, number];
  /** Whether the taker's team fulfilled the contract. */
  madeContract: boolean;
  /** Whether one team swept all eight tricks. */
  capot: boolean;
  /** Team awarded belote-rebelote (+20), or null if no one held K+Q of trump. */
  beloteTeam: 0 | 1 | null;
  /** Team awarded the annonces, or null if there were none (or a top-tie). */
  annonceTeam: 0 | 1 | null;
  /** Total annonce points awarded to annonceTeam (0 if none). */
  annoncePoints: number;
  /** The winning team's annonces, for display. */
  annonces: Annonce[];
}

// 152 card points + 10 for the last trick (dix de der) = 162 per hand.
const TOTAL_POINTS = 162;
const DIX_DE_DER = 10;
const BELOTE_BONUS = 20;
const CAPOT_POINTS = 252;

// Carré (four of a kind) values; 7s and 8s don't count, so they're absent.
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
 * Every annonce in one hand: carrés (four of a counting rank) and the maximal
 * runs of three or more consecutive cards within a single suit. Sequences rank
 * in natural order (7-8-9-10-J-Q-K-A), independent of which suit is trump.
 */
export function handAnnonces(hand: Card[], seat: Seat, trump: Suit): Annonce[] {
  const team = teamOf(seat);
  const found: Annonce[] = [];

  // Carrés: a counting rank held four times. Listed in suit order.
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

  // Sequences: split each suit's ranks into maximal consecutive runs, each run
  // kept in low→high order so the declaration reads naturally.
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

/**
 * A comparable strength for ranking annonces against each other. Carrés always
 * outrank sequences (the smallest counting carré, of tens, is 100 — equal to
 * the best sequence, a cent). Among carrés the order is J > 9 > A > K > Q > 10;
 * among sequences the longer wins, then the higher top card, then trump breaks
 * a tie between two otherwise-identical runs.
 */
function strength(a: Annonce, trump: Suit): [number, number] {
  if (a.kind === "carre") return [2, a.points * 10 + RANKS.indexOf(a.rank)];
  const length = a.kind === "cent" ? 5 : a.kind === "cinquante" ? 4 : 3;
  const trumpBreak = a.suit === trump ? 1 : 0;
  return [1, length * 1000 + RANKS.indexOf(a.rank) * 2 + trumpBreak];
}

/** Compare two annonces: positive if `a` is the stronger. */
function compareAnnonce(a: Annonce, b: Annonce, trump: Suit): number {
  const sa = strength(a, trump);
  const sb = strength(b, trump);
  return sa[0] - sb[0] || sa[1] - sb[1];
}

function bestAnnonce(all: Annonce[], team: 0 | 1, trump: Suit): Annonce | null {
  let best: Annonce | null = null;
  for (const a of all) {
    if (a.team === team && (!best || compareAnnonce(a, best, trump) > 0)) best = a;
  }
  return best;
}

/**
 * Award the annonces. Each team's hands are reconstructed from the cards they
 * played across the tricks, all declarations are detected, and the team holding
 * the single highest one scores *all* of theirs — the other team scores none.
 * If the two top annonces are exactly equal (same kind and height, neither at
 * trump) they cancel and nobody scores.
 */
function awardAnnonces(
  tricks: CompletedTrick[],
  trump: Suit,
): { team: 0 | 1 | null; points: number; annonces: Annonce[] } {
  const hands: Card[][] = [[], [], [], []];
  for (const trick of tricks) {
    for (const { seat, card } of trick.cards) hands[seat].push(card);
  }

  const all: Annonce[] = [];
  for (let seat = 0; seat < 4; seat++) {
    all.push(...handAnnonces(hands[seat], seat as Seat, trump));
  }

  const best0 = bestAnnonce(all, 0, trump);
  const best1 = bestAnnonce(all, 1, trump);

  let team: 0 | 1 | null;
  if (!best0 && !best1) return { team: null, points: 0, annonces: [] };
  else if (!best1) team = 0;
  else if (!best0) team = 1;
  else {
    const cmp = compareAnnonce(best0, best1, trump);
    team = cmp > 0 ? 0 : cmp < 0 ? 1 : null; // an exact top-tie cancels both
  }
  if (team === null) return { team: null, points: 0, annonces: [] };

  const annonces = all.filter((a) => a.team === team);
  const points = annonces.reduce((sum, a) => sum + a.points, 0);
  return { team, points, annonces };
}

/**
 * The team awarded belote-rebelote: the one whose single player held both the
 * King and Queen of trump. Detected from who played each across the tricks —
 * if the same seat played both, that seat's team scores it. Split between
 * players (or teams) means no belote.
 */
function beloteTeamFor(tricks: CompletedTrick[], trump: Suit): 0 | 1 | null {
  let kingSeat: Seat | null = null;
  let queenSeat: Seat | null = null;
  for (const trick of tricks) {
    for (const { seat, card } of trick.cards) {
      if (card.suit !== trump) continue;
      if (card.rank === "K") kingSeat = seat;
      if (card.rank === "Q") queenSeat = seat;
    }
  }
  if (kingSeat === null || queenSeat === null) return null;
  return kingSeat === queenSeat ? teamOf(kingSeat) : null;
}

/**
 * Score a completed hand (all eight tricks played). `taker` took the contract
 * at `trump`. Returns the points each team scores, including belote-rebelote
 * and annonces, both of which always count for their holder even on a dedans
 * or capot — and both of which count toward the contract decision below.
 */
export function scoreHand(
  tricks: CompletedTrick[],
  trump: Suit,
  taker: Seat,
): HandResult {
  const takerTeam = teamOf(taker);
  const defenders = (1 - takerTeam) as 0 | 1;
  const beloteTeam = beloteTeamFor(tricks, trump);
  const annonce = awardAnnonces(tricks, trump);

  // Raw card points per team, with dix de der to the last trick's winner.
  const cardPts: [number, number] = [0, 0];
  for (const trick of tricks) {
    const team = teamOf(trick.winner);
    for (const { card } of trick.cards) cardPts[team] += cardPoints(card, trump);
  }
  // The card points captured before the 10-point dix de der is added on.
  const handCardPoints: [number, number] = [cardPts[0], cardPts[1]];
  cardPts[teamOf(tricks[tricks.length - 1].winner)] += DIX_DE_DER;

  // Bonus points (belote-rebelote and annonces) by team. They always count for
  // their holder, and — per the belote rule — toward the contract decision: the
  // taker must out-total the defenders across cards *and* bonuses to make it.
  const bonus: [number, number] = [0, 0];
  if (beloteTeam !== null) bonus[beloteTeam] += BELOTE_BONUS;
  if (annonce.team !== null) bonus[annonce.team] += annonce.points;

  // Capot: one team won every trick.
  const winners = tricks.map((t) => teamOf(t.winner));
  const capotTeam = winners.every((w) => w === 0)
    ? 0
    : winners.every((w) => w === 1)
      ? 1
      : null;

  const handPoints: [number, number] = [0, 0];
  let madeContract: boolean;

  if (capotTeam !== null) {
    handPoints[capotTeam] = CAPOT_POINTS;
    madeContract = capotTeam === takerTeam;
  } else if (cardPts[takerTeam] + bonus[takerTeam] > cardPts[defenders] + bonus[defenders]) {
    // Contract made: each team keeps its own card points.
    handPoints[takerTeam] = cardPts[takerTeam];
    handPoints[defenders] = cardPts[defenders];
    madeContract = true;
  } else {
    // Dedans (including a points tie): defenders take all the card points.
    handPoints[defenders] = TOTAL_POINTS;
    madeContract = false;
  }

  // Bonuses are added on top, always counting for their holder.
  handPoints[0] += bonus[0];
  handPoints[1] += bonus[1];

  return {
    handPoints,
    cardPoints: handCardPoints,
    madeContract,
    capot: capotTeam !== null,
    beloteTeam,
    annonceTeam: annonce.team,
    annoncePoints: annonce.points,
    annonces: annonce.annonces,
  };
}
