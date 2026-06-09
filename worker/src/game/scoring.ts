// End-of-hand Belote scoring: card points, dix de der, belote-rebelote, the
// made/dedans contract decision, and capot.

import { type Card, type Suit } from "./deck";
import { type Seat, type TrickPlay, cardPoints, teamOf } from "./rules";

export interface CompletedTrick {
  winner: Seat;
  cards: TrickPlay[];
}

export interface HandResult {
  /** Points added to each team this hand, [team {0,2}, team {1,3}]. */
  handPoints: [number, number];
  /** Whether the taker's team fulfilled the contract. */
  madeContract: boolean;
  /** Whether one team swept all eight tricks. */
  capot: boolean;
  /** Team awarded belote-rebelote (+20), or null if no one held K+Q of trump. */
  beloteTeam: 0 | 1 | null;
}

// 152 card points + 10 for the last trick (dix de der) = 162 per hand.
const TOTAL_POINTS = 162;
const DIX_DE_DER = 10;
const BELOTE_BONUS = 20;
const CAPOT_POINTS = 252;

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
 * at `trump`. Returns the points each team scores, including belote-rebelote,
 * which always counts even when its team goes dedans or a capot is scored.
 */
export function scoreHand(
  tricks: CompletedTrick[],
  trump: Suit,
  taker: Seat,
): HandResult {
  const takerTeam = teamOf(taker);
  const defenders = (1 - takerTeam) as 0 | 1;
  const beloteTeam = beloteTeamFor(tricks, trump);

  // Raw card points per team, with dix de der to the last trick's winner.
  const cardPts: [number, number] = [0, 0];
  for (const trick of tricks) {
    const team = teamOf(trick.winner);
    for (const { card } of trick.cards) cardPts[team] += cardPoints(card, trump);
  }
  cardPts[teamOf(tricks[tricks.length - 1].winner)] += DIX_DE_DER;

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
  } else if (cardPts[takerTeam] > cardPts[defenders]) {
    // Contract made: each team keeps its own card points.
    handPoints[takerTeam] = cardPts[takerTeam];
    handPoints[defenders] = cardPts[defenders];
    madeContract = true;
  } else {
    // Dedans (including an 81–81 tie): defenders take everything.
    handPoints[defenders] = TOTAL_POINTS;
    madeContract = false;
  }

  // Belote-rebelote is added on top and always counts.
  if (beloteTeam !== null) handPoints[beloteTeam] += BELOTE_BONUS;

  return { handPoints, madeContract, capot: capotTeam !== null, beloteTeam };
}
