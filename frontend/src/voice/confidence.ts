import type { VoskWord } from "./vosk";

/** Require exact word scores before display rounding; retain the mean for debugging. */
export function evaluateVoiceConfidence(words: readonly VoskWord[] = []): {
  score: number | null; accepted: boolean;
} {
  const valid = words.length > 0 && words.every(({ conf }) => Number.isFinite(conf) && conf >= 0 && conf <= 1);
  const score = valid ? words.reduce((total, { conf }) => total + conf, 0) / words.length : null;
  // A mean can round up to 1 in floating-point arithmetic. Require every word
  // to be exactly 1 at the game's strict cutoff.
  const accepted = valid && words.every(({ conf }) => conf === 1);
  return { score, accepted };
}
