import { describe, it, expect } from "vitest";
import { type Card, type Rank, type Suit } from "./deck";
import {
  type Seat,
  type TrickPlay,
  cardPoints,
  legalMoves,
  nextSeat,
  partnerOf,
  teamOf,
  trickWinner,
} from "./rules";

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const key = (card: Card) => `${card.rank}${card.suit}`;
const keys = (cards: Card[]) => cards.map(key).sort();
const play = (seat: Seat, card: Card): TrickPlay => ({ seat, card });

describe("seat helpers", () => {
  it("pairs opposite seats and rotates play around the table", () => {
    expect(teamOf(0)).toBe(0);
    expect(teamOf(2)).toBe(0);
    expect(teamOf(1)).toBe(1);
    expect(teamOf(3)).toBe(1);
    expect(partnerOf(0)).toBe(2);
    expect(partnerOf(1)).toBe(3);
    expect([nextSeat(0), nextSeat(1), nextSeat(2), nextSeat(3)]).toEqual([
      1, 2, 3, 0,
    ]);
  });
});

describe("cardPoints", () => {
  it("scores trumps on the J-9-A-10-K-Q-8-7 scale", () => {
    const t: Suit = "hearts";
    expect(cardPoints(c("J", t), t)).toBe(20);
    expect(cardPoints(c("9", t), t)).toBe(14);
    expect(cardPoints(c("A", t), t)).toBe(11);
    expect(cardPoints(c("10", t), t)).toBe(10);
    expect(cardPoints(c("K", t), t)).toBe(4);
    expect(cardPoints(c("Q", t), t)).toBe(3);
    expect(cardPoints(c("8", t), t)).toBe(0);
    expect(cardPoints(c("7", t), t)).toBe(0);
  });

  it("scores plain suits on the A-10-K-Q-J-9-8-7 scale", () => {
    const t: Suit = "hearts";
    expect(cardPoints(c("A", "spades"), t)).toBe(11);
    expect(cardPoints(c("10", "spades"), t)).toBe(10);
    expect(cardPoints(c("K", "spades"), t)).toBe(4);
    expect(cardPoints(c("Q", "spades"), t)).toBe(3);
    expect(cardPoints(c("J", "spades"), t)).toBe(2);
    expect(cardPoints(c("9", "spades"), t)).toBe(0);
  });

  it("a full deck of card points totals 152 for any trump", () => {
    const suits: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
    const ranks: Rank[] = ["7", "8", "9", "10", "J", "Q", "K", "A"];
    for (const trump of suits) {
      let total = 0;
      for (const s of suits)
        for (const r of ranks) total += cardPoints(c(r, s), trump);
      expect(total).toBe(152);
    }
  });
});

describe("trickWinner", () => {
  const trump: Suit = "hearts";

  it("awards the highest card of the led suit when no trump is played", () => {
    const trick = [
      play(0, c("K", "spades")),
      play(1, c("A", "spades")),
      play(2, c("7", "clubs")),
      play(3, c("10", "spades")),
    ];
    expect(trickWinner(trick, trump)).toBe(1); // ace of led suit
  });

  it("lets any trump beat the led suit", () => {
    const trick = [
      play(0, c("A", "spades")),
      play(1, c("7", "hearts")),
      play(2, c("10", "spades")),
      play(3, c("K", "spades")),
    ];
    expect(trickWinner(trick, trump)).toBe(1); // the lone trump
  });

  it("ranks trumps J-9-A-10-K-Q-8-7", () => {
    const trick = [
      play(0, c("A", "hearts")),
      play(1, c("9", "hearts")),
      play(2, c("J", "hearts")),
      play(3, c("10", "hearts")),
    ];
    expect(trickWinner(trick, trump)).toBe(2); // jack is highest trump
  });

  it("ignores off-suit, non-trump cards", () => {
    const trick = [
      play(0, c("Q", "spades")),
      play(1, c("A", "clubs")),
      play(2, c("A", "diamonds")),
      play(3, c("7", "spades")),
    ];
    expect(trickWinner(trick, trump)).toBe(0); // only led-suit cards can win
  });
});

describe("legalMoves", () => {
  const trump: Suit = "hearts";

  it("lets the leader play anything", () => {
    const hand = [c("7", "spades"), c("A", "clubs"), c("J", "hearts")];
    expect(keys(legalMoves(hand, [], trump, 0))).toEqual(keys(hand));
  });

  it("requires following the led suit when able", () => {
    const trick = [play(0, c("K", "spades"))];
    const hand = [c("7", "spades"), c("A", "spades"), c("J", "hearts")];
    expect(keys(legalMoves(hand, trick, trump, 1))).toEqual(
      keys([c("7", "spades"), c("A", "spades")]),
    );
  });

  it("forces a trump when void in the led suit and an opponent leads", () => {
    const trick = [play(0, c("A", "spades"))]; // seat 0 leads, opponent of seat 1
    const hand = [c("7", "hearts"), c("K", "clubs")];
    expect(keys(legalMoves(hand, trick, trump, 1))).toEqual(
      keys([c("7", "hearts")]),
    );
  });

  it("forces over-trumping when a trump is already in the trick", () => {
    const trick = [play(0, c("K", "spades")), play(1, c("8", "hearts"))];
    const hand = [c("J", "hearts"), c("7", "hearts")]; // J beats 8, 7 does not
    expect(keys(legalMoves(hand, trick, trump, 2))).toEqual(
      keys([c("J", "hearts")]),
    );
  });

  it("allows any trump when over-trumping is impossible", () => {
    const trick = [play(0, c("K", "spades")), play(1, c("8", "hearts"))];
    const hand = [c("7", "hearts"), c("A", "clubs")]; // 7 cannot beat the 8
    expect(keys(legalMoves(hand, trick, trump, 2))).toEqual(
      keys([c("7", "hearts")]),
    );
  });

  it("frees the player to discard when their partner is winning", () => {
    const trick = [play(0, c("A", "spades"))]; // seat 0 wins; partner of seat 2
    const hand = [c("7", "hearts"), c("K", "clubs")];
    expect(keys(legalMoves(hand, trick, trump, 2))).toEqual(keys(hand));
  });

  it("frees the player to discard when void with no trump", () => {
    const trick = [play(0, c("A", "spades"))];
    const hand = [c("K", "clubs"), c("7", "diamonds")];
    expect(keys(legalMoves(hand, trick, trump, 1))).toEqual(keys(hand));
  });

  it("requires following and over-trumping when trump is led", () => {
    const trick = [play(0, c("A", "hearts"))]; // trump led (A = mid strength)
    const hand = [c("J", "hearts"), c("7", "hearts"), c("K", "clubs")];
    expect(keys(legalMoves(hand, trick, trump, 1))).toEqual(
      keys([c("J", "hearts")]), // only the jack out-ranks the ace
    );
  });

  it("allows any trump under a trump lead when none can over-rank it", () => {
    const trick = [play(0, c("9", "hearts"))]; // second-highest trump led
    const hand = [c("A", "hearts"), c("7", "hearts"), c("K", "clubs")];
    expect(keys(legalMoves(hand, trick, trump, 1))).toEqual(
      keys([c("A", "hearts"), c("7", "hearts")]),
    );
  });

  it("frees a trump-less player under a trump lead", () => {
    const trick = [play(0, c("9", "hearts"))];
    const hand = [c("A", "clubs"), c("7", "diamonds")];
    expect(keys(legalMoves(hand, trick, trump, 1))).toEqual(keys(hand));
  });
});
