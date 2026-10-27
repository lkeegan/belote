// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearEffect, playResultEffect } from "./effects";

vi.mock("canvas-confetti", () => ({ default: Object.assign(vi.fn(), { reset: vi.fn() }) }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearEffect();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("removes rain and its infinite animations after the fade", () => {
  playResultEffect({ capot: false, madeContract: false });
  expect(document.querySelectorAll(".raindrop")).toHaveLength(150);
  vi.advanceTimersByTime(4000);
  expect(document.querySelector(".fx")?.classList.contains("fx-fade")).toBe(true);
  vi.advanceTimersByTime(850);
  expect(document.querySelector(".fx")).toBeNull();
});

it("cancels a fading effect without removing its replacement", () => {
  playResultEffect({ capot: false, madeContract: false });
  vi.advanceTimersByTime(4000);
  playResultEffect({ capot: true, madeContract: true });
  vi.advanceTimersByTime(850);
  expect(document.querySelector(".fx-nuke")).not.toBeNull();
  vi.advanceTimersByTime(750);
  expect(document.querySelector(".fx")).toBeNull();
});
