import type { Annonce, Card, GameState, Seat, Suit } from "./game";

/** Public state: only the undealt talon is server-only in this trust-based game. */
export type ClientState = Omit<GameState, "talon"> & {
  legal: Card[];
  replaceLegal: Card[];
  canShowAnnonces: boolean[];
};

export interface ActionBodies {
  "/new": { dealId: number };
  "/new-match": { dealId: number };
  "/bid": { seat: Seat; suit: Suit | null };
  "/play": { seat: Seat; card: Card };
  "/undo": { seat: Seat };
  "/replace": { seat: Seat; card: Card };
  "/show-annonces": { seat: Seat };
}

export type ClientMessage = {
  [P in keyof ActionBodies]: { path: P; body: ActionBodies[P] };
}[keyof ActionBodies];

export interface Reveal { seat: Seat; annonces: Annonce[] }
export type ServerMessage = ClientState | { error: string } | { reveal: Reveal };
