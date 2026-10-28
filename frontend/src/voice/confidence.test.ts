import { expect, it } from "vitest";
import { evaluateVoiceConfidence } from "./confidence";

it("does not accept a mean rounded up to 1 when any individual word is below 1", () => {
  const words = [
    { word: "oui", conf: 1, start: 0, end: 0.2 },
    { word: "oui", conf: 1 - Number.EPSILON / 2, start: 0.2, end: 0.4 },
  ];
  expect(evaluateVoiceConfidence(words)).toEqual({ score: 1, accepted: false });
});
