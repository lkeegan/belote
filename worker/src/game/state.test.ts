import { describe, it, expect } from "vitest";
import { type Card, type Suit, SUITS, RANKS, createDeck, makeRng } from "./deck";
import { type Seat, legalMoves, nextSeat } from "./rules";
import {
  type GameState,
  annoncesToReveal,
  createGame,
  gatherDeck,
  reduce,
  replaceOptions,
} from "./state";

const handSizes = (s: GameState) => s.hands.map((h) => h.length);

/** A deterministic deal for tests: fixed opener and seeded shuffle. */
const deal = (opener: Seat = 0, seed = "seed"): GameState =>
  createGame(opener, makeRng(seed));

describe("createGame", () => {
  it("deals a five-card bidding hand to everyone, opened by `opener`", () => {
    const s = deal(2);
    expect(s.phase).toBe("bidding");
    expect(handSizes(s)).toEqual([5, 5, 5, 5]);
    expect(s.talon).toHaveLength(11);
    expect(s.opener).toBe(2);
    expect(s.turn).toBe(2);
    expect(s.trump).toBe(null);
    expect(s.taker).toBe(null);
    expect(s.scores).toEqual([0, 0]);
  });
});

describe("reduce — new and guards", () => {
  it("opens the first deal with seat 0 and zero scores", () => {
    const r = reduce(null, { type: "new" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("bidding");
    expect(r.state.opener).toBe(0);
    expect(r.state.scores).toEqual([0, 0]);
  });

  it("rejects actions when there is no game", () => {
    const r = reduce(null, { type: "bid", seat: 0, suit: null });
    expect(r).toEqual({ ok: false, error: "no game in progress" });
  });

  it("rotates the opener clockwise and carries scores into a new deal", () => {
    const prev = { ...deal(1), scores: [120, 42] as [number, number] };
    const r = reduce(prev, { type: "new" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.opener).toBe(2); // 1 -> 2, clockwise
    expect(r.state.turn).toBe(2);
    expect(r.state.scores).toEqual([120, 42]); // accumulated, not reset
    expect(r.state.phase).toBe("bidding");
  });

  it("starts a new match: resets scores, reopens with seat 0, and redeals", () => {
    const playing = { ...deal(2), scores: [120, 42] as [number, number] };
    const r = reduce(playing, { type: "match" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.scores).toEqual([0, 0]);
    expect(r.state.opener).toBe(0);
    expect(r.state.phase).toBe("bidding");
    expect(handSizes(r.state)).toEqual([5, 5, 5, 5]);
  });

  it("starts a match even when there is no game yet", () => {
    const r = reduce(null, { type: "match" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.scores).toEqual([0, 0]);
    expect(r.state.opener).toBe(0);
    expect(r.state.phase).toBe("bidding");
  });
});

/** Pass the bid for whoever is on turn. */
function passOnce(s: GameState): GameState {
  const r = reduce(s, { type: "bid", seat: s.turn, suit: null });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("reduce — bidding", () => {
  it("advances the turn on a pass", () => {
    const s = deal(0);
    const r = reduce(s, { type: "bid", seat: s.opener, suit: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("bidding");
    expect(r.state.turn).toBe(nextSeat(s.opener));
    expect(r.state.passes).toBe(1);
  });

  it("rejects a bid out of turn", () => {
    const s = deal(0);
    const r = reduce(s, { type: "bid", seat: nextSeat(s.opener), suit: null });
    expect(r).toEqual({ ok: false, error: "not your turn" });
  });

  it("takes the retourne suit in the first round and enters playing", () => {
    const s = deal(0);
    const r = reduce(s, { type: "bid", seat: s.opener, suit: s.trumpCard.suit });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("playing");
    expect(handSizes(r.state)).toEqual([8, 8, 8, 8]);
    expect(r.state.taker).toBe(s.opener);
    expect(r.state.trump).toBe(s.trumpCard.suit);
    expect(r.state.turn).toBe(s.opener); // opener leads
  });

  it("rejects taking a different suit in the first round", () => {
    const s = deal(0);
    const other = SUITS.find((x) => x !== s.trumpCard.suit)!;
    const r = reduce(s, { type: "bid", seat: s.opener, suit: other });
    expect(r).toEqual({ ok: false, error: "first round takes the turned-up suit" });
  });

  it("opens the second round after four passes", () => {
    let s = deal(0);
    for (let i = 0; i < 4; i++) s = passOnce(s);
    expect(s.phase).toBe("bidding");
    expect(s.biddingRound).toBe(2);
    expect(s.passes).toBe(0);
    expect(s.turn).toBe(s.opener);
  });

  it("takes a different suit in the second round", () => {
    let s = deal(0);
    const retourne = s.trumpCard.suit;
    for (let i = 0; i < 4; i++) s = passOnce(s);
    const other = SUITS.find((x) => x !== retourne)!;
    const r = reduce(s, { type: "bid", seat: s.opener, suit: other });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("playing");
    expect(r.state.trump).toBe(other);
    expect(r.state.taker).toBe(s.opener);
  });

  it("rejects taking the retourne suit in the second round", () => {
    let s = deal(0);
    const retourne = s.trumpCard.suit;
    for (let i = 0; i < 4; i++) s = passOnce(s);
    const r = reduce(s, { type: "bid", seat: s.opener, suit: retourne });
    expect(r).toEqual({
      ok: false,
      error: "second round must name a different suit",
    });
  });

  it("deals the next hand (rotating the opener) when everyone passes twice", () => {
    const start = { ...deal(0), scores: [50, 30] as [number, number] };
    let s = start;
    for (let i = 0; i < 8; i++) s = passOnce(s);
    expect(s.phase).toBe("bidding");
    expect(s.biddingRound).toBe(1);
    expect(s.opener).toBe(nextSeat(start.opener)); // dealer moves on
    expect(s.scores).toEqual([50, 30]); // scores carried over
    expect(handSizes(s)).toEqual([5, 5, 5, 5]);
  });

  it("does not mutate the input state", () => {
    const s = deal(0);
    const before = JSON.stringify(s);
    reduce(s, { type: "bid", seat: s.opener, suit: s.trumpCard.suit });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("reduce — play validation", () => {
  // A crafted mid-trick state: spades led, seat 1 to move holding a spade.
  const craftTrick = (): GameState => ({
    ...deal(0),
    phase: "playing",
    trump: "hearts" as Suit,
    taker: 0,
    turn: 1,
    hands: [
      [],
      [
        { suit: "spades", rank: "K" },
        { suit: "hearts", rank: "7" },
      ],
      [],
      [],
    ] as Card[][],
    currentTrick: [{ seat: 0, card: { suit: "spades", rank: "A" } }],
  });

  it("rejects a move that is out of turn", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 2,
      card: { suit: "spades", rank: "K" },
    });
    expect(r).toEqual({ ok: false, error: "not your turn" });
  });

  it("rejects a card the player does not hold", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 1,
      card: { suit: "clubs", rank: "A" },
    });
    expect(r).toEqual({ ok: false, error: "card not in hand" });
  });

  it("rejects an illegal move (not following suit)", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 1,
      card: { suit: "hearts", rank: "7" }, // must follow spades
    });
    expect(r).toEqual({ ok: false, error: "illegal move" });
  });

  it("accepts a legal move and advances the turn", () => {
    const r = reduce(craftTrick(), {
      type: "play",
      seat: 1,
      card: { suit: "spades", rank: "K" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.currentTrick).toHaveLength(2);
    expect(r.state.turn).toBe(2);
    expect(r.state.hands[1]).toHaveLength(1);
  });
});

describe("reduce — undo", () => {
  // Spades led by seat 0, then seat 1 followed: seat 1's card is on top.
  const craftTwoCardTrick = (): GameState => ({
    ...deal(0),
    phase: "playing",
    trump: "hearts" as Suit,
    taker: 0,
    turn: 2,
    hands: [[], [{ suit: "hearts", rank: "7" }], [], []] as Card[][],
    currentTrick: [
      { seat: 0, card: { suit: "spades", rank: "A" } },
      { seat: 1, card: { suit: "spades", rank: "K" } },
    ],
  });

  it("takes back the topmost card, returning it and rewinding the turn", () => {
    const r = reduce(craftTwoCardTrick(), { type: "undo", seat: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.currentTrick).toHaveLength(1);
    expect(r.state.turn).toBe(1);
    expect(r.state.hands[1]).toContainEqual({ suit: "spades", rank: "K" });
  });

  it("rejects taking back a card that is no longer on top", () => {
    const r = reduce(craftTwoCardTrick(), { type: "undo", seat: 0 });
    expect(r).toEqual({
      ok: false,
      error: "only the last card played can be taken back",
    });
  });

  it("rejects undo when the trick is empty", () => {
    const s: GameState = { ...craftTwoCardTrick(), currentTrick: [] };
    const r = reduce(s, { type: "undo", seat: 0 });
    expect(r).toEqual({ ok: false, error: "no card to take back" });
  });

  it("a play followed by its undo restores the trick, turn and hand", () => {
    const start = takeGame("undo-seed");
    const seat = start.turn;
    const legal = legalMoves(start.hands[seat], start.currentTrick, start.trump!, seat);
    const played = reduce(start, { type: "play", seat, card: legal[0] });
    if (!played.ok) throw new Error(played.error);
    const back = reduce(played.state, { type: "undo", seat });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.state.currentTrick).toEqual(start.currentTrick);
    expect(back.state.turn).toBe(seat);
    // The card returns to the hand (order is not significant — the UI sorts).
    const key = (c: Card) => `${c.suit}-${c.rank}`;
    const sorted = (h: Card[]) => h.map(key).sort();
    expect(sorted(back.state.hands[seat])).toEqual(sorted(start.hands[seat]));
  });

  // Spades led and followed by seats 0–2; seat 3 holds the last card.
  const craftThreeCardTrick = (): GameState => ({
    ...deal(0),
    phase: "playing",
    trump: "hearts" as Suit,
    taker: 0,
    turn: 3,
    hands: [[], [], [], [{ suit: "spades", rank: "7" }]] as Card[][],
    currentTrick: [
      { seat: 0, card: { suit: "spades", rank: "A" } },
      { seat: 1, card: { suit: "spades", rank: "K" } },
      { seat: 2, card: { suit: "spades", rank: "Q" } },
    ],
  });

  it("takes back a trick's fourth card while it still sits on the table", () => {
    const played = reduce(craftThreeCardTrick(), {
      type: "play",
      seat: 3,
      card: { suit: "spades", rank: "7" },
    });
    if (!played.ok) throw new Error(played.error);
    // The trick has resolved: nothing in progress, one completed trick.
    expect(played.state.currentTrick).toHaveLength(0);
    expect(played.state.tricks).toHaveLength(1);

    const back = reduce(played.state, { type: "undo", seat: 3 });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.state.currentTrick).toHaveLength(3);
    expect(back.state.tricks).toHaveLength(0);
    expect(back.state.turn).toBe(3);
    expect(back.state.hands[3]).toContainEqual({ suit: "spades", rank: "7" });
  });

  it("only the fourth seat may take a completed trick back", () => {
    const played = reduce(craftThreeCardTrick(), {
      type: "play",
      seat: 3,
      card: { suit: "spades", rank: "7" },
    });
    if (!played.ok) throw new Error(played.error);
    const back = reduce(played.state, { type: "undo", seat: 0 });
    expect(back).toEqual({
      ok: false,
      error: "only the last card played can be taken back",
    });
  });

  it("does not undo the final card once the hand is finished", () => {
    const finished = playToFinish(takeGame("77"));
    expect(finished.phase).toBe("finished");
    const lastTrick = finished.tricks[finished.tricks.length - 1];
    const fourthSeat = lastTrick.cards[lastTrick.cards.length - 1].seat;

    // The eighth trick's last card was forced, so there is nothing to take back.
    const back = reduce(finished, { type: "undo", seat: fourthSeat });
    expect(back).toEqual({ ok: false, error: "not in playing phase" });
  });
});

describe("reduce — replace", () => {
  // Spades led by seat 0, followed by seat 1; seat 1 still holds another spade.
  const craft = (): GameState => ({
    ...deal(0),
    phase: "playing",
    trump: "hearts" as Suit,
    taker: 0,
    turn: 2,
    hands: [
      [],
      [
        { suit: "spades", rank: "Q" },
        { suit: "hearts", rank: "7" },
      ],
      [],
      [],
    ] as Card[][],
    currentTrick: [
      { seat: 0, card: { suit: "spades", rank: "A" } },
      { seat: 1, card: { suit: "spades", rank: "K" } },
    ],
  });

  it("swaps the topmost played card for another legal one", () => {
    const r = reduce(craft(), {
      type: "replace",
      seat: 1,
      card: { suit: "spades", rank: "Q" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.currentTrick).toHaveLength(2);
    expect(r.state.currentTrick[1]).toEqual({
      seat: 1,
      card: { suit: "spades", rank: "Q" },
    });
    expect(r.state.turn).toBe(2);
    expect(r.state.hands[1]).toContainEqual({ suit: "spades", rank: "K" });
    expect(r.state.hands[1]).not.toContainEqual({ suit: "spades", rank: "Q" });
  });

  it("rejects swapping to an illegal card (must still follow suit)", () => {
    const r = reduce(craft(), {
      type: "replace",
      seat: 1,
      card: { suit: "hearts", rank: "7" }, // a spade is on hand, must follow
    });
    expect(r).toEqual({ ok: false, error: "illegal move" });
  });

  it("rejects a swap by a seat that does not own the topmost card", () => {
    const r = reduce(craft(), {
      type: "replace",
      seat: 0,
      card: { suit: "spades", rank: "A" },
    });
    expect(r).toEqual({
      ok: false,
      error: "only the last card played can be taken back",
    });
  });

  it("replaceOptions lists the legal swaps for the top card's owner", () => {
    const opts = replaceOptions(craft());
    // Seat 1 followed spades, so both spades are legal and the heart is not. The
    // played card itself is included; the UI omits it as it sits on the table.
    expect(opts).toContainEqual({ suit: "spades", rank: "Q" });
    expect(opts).toContainEqual({ suit: "spades", rank: "K" });
    expect(opts).not.toContainEqual({ suit: "hearts", rank: "7" });
  });

  it("replaceOptions is empty when no card has been played", () => {
    expect(replaceOptions({ ...craft(), currentTrick: [] })).toEqual([]);
  });
});

/** Deal (seeded) and have the opener take the retourne suit (enter playing). */
function takeGame(seed: string, opener: Seat = 0): GameState {
  const g = createGame(opener, makeRng(seed));
  const r = reduce(g, { type: "bid", seat: g.opener, suit: g.trumpCard.suit });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Drive a taken game to the finish, always playing the first legal card. */
function playToFinish(start: GameState): GameState {
  let state = start;
  let guard = 0;
  while (state.phase === "playing") {
    if (guard++ > 40) throw new Error("did not finish");
    const seat = state.turn;
    const legal = legalMoves(
      state.hands[seat],
      state.currentTrick,
      state.trump!,
      seat,
    );
    const r = reduce(state, { type: "play", seat, card: legal[0] });
    if (!r.ok) throw new Error(`unexpected rejection: ${r.error}`);
    state = r.state;
  }
  return state;
}

describe("reduce — a full hand", () => {
  it("plays eight tricks, scores once, and finishes", () => {
    const final = playToFinish(takeGame("42"));
    expect(final.phase).toBe("finished");
    expect(final.tricks).toHaveLength(8);
    expect(handSizes(final)).toEqual([0, 0, 0, 0]);
    expect(final.result).toBeDefined();

    // Cumulative scores equal this hand's points, which total 162 (no capot)
    // plus any belote bonus and any annonces awarded on top.
    const total = final.scores[0] + final.scores[1];
    const belote = final.result!.beloteTeam === null ? 0 : 20;
    const bonus = belote + final.result!.annoncePoints;
    expect(total - bonus).toBe(final.result!.capot ? 252 : 162);
    expect(final.scores).toEqual(final.result!.handPoints);
  });

  it("is deterministic for a given deal and taker", () => {
    const run = () => playToFinish(takeGame("77")).scores;
    expect(run()).toEqual(run());
  });

  it("rejects play once the hand is finished", () => {
    const final = playToFinish(takeGame("42"));
    const seat = final.tricks[7].winner;
    const r = reduce(final, {
      type: "play",
      seat,
      card: { suit: "hearts", rank: "7" },
    });
    expect(r.ok).toBe(false);
  });
});

describe("dealNext — gather and cut without reshuffling", () => {
  // A stable ordering, so two decks can be compared as multisets.
  const sortCards = (cards: Card[]) =>
    cards
      .slice()
      .sort(
        (a, b) =>
          SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) ||
          RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank),
      );

  // The 32 cards in the order they were dealt, reconstructed from a bidding-
  // phase state (3-then-2 packets per player, then the retourne and talon).
  const deckInDealOrder = (s: GameState): Card[] => {
    const deck: Card[] = [];
    for (let p = 0; p < 4; p++) deck.push(...s.hands[p].slice(0, 3));
    for (let p = 0; p < 4; p++) deck.push(...s.hands[p].slice(3, 5));
    deck.push(s.trumpCard, ...s.talon);
    return deck;
  };

  it("gathers a finished hand into team piles in play order", () => {
    const finished = playToFinish(takeGame("13"));
    const piles: [Card[], Card[]] = [[], []];
    for (const t of finished.tricks)
      for (const { card } of t.cards) piles[t.winner % 2].push(card);
    expect(gatherDeck(finished)).toEqual([...piles[0], ...piles[1]]);
  });

  it("deals the next hand from the very same 32 cards", () => {
    const finished = playToFinish(takeGame("13"));
    const next = reduce(finished, { type: "new" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(sortCards(deckInDealOrder(next.state))).toEqual(
      sortCards(gatherDeck(finished)),
    );
  });

  it("only cuts the gathered pack: the next deal is a rotation of it", () => {
    const finished = playToFinish(takeGame("13"));
    const gathered = gatherDeck(finished);
    // rng → 0 cuts a single card from the top to the bottom.
    const next = reduce(finished, { type: "new" }, () => 0);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(deckInDealOrder(next.state)).toEqual([
      ...gathered.slice(1),
      gathered[0],
    ]);
  });

  it("conserves all 32 cards when a hand is abandoned after the take", () => {
    const full = sortCards(createDeck());
    // Right after the take: trump dealt into a hand, talon emptied.
    const taken = takeGame("13");
    expect(sortCards(gatherDeck(taken))).toEqual(full);

    // And partway through play, with cards spread across tricks and hands.
    let s = taken;
    for (let i = 0; i < 5; i++) {
      const legal = legalMoves(s.hands[s.turn], s.currentTrick, s.trump!, s.turn);
      const r = reduce(s, { type: "play", seat: s.turn, card: legal[0] });
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(sortCards(gatherDeck(s))).toEqual(full);

    // So dealing the next hand from here still produces a valid 32-card deck.
    const next = reduce(s, { type: "new" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(sortCards(deckInDealOrder(next.state))).toEqual(full);
  });
});

describe("annoncesToReveal", () => {
  // The second trick (one trick complete), with seat 0 still holding a tierce.
  const craftSecondTrick = (): GameState => ({
    ...deal(0),
    phase: "playing",
    trump: "hearts" as Suit,
    taker: 0,
    turn: 0,
    hands: [
      [
        { suit: "spades", rank: "9" },
        { suit: "spades", rank: "10" },
        { suit: "spades", rank: "J" },
      ],
      [],
      [],
      [],
    ] as Card[][],
    currentTrick: [],
    tricks: [
      {
        winner: 0,
        cards: [
          { seat: 0, card: { suit: "hearts", rank: "7" } },
          { seat: 1, card: { suit: "hearts", rank: "8" } },
          { seat: 2, card: { suit: "hearts", rank: "9" } },
          { seat: 3, card: { suit: "hearts", rank: "10" } },
        ],
      },
    ],
  });

  it("reports a seat's annonces on the second trick", () => {
    const r = annoncesToReveal(craftSecondTrick(), 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.annonces[0].kind).toBe("tierce");
  });

  it("rejects a reveal outside the second trick", () => {
    const s = { ...craftSecondTrick(), tricks: [] };
    expect(annoncesToReveal(s, 0)).toEqual({
      ok: false,
      error: "annonces are shown on the second trick",
    });
  });

  it("rejects a reveal when the hand holds no annonce", () => {
    expect(annoncesToReveal(craftSecondTrick(), 1)).toEqual({
      ok: false,
      error: "no annonces to show",
    });
  });

  it("lets the same seat reveal again (the reveal is ephemeral)", () => {
    const s = craftSecondTrick();
    expect(annoncesToReveal(s, 0).ok).toBe(true);
    expect(annoncesToReveal(s, 0).ok).toBe(true);
  });
});
