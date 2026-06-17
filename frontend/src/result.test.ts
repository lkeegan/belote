import { describe, it, expect } from "vitest";
import { type RoundBreakdown, derTeamOf, roundTotals } from "./result";

describe("derTeamOf", () => {
  it("credits the team of the last trick's winner", () => {
    // Seats 0 and 2 are team 0; seats 1 and 3 are team 1.
    expect(derTeamOf([{ winner: 0 }, { winner: 3 }])).toBe(1);
    expect(derTeamOf([{ winner: 1 }, { winner: 2 }])).toBe(0);
  });

  it("is null when no tricks have been played", () => {
    expect(derTeamOf([])).toBe(null);
  });
});

describe("roundTotals", () => {
  // A plain made-contract hand: card points only, der to team 0, no bonuses.
  const base: RoundBreakdown = {
    cardPoints: [90, 62],
    annonceTeam: null,
    annoncePoints: 0,
    beloteTeam: null,
  };

  it("sums card points plus the dix de der into each column", () => {
    expect(roundTotals(base, 0)).toEqual([100, 62]); // team 0 also takes the 10
    expect(roundTotals(base, 1)).toEqual([90, 72]); // team 1 takes the 10
  });

  it("adds annonces only to the team that won them", () => {
    const r: RoundBreakdown = { ...base, annonceTeam: 1, annoncePoints: 50 };
    expect(roundTotals(r, 0)).toEqual([100, 112]); // 62 + 50 to team 1
  });

  it("adds the belote bonus only to its holder", () => {
    const r: RoundBreakdown = { ...base, beloteTeam: 0 };
    expect(roundTotals(r, 0)).toEqual([120, 62]); // 90 + 10 der + 20 belote
  });

  it("combines card points, der, annonces and belote per column", () => {
    const r: RoundBreakdown = {
      cardPoints: [82, 70],
      annonceTeam: 0,
      annoncePoints: 20,
      beloteTeam: 1,
    };
    // team 0: 82 + 20 annonce + 10 der ; team 1: 70 + 20 belote
    expect(roundTotals(r, 0)).toEqual([112, 90]);
  });

  it("credits no dix de der when derTeam is null", () => {
    expect(roundTotals(base, null)).toEqual([90, 62]);
  });
});
