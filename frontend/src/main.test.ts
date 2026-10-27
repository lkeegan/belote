// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import html from "../index.html?raw";
import { createGame, reduce } from "../../worker/src/game/state";
import { makeRng } from "../../worker/src/game/deck";
import { legalMoves } from "../../worker/src/game/rules";
import type { GameState } from "../../shared/game";
import type { ClientState } from "../../shared/protocol";
import { TestSocket } from "./test-socket";

vi.mock("./effects", () => ({ clearEffect: vi.fn(), playResultEffect: vi.fn() }));

const initial = () => createGame(0, makeRng("frontend"));
function clientState(state: GameState): ClientState {
  const { talon, ...rest } = state;
  return {
    ...rest,
    legal: state.trump ? legalMoves(state.hands[state.turn], state.currentTrick, state.trump, state.turn) : [],
    replaceLegal: [],
    canShowAnnonces: [false, false, false, false],
  };
}
const socket = () => TestSocket.instances[TestSocket.instances.length - 1];
const pickSeat = () => document.querySelector<HTMLButtonElement>(".seat-pick")!.click();

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  TestSocket.instances = [];
  vi.stubGlobal("WebSocket", TestSocket);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  document.body.innerHTML = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  await import("./main");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("renders seats before receiving state and shows offline/loading views", () => {
  expect(document.querySelectorAll(".seat-pick")).toHaveLength(4);
  socket().close();
  expect(document.querySelectorAll(".seat-pick")).toHaveLength(4);
  pickSeat();
  expect(document.querySelector(".empty-msg")?.textContent).toContain("hors ligne");
  vi.advanceTimersByTime(1000);
  socket().open();
  expect(document.querySelector(".empty-msg")?.textContent).toContain("Connexion");
});

it("cancels a running deal immediately when another player takes", async () => {
  const bidding = initial();
  socket().open();
  socket().message(clientState(bidding));
  pickSeat();
  expect(document.querySelector(".bid-controls")).toBeNull();
  expect(document.querySelector<HTMLButtonElement>("#change-seat")!.hidden).toBe(false);
  const taken = reduce(bidding, { type: "bid", seat: 0, suit: bidding.trumpCard.suit });
  if (!taken.ok) throw new Error(taken.error);
  socket().message(clientState(taken.state));
  expect(document.querySelectorAll("button.card.playable")).toHaveLength(8);
  await vi.advanceTimersByTimeAsync(15000);
  expect(document.querySelectorAll("button.card.playable")).toHaveLength(8);
  expect(document.querySelector(".retourne")).toBeNull();
});

it("uses native card buttons and preserves focus across broadcasts", () => {
  const bidding = initial();
  const taken = reduce(bidding, { type: "bid", seat: 0, suit: bidding.trumpCard.suit });
  if (!taken.ok) throw new Error(taken.error);
  socket().open();
  socket().message(clientState(taken.state));
  pickSeat();
  const card = document.querySelector<HTMLButtonElement>("button.card.playable")!;
  expect(card.type).toBe("button");
  expect(card.getAttribute("aria-label")).toBeTruthy();
  card.focus();
  socket().message(clientState(taken.state));
  const replacement = document.activeElement as HTMLButtonElement;
  expect(replacement).not.toBe(card);
  expect(replacement.dataset.focusKey).toBe(card.dataset.focusKey);
  replacement.click();
  const action = JSON.parse(socket().sent[0]);
  expect(action).toMatchObject({ path: "/play", body: { seat: 0 } });
  const played = reduce(taken.state, { type: "play", ...action.body });
  if (!played.ok) throw new Error(played.error);
  socket().message(clientState(played.state));
  expect((document.activeElement as HTMLElement).dataset.focusKey).toBe(card.dataset.focusKey);
  const next = played.state;
  const reply = reduce(next, {
    type: "play", seat: next.turn,
    card: legalMoves(next.hands[next.turn], next.currentTrick, next.trump!, next.turn)[0],
  });
  if (!reply.ok) throw new Error(reply.error);
  socket().message(clientState(reply.state));
  expect(document.activeElement?.matches("button.card.premoveable")).toBe(true);
});

it("animates a new deal ID even with the same opener and retourne", async () => {
  const bidding = initial();
  socket().open();
  socket().message(clientState(bidding));
  pickSeat();
  await vi.advanceTimersByTimeAsync(15000);
  expect(document.querySelector(".bid-controls")).not.toBeNull();
  socket().message(clientState({ ...bidding, dealId: bidding.dealId + 1 }));
  expect(document.querySelector(".bid-controls")).toBeNull();
});
