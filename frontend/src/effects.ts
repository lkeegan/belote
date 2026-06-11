// Weather and celebration effects shown over the round-summary box: confetti
// when the contract is made, rain when it falls (dedans), and a full storm —
// rain, lightning and thunder — on a capot. All are purely decorative, draw
// over everything with pointer-events disabled, and run until cleared (when the
// next hand is dealt).

import confetti from "canvas-confetti";

// The single effect overlay (rain/lightning live here; confetti draws on its
// own canvas), plus the handles needed to tear the running effect down.
let overlay: HTMLElement | null = null;
let confettiInterval = 0;
let strikeTimer = 0;
let audioCtx: AudioContext | null = null;

/** Stop and remove any running effect, leaving a clean slate for the next one. */
export function clearEffect(): void {
  if (confettiInterval) {
    clearInterval(confettiInterval);
    confettiInterval = 0;
  }
  if (strikeTimer) {
    clearTimeout(strikeTimer);
    strikeTimer = 0;
  }
  confetti.reset();
  overlay?.remove();
  overlay = null;
}

/** Play the effect that fits a finished hand's outcome. */
export function playResultEffect(result: { madeContract: boolean; capot: boolean }): void {
  clearEffect();
  if (result.capot) storm();
  else if (result.madeContract) confettiFall();
  else rain();
}

/** A full-screen, click-through layer to mount drops and flashes into. */
function makeOverlay(kind: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `fx fx-${kind}`;
  document.body.appendChild(el);
  return el;
}

// Confetti streaming down from the top edge for a few seconds.
function confettiFall(): void {
  const colors = ["#f5c542", "#7ac8ff", "#ff5e7e", "#5ee08a", "#ffffff"];
  const stopAt = Date.now() + 4000;
  confettiInterval = window.setInterval(() => {
    confetti({
      particleCount: 5,
      startVelocity: 0,
      ticks: 320,
      gravity: 0.6,
      spread: 140,
      scalar: 0.95,
      origin: { x: Math.random(), y: -0.1 },
      colors,
      disableForReducedMotion: true,
    });
    if (Date.now() > stopAt) {
      clearInterval(confettiInterval);
      confettiInterval = 0;
    }
  }, 180);
}

// A field of falling raindrops. Returns the overlay so the storm can build on it.
function rain(count = 150): HTMLElement {
  overlay = makeOverlay("rain");
  for (let i = 0; i < count; i++) {
    const drop = document.createElement("span");
    drop.className = "raindrop";
    drop.style.left = `${Math.random() * 100}vw`;
    drop.style.animationDelay = `${Math.random() * 1.2}s`;
    drop.style.animationDuration = `${0.5 + Math.random() * 0.45}s`;
    overlay.appendChild(drop);
  }
  return overlay;
}

// Rain plus periodic lightning flashes and thunder.
function storm(): void {
  const el = rain(200);
  el.classList.add("fx-storm");

  const flash = document.createElement("div");
  flash.className = "lightning";
  el.appendChild(flash);

  const strike = (): void => {
    // Restart the flash animation from the top (re-adding the class won't
    // replay it without forcing a reflow first).
    flash.classList.remove("flash");
    void flash.offsetWidth;
    flash.classList.add("flash");
    thunder();
    strikeTimer = window.setTimeout(strike, 1600 + Math.random() * 2600);
  };
  strike();
}

// A synthesised thunder clap: a burst of low-passed noise that decays away. Kept
// asset-free; best-effort, since the browser may block audio without a gesture.
function thunder(): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();

    const duration = 1.3;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** 2; // decaying noise
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 380;
    const gain = ctx.createGain();
    gain.gain.value = 0.55;
    src.connect(lowpass).connect(gain).connect(ctx.destination);
    src.start();
  } catch {
    // No audio available — the visuals carry the effect on their own.
  }
}
