// Pure helpers for the end-of-round result box. Kept out of main.ts (which has
// DOM side effects on import) so the scoring breakdown can be unit-tested.

/** A team index: 0 = {Sébastian, Liam}, 1 = {Maya, Dadmor}. */
export type Team = 0 | 1;

/** The per-team rows that make up a round's result breakdown. */
export interface RoundBreakdown {
  /** Raw card points each team captured this hand, before any bonus. */
  cardPoints: [number, number];
  /** Team awarded the annonces (null if none), and the total awarded to them. */
  annonceTeam: Team | null;
  annoncePoints: number;
  /** Team awarded belote-rebelote (+20), or null if no one held K+Q of trump. */
  beloteTeam: Team | null;
}

/** Points for the dix de der (last trick) and belote-rebelote. */
const DIX_DE_DER = 10;
const BELOTE_BONUS = 20;

/**
 * The team that won the last trick — it scores the dix de der. Null if no
 * tricks have been played (so neither column is credited the 10).
 */
export function derTeamOf(tricks: { winner: number }[]): Team | null {
  if (tricks.length === 0) return null;
  return (tricks[tricks.length - 1].winner % 2) as Team;
}

/**
 * Each column's round total in the result box: the sum of the rows shown above
 * it — card points, annonces, dix de der, and belote — for that team. This is
 * the breakdown of what was played for this round, not the running game score.
 */
export function roundTotals(
  r: RoundBreakdown,
  derTeam: Team | null,
): [number, number] {
  const total = (col: Team): number =>
    r.cardPoints[col] +
    (r.annonceTeam === col ? r.annoncePoints : 0) +
    (derTeam === col ? DIX_DE_DER : 0) +
    (r.beloteTeam === col ? BELOTE_BONUS : 0);
  return [total(0), total(1)];
}
