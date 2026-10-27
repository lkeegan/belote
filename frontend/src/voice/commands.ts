import type { Suit } from "../../../shared/game";

export type VoiceCommand = { kind: "pass"; word: "non" | "deux" }
  | { kind: "take"; suit: Suit | null };

export function normalizeFrench(text: string): string {
  return text.toLowerCase().replace(/œ/g, "oe").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ")
    .trim().replace(/\s+/g, " ");
}

const SUITS: Record<Suit, string[]> = {
  hearts: ["coeur", "coeurs", "keur"],
  diamonds: ["carreau", "carreaux", "caro", "karo"],
  clubs: ["trefle", "trefles", "tref", "treffe"],
  spades: ["pique", "piques", "pic", "pics"],
};

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])));
    }
    row = next;
  }
  return row[b.length];
}

/** Whole utterances only: a suit mentioned in table conversation is not a bid. */
export function parseVoiceCommand(text: string): VoiceCommand | null {
  const normalized = normalizeFrench(text);
  if (["non", "nan", "nom", "je passe", "passe"].includes(normalized))
    return { kind: "pass", word: "non" };
  if (["deux", "2", "d eux"].includes(normalized)) return { kind: "pass", word: "deux" };
  if (["oui", "ouais", "je prends", "je prend", "j prends", "jprends", "prends"].includes(normalized))
    return { kind: "take", suit: null };

  const suitText = normalized.replace(/^(?:je prends|je prend|j prends|jprends|prends|prendre) (?:a |au |aux )?/, "");
  if (!suitText || suitText.includes(" ")) return null;
  const exact = Object.entries(SUITS).filter(([, aliases]) => aliases.includes(suitText));
  if (exact.length === 1) return { kind: "take", suit: exact[0][0] as Suit };
  // A single edit on longer suit words; no fuzzy guesses for short pass/take words.
  if (suitText.length < 4) return null;
  const fuzzy = Object.entries(SUITS).filter(([, aliases]) =>
    aliases.some((alias) => alias.length > 3 && distance(suitText, alias) === 1));
  return fuzzy.length === 1 ? { kind: "take", suit: fuzzy[0][0] as Suit } : null;
}

export interface BidContext { round: 1 | 2; turnedSuit: Suit }

/** Keep voice input subject to exactly the same bidding choices as the buttons. */
export function resolveVoiceBid(command: VoiceCommand, context: BidContext): { suit: Suit | null } | null {
  if (command.kind === "pass") {
    return command.word === "deux" && context.round === 1 ? null : { suit: null };
  }
  const suit = command.suit ?? (context.round === 1 ? context.turnedSuit : null);
  if (!suit || (context.round === 1 ? suit !== context.turnedSuit : suit === context.turnedSuit)) return null;
  return { suit };
}
