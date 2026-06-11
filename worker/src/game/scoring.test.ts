import { describe, it, expect } from "vitest";
import { type Card, type Rank, type Suit, createDeck } from "./deck";
import { type Seat, type TrickPlay } from "./rules";
import { type CompletedTrick, scoreHand } from "./scoring";

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });

/** Build a completed trick from a winner and (seat, card) plays. */
const trick = (winner: Seat, plays: [Seat, Card][]): CompletedTrick => ({
  winner,
  cards: plays.map(([seat, card]): TrickPlay => ({ seat, card })),
});

const TRUMP: Suit = "hearts";

describe("scoreHand — contract decision", () => {
  it("keeps each team's points when the taker's team scores more", () => {
    const tricks = [
      trick(0, [
        [0, c("J", "hearts")], // 20 (trump)
        [1, c("A", "spades")], // 11
        [2, c("10", "spades")], // 10
        [3, c("K", "spades")], // 4  -> team 0: 45
      ]),
      trick(1, [
        [0, c("Q", "spades")], // 3
        [1, c("9", "hearts")], // 14 (trump)
        [2, c("8", "diamonds")], // 0
        [3, c("7", "diamonds")], // 0  -> team 1: 17 (3+14 + 10 dix de der)
      ]),
    ];
    const r = scoreHand(tricks, TRUMP, 0);
    expect(r.madeContract).toBe(true);
    expect(r.capot).toBe(false);
    expect(r.beloteTeam).toBe(null);
    expect(r.handPoints).toEqual([45, 27]); // 3 + 14 + 10 dix de der
  });

  it("sends the taker dedans (defenders take 162) when out-scored", () => {
    const tricks = [
      trick(0, [
        [0, c("J", "hearts")],
        [1, c("A", "spades")],
        [2, c("10", "spades")],
        [3, c("K", "spades")],
      ]),
      trick(1, [
        [0, c("Q", "spades")],
        [1, c("9", "hearts")],
        [2, c("8", "diamonds")],
        [3, c("7", "diamonds")],
      ]),
    ];
    // Taker is on team 1, which scored fewer points -> dedans.
    const r = scoreHand(tricks, TRUMP, 1);
    expect(r.madeContract).toBe(false);
    expect(r.handPoints).toEqual([162, 0]);
  });

  it("treats an exact tie as dedans for the taker", () => {
    const tricks = [
      trick(0, [
        [0, c("J", "hearts")], // 20
        [1, c("A", "spades")], // 11
        [2, c("10", "spades")], // 10
        [3, c("K", "spades")], // 4  -> team 0: 45
      ]),
      trick(1, [
        [0, c("9", "hearts")], // 14
        [1, c("A", "clubs")], // 11
        [2, c("10", "clubs")], // 10
        [3, c("7", "clubs")], // 0  -> team 1: 35 + 10 dix de der = 45
      ]),
    ];
    const r = scoreHand(tricks, TRUMP, 0); // taker team 0, tied 45–45
    expect(r.madeContract).toBe(false);
    expect(r.handPoints).toEqual([0, 162]);
  });
});

describe("scoreHand — capot", () => {
  it("awards 252 when the taker's team sweeps every trick", () => {
    const tricks = Array.from({ length: 8 }, (_, i) =>
      trick((i % 2 === 0 ? 0 : 2) as Seat, [[0, c("7", "spades")]]),
    );
    const r = scoreHand(tricks, TRUMP, 0); // taker on the sweeping team
    expect(r.capot).toBe(true);
    expect(r.madeContract).toBe(true);
    expect(r.handPoints).toEqual([252, 0]);
  });

  it("still scores 252 to the defenders when they capot the taker", () => {
    const tricks = Array.from({ length: 8 }, () =>
      trick(0, [[0, c("7", "spades")]]),
    );
    const r = scoreHand(tricks, TRUMP, 1); // taker on the swept team
    expect(r.capot).toBe(true);
    expect(r.madeContract).toBe(false);
    expect(r.handPoints).toEqual([252, 0]);
  });
});

