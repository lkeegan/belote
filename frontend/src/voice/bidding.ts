import type { Seat, Suit } from "../../../shared/game";
import { VoskMicrophone, canUseVoskMicrophone, type VoiceCapture } from "./microphone";
import { parseVoiceCommand, resolveVoiceBid, type BidContext, type VoiceCommand } from "./commands";
import { evaluateVoiceConfidence } from "./confidence";

export interface VoiceTurn extends BidContext { key: string; seat: Seat }
export type VoiceOutcome = "partial" | "unrecognized" | "unavailable" | "low-confidence" | "sent" | "ignored" | null;

/** Opt-in audio controls: only final commands from the current bidding turn act. */
export class VoiceBidding {
  readonly available = canUseVoskMicrophone();
  enabled = false;
  loading = false;
  listening = false;
  message = "Audio désactivé.";
  transcript = "";
  command: VoiceCommand | null = null;
  confidence: number | null = null;
  outcome: VoiceOutcome = null;
  private generation = 0;
  private seat: Seat | null = null;
  private armed: VoiceTurn | null = null;
  private submitted: string | null = null;
  private capture?: VoiceCapture;

  constructor(private options: {
    seat(): Seat | null;
    turn(): VoiceTurn | null;
    bid(seat: Seat, suit: Suit | null): void;
    changed(): void;
    createCapture?(): VoiceCapture;
  }) {}

  async start(): Promise<void> {
    if (this.enabled || !this.available || this.options.seat() === null) return;
    const generation = ++this.generation;
    this.seat = this.options.seat();
    this.enabled = this.loading = true;
    this.message = "Activation du microphone et chargement de Vosk (~42 Mo au premier accès)…";
    this.options.changed();
    const capture = this.capture = this.options.createCapture?.() ?? new VoskMicrophone();
    const current = () => this.enabled && generation === this.generation;
    try {
      await capture.start({
        partial: (key, text) => {
          if (!current() || !text || this.armed?.key !== key) return;
          this.transcript = text;
          this.command = null;
          this.confidence = null;
          this.outcome = "partial";
          this.options.changed();
        },
        final: (key, text, words) => {
          if (!current() || !text) return;
          this.transcript = text;
          this.command = parseVoiceCommand(text);
          const confidence = evaluateVoiceConfidence(words);
          this.confidence = confidence.score;
          const turn = this.options.turn();
          if (!turn || turn.key !== key || this.armed?.key !== key || this.submitted === key) {
            this.outcome = "ignored";
          } else {
            const bid = this.command ? resolveVoiceBid(this.command, turn) : null;
            if (!this.command) this.outcome = "unrecognized";
            else if (!bid) this.outcome = "unavailable";
            else if (!confidence.accepted) this.outcome = "low-confidence";
            else {
              // Disarm before sending: queued final events cannot submit twice.
              this.submitted = key;
              this.armed = null;
              this.listening = false;
              capture.listen(null);
              this.outcome = "sent";
              this.options.bid(turn.seat, bid.suit);
            }
          }
          this.update();
          this.options.changed();
        },
        error: (error) => { if (current()) this.fail(error); },
      });
      if (!current()) { capture.close(); return; }
      this.loading = false;
      this.update();
      this.options.changed();
    } catch (error) {
      if (current()) this.fail(error);
    }
  }

  update(): void {
    if (!this.enabled) return;
    if (this.options.seat() !== this.seat) { this.cancel(); return; }
    if (this.loading) return;
    const turn = this.options.turn();
    const next = turn && turn.key !== this.submitted ? turn : null;
    if (next?.key !== this.armed?.key) {
      this.armed = next;
      try { this.capture!.listen(next?.key ?? null); }
      catch (error) { this.fail(error); return; }
    }
    this.listening = next !== null;
    this.message = this.listening
      ? "Audio activé — à vous de parler."
      : "Audio activé — en attente de votre tour d’enchère.";
  }

  private fail(error: unknown): void {
    this.cancel();
    const name = error instanceof Error ? error.name : "";
    this.message = name === "NotAllowedError" ? "Microphone non autorisé." : `Audio : ${String(error)}`;
    this.options.changed();
  }

  cancel(): void {
    this.generation++;
    this.enabled = this.loading = this.listening = false;
    this.armed = null;
    this.submitted = null;
    this.capture?.close();
    this.capture = undefined;
    this.message = "Audio désactivé.";
    this.options.changed();
  }
}
