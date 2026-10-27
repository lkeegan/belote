import type { Annonce, Card, Seat } from "../../shared/game";
import type { ClientState as GameState, Reveal } from "../../shared/protocol";

interface TableView {
  table: HTMLElement;
  corners: readonly string[];
  getState(): GameState | null;
  getSeat(): Seat | null;
  render(): void;
  renderQuadrant(seat: Seat, state: GameState): HTMLElement;
  renderBack(): HTMLElement;
  renderCard(card: Card, options: { trump: boolean }): HTMLElement;
}

/** Owns transient table DOM; authoritative state remains with the application. */
export function createTableAnimations(view: TableView) {
  const { table, corners: CORNERS, getState, getSeat, render, renderQuadrant, renderBack, renderCard } = view;
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

  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

  const prefersReducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  /**
   * A signature that is stable across one deal's whole bidding (bids don't change
   * the hands or the turned-up card) but differs for the next deal, so each fresh
   * deal animates exactly once. Null outside bidding.
   */
  function dealSignature(s: GameState | null): string | null {
    if (!s || s.phase !== "bidding") return null;
    return String(s.dealId);
  }

  /**
   * Decide what to do with freshly arrived (or seat-changed) state: animate a
   * brand-new deal, let a running deal animation continue, or — once the game has
   * moved on — tear any animation down and render normally.
   */
  function handleDeal(): void {
    const state = getState();
    const mySeat = getSeat();
    const sig = dealSignature(state);
    if (sig === null) {
      animatedDealSig = null;
      if (dealing) cancelTableAnim();
      render();
      return;
    }
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
    render(); // update seat/title controls before the animation owns the table
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
    for (let seat = 0; seat < CORNERS.length; seat++) {
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
      for (let i = 0; i < CORNERS.length; i++) {
        const seat = ((s.opener + i) % CORNERS.length) as Seat;
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
    const mySeat = getSeat();
    for (let seat = 0; seat < CORNERS.length; seat++) {
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
    const state = getState();
    return (
      !!prev &&
      !!state &&
      state.phase === "playing" &&
      state.dealId === prev.dealId &&
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
    const state = getState();
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
    if (getSeat() === null) return;
    cancelTableAnim(); // clear any deal/sweep/reveal so this reveal owns the table
    reveal = r;
    render();
    revealTimer = window.setTimeout(() => {
      revealTimer = null;
      reveal = null;
      render(); // everything reverts to as it was before the button was pressed
    }, REVEAL_MS);
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

  return {
    get dealing() { return dealing; },
    get sweeping() { return sweeping; },
    get reveal(): Reveal | null { return reveal; },
    cancel: cancelTableAnim,
    handleDeal,
    sweepNeeded,
    startSweep,
    showReveal,
  };
}
