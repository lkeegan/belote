import { describe, it, expect } from "vitest";
import { SUITS, RANKS } from "./deck";

describe("card vocabulary", () => {
  it("has four distinct suits", () => {
    expect(SUITS).toHaveLength(4);
    expect(new Set(SUITS).size).toBe(4);
  });

  it("has eight distinct ranks", () => {
    expect(RANKS).toHaveLength(8);
    expect(new Set(RANKS).size).toBe(8);
  });
});