describe("scoreHand — belote-rebelote", () => {
  it("adds 20 when one player held both K and Q of trump", () => {
    const tricks = [
      trick(1, [
        [0, c("K", "hearts")], // seat 0 plays the trump king
        [1, c("A", "spades")],
        [2, c("7", "clubs")],
        [3, c("8", "clubs")],
      ]),
      trick(0, [
        [0, c("8", "hearts")],
        [1, c("7", "spades")],
        [2, c("9", "spades")],
        [3, c("8", "spades")],
      ]),
      trick(3, [
        [0, c("Q", "hearts")], // seat 0 also plays the trump queen
        [1, c("7", "diamonds")],
        [2, c("8", "diamonds")],
        [3, c("9", "diamonds")],
      ]),
    ];
    // Taker team 0 is out-scored, so they go dedans — but belote still counts.
    const r = scoreHand(tricks, TRUMP, 0);
    expect(r.madeContract).toBe(false);
    expect(r.beloteTeam).toBe(0);
    expect(r.handPoints).toEqual([20, 162]);
  });

  it("awards belote to no one when K and Q of trump are split", () => {
    const tricks = [
      trick(0, [
        [0, c("K", "hearts")], // seat 0 has the king
        [1, c("Q", "hearts")], // seat 1 has the queen
        [2, c("A", "spades")],
        [3, c("7", "clubs")],
      ]),
      trick(1, [
        [0, c("7", "spades")],
        [1, c("8", "spades")],
        [2, c("9", "spades")],
        [3, c("10", "spades")],
      ]),
    ];
    const r = scoreHand(tricks, TRUMP, 0);
    expect(r.beloteTeam).toBe(null);
  });
});

describe("scoreHand — invariants on a full 32-card hand", () => {
  // Deal all 32 cards into eight tricks (deck order), seats by position.
  const fullTricks = (winners: Seat[]): CompletedTrick[] => {
    const deck = createDeck();
    return winners.map((winner, t) =>
      trick(
        winner,
        [0, 1, 2, 3].map((seat) => [seat as Seat, deck[t * 4 + seat]]),
      ),
    );
  };

  it("splits exactly 162 card points between the teams (no capot, no belote)", () => {
    // Team 0 takes the first four tricks, team 1 the last four.
    const r = scoreHand(fullTricks([0, 0, 0, 0, 1, 1, 1, 1]), TRUMP, 0);
    expect(r.capot).toBe(false);
    expect(r.beloteTeam).toBe(null);
    // In deck order each seat holds four-of-a-kinds, so annonces are awarded on
    // top; the card points underneath still conserve to 162.
    expect(r.handPoints[0] + r.handPoints[1] - r.annoncePoints).toBe(162);
  });

  it("dix de der lands on the last trick's winner", () => {
    const lowPoint = [
      trick(0, [
        [0, c("7", "spades")],
        [1, c("8", "spades")],
        [2, c("9", "spades")],
        [3, c("7", "clubs")],
      ]),
      trick(1, [
        [0, c("8", "clubs")],
        [1, c("9", "clubs")],
        [2, c("7", "diamonds")],
        [3, c("8", "diamonds")],
      ]),
    ];
    const r = scoreHand(lowPoint, TRUMP, 1); // taker team 1 wins the last trick
    expect(r.madeContract).toBe(true);
    expect(r.handPoints).toEqual([0, 10]); // only the dix de der scores
  });
});

describe("scoreHand — annonces", () => {
  // Annonce detection only depends on which cards each seat played, so we build
  // eight tricks straight from four eight-card hands (winner is irrelevant).
  const fromHands = (hands: [Card[], Card[], Card[], Card[]]): CompletedTrick[] =>
    Array.from({ length: 8 }, (_, t) =>
      trick(
        0,
        [0, 1, 2, 3].map((s): [Seat, Card] => [s as Seat, hands[s as Seat][t]]),
      ),
    );

  it("gives the higher annonce's team all of theirs (carré beats tierce)", () => {
    const r = scoreHand(
      fromHands([
        // team 0: a carré of jacks (200)
        [c("J", "hearts"), c("J", "diamonds"), c("J", "clubs"), c("J", "spades"),
         c("7", "hearts"), c("9", "diamonds"), c("K", "clubs"), c("8", "spades")],
        // team 1: a tierce A-K-Q of spades (20)
        [c("A", "spades"), c("K", "spades"), c("Q", "spades"),
         c("7", "hearts"), c("9", "hearts"), c("7", "diamonds"),
         c("10", "diamonds"), c("8", "clubs")],
        // team 0 partner: no annonce
        [c("7", "clubs"), c("9", "clubs"), c("7", "spades"), c("9", "spades"),
         c("8", "hearts"), c("10", "hearts"), c("8", "diamonds"), c("10", "diamonds")],
        // team 1 partner: no annonce
        [c("Q", "hearts"), c("K", "hearts"), c("Q", "diamonds"), c("K", "diamonds"),
         c("Q", "clubs"), c("K", "clubs"), c("8", "spades"), c("10", "spades")],
      ]),
      TRUMP,
      0,
    );
    expect(r.annonceTeam).toBe(0);
    expect(r.annoncePoints).toBe(200);
    expect(r.annonces).toEqual([
      { team: 0, kind: "carre", rank: "J", points: 200 },
    ]);
  });

  it("sums every annonce of the winning team", () => {
    const r = scoreHand(
      fromHands([
        // team 0: a carré of nines (150) — the highest annonce overall
        [c("9", "hearts"), c("9", "diamonds"), c("9", "clubs"), c("9", "spades"),
         c("7", "hearts"), c("J", "diamonds"), c("K", "clubs"), c("A", "spades")],
        // team 1: a cinquante 7-8-9-10 of clubs (50)
        [c("7", "clubs"), c("8", "clubs"), c("9", "clubs"), c("10", "clubs"),
         c("A", "hearts"), c("7", "diamonds"), c("Q", "spades"), c("K", "diamonds")],
        // team 0 partner: a tierce 7-8-9 of spades (20)
        [c("7", "spades"), c("8", "spades"), c("9", "spades"),
         c("J", "hearts"), c("K", "hearts"), c("7", "diamonds"),
         c("10", "diamonds"), c("Q", "clubs")],
        // team 1 partner: no annonce
        [c("Q", "hearts"), c("A", "hearts"), c("Q", "diamonds"), c("A", "diamonds"),
         c("8", "clubs"), c("J", "clubs"), c("8", "spades"), c("10", "spades")],
      ]),
      TRUMP,
      0,
    );
    expect(r.annonceTeam).toBe(0);
    expect(r.annoncePoints).toBe(170); // carré 150 + tierce 20
    expect(r.annonces).toHaveLength(2);
  });

  it("cancels two equal sequences when neither is trump", () => {
    const r = scoreHand(
      fromHands([
        // team 0: a J-high tierce in clubs
        [c("9", "clubs"), c("10", "clubs"), c("J", "clubs"),
         c("7", "hearts"), c("8", "diamonds"), c("Q", "spades"),
         c("A", "spades"), c("7", "spades")],
        // team 1: a J-high tierce in diamonds — same length and top card
        [c("9", "diamonds"), c("10", "diamonds"), c("J", "diamonds"),
         c("8", "hearts"), c("7", "clubs"), c("Q", "spades"),
         c("A", "spades"), c("7", "spades")],
        [c("7", "clubs"), c("9", "clubs"), c("7", "spades"), c("9", "spades"),
         c("8", "hearts"), c("10", "hearts"), c("8", "diamonds"), c("10", "diamonds")],
        [c("Q", "hearts"), c("K", "hearts"), c("Q", "diamonds"), c("K", "diamonds"),
         c("Q", "clubs"), c("K", "clubs"), c("8", "spades"), c("10", "spades")],
      ]),
      TRUMP,
      0,
    );
    expect(r.annonceTeam).toBe(null);
    expect(r.annoncePoints).toBe(0);
  });

  it("counts toward the contract: an annonce can rescue a dedans", () => {
    // On cards alone the taker (team 0) trails 17–25 and would go dedans, but
    // their tierce A-K-Q of spades (20) tips the total to 37–25.
    const tricks = [
      trick(1, [
        [0, c("A", "spades")], // 11
        [1, c("9", "hearts")], // 14 (trump) -> team 1: 25
        [2, c("7", "clubs")],
        [3, c("8", "clubs")],
      ]),
      trick(0, [
        [0, c("K", "spades")], // 4 -> team 0
        [1, c("7", "diamonds")],
        [2, c("8", "diamonds")],
        [3, c("9", "diamonds")],
      ]),
      trick(0, [
        [0, c("Q", "spades")], // 3 + 10 dix de der -> team 0: 17
        [1, c("7", "hearts")],
        [2, c("8", "hearts")],
        [3, c("7", "spades")],
      ]),
    ];
    const r = scoreHand(tricks, TRUMP, 0);
    expect(r.annonceTeam).toBe(0);
    expect(r.annoncePoints).toBe(20);
    expect(r.madeContract).toBe(true);
    expect(r.handPoints).toEqual([37, 25]);
  });

  it("breaks an otherwise-equal tie in favour of the trump sequence", () => {
    const r = scoreHand(
      fromHands([
        // team 0: a J-high tierce in clubs (not trump)
        [c("9", "clubs"), c("10", "clubs"), c("J", "clubs"),
         c("7", "hearts"), c("8", "diamonds"), c("Q", "spades"),
         c("A", "spades"), c("7", "spades")],
        // team 1: a J-high tierce in hearts (trump) — wins the tie
        [c("9", "hearts"), c("10", "hearts"), c("J", "hearts"),
         c("8", "clubs"), c("7", "clubs"), c("Q", "spades"),
         c("A", "spades"), c("7", "spades")],
        [c("7", "clubs"), c("9", "clubs"), c("7", "spades"), c("9", "spades"),
         c("8", "hearts"), c("10", "hearts"), c("8", "diamonds"), c("10", "diamonds")],
        [c("Q", "hearts"), c("K", "hearts"), c("Q", "diamonds"), c("K", "diamonds"),
         c("Q", "clubs"), c("K", "clubs"), c("8", "spades"), c("10", "spades")],
      ]),
      TRUMP, // hearts
      0,
    );
    expect(r.annonceTeam).toBe(1);
    expect(r.annoncePoints).toBe(20);
  });
});
