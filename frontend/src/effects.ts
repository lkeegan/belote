// Celebration effects shown over the round-summary box: confetti when the
// contract is made, rain when it falls (dedans), and a nuclear explosion on a
// capot. All are purely decorative, draw over everything with pointer-events
// disabled, and run until cleared (when the next hand is dealt).

import confetti from "canvas-confetti";

// The single effect overlay (rain/explosion live here; confetti draws on its
// own canvas), plus the handles needed to tear the running effect down.
let overlay: HTMLElement | null = null;
let confettiInterval = 0;
let loopTimer = 0;

/** Stop and remove any running effect, leaving a clean slate for the next one. */
export function clearEffect(): void {
  if (confettiInterval) {
    clearInterval(confettiInterval);
    confettiInterval = 0;
  }
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = 0;
  }
  confetti.reset();
  overlay?.remove();
  overlay = null;
}

/** Play the effect that fits a finished hand's outcome. */
export function playResultEffect(result: { madeContract: boolean; capot: boolean }): void {
  clearEffect();
  if (result.capot) nuke();
  else if (result.madeContract) confettiFall();
  else rain();
}

/** A full-screen, click-through layer to mount drops and the explosion into. */
function makeOverlay(kind: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `fx fx-${kind}`;
  document.body.appendChild(el);
  return el;
}

/** Fade the current overlay out after `ms`, so the effect settles like the
 *  confetti does rather than running forever. */
function fadeOverlayAfter(ms: number): void {
  loopTimer = window.setTimeout(() => overlay?.classList.add("fx-fade"), ms);
}

// A heavy fall of confetti streaming down from the top edge.
function confettiFall(): void {
  const colors = ["#f5c542", "#7ac8ff", "#ff5e7e", "#5ee08a", "#ffffff"];
  const stopAt = Date.now() + 4500;
  confettiInterval = window.setInterval(() => {
    confetti({
      particleCount: 14,
      startVelocity: 0,
      ticks: 360,
      gravity: 2.4,
      spread: 170,
      scalar: 1,
      origin: { x: Math.random(), y: -0.1 },
      colors,
      disableForReducedMotion: true,
    });
    if (Date.now() > stopAt) {
      clearInterval(confettiInterval);
      confettiInterval = 0;
    }
  }, 110);
}

// A field of falling raindrops that fades out after a few seconds.
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
  fadeOverlayAfter(4000);
  return overlay;
}

// A single nuclear explosion: a blinding flash, an expanding ground shockwave,
// a rising stem and a billowing mushroom cap built from overlapping blobs.
function nuke(): void {
  overlay = makeOverlay("nuke");
  overlay.innerHTML = `
    <div class="nuke-flash"></div>
    <div class="nuke-shock"></div>
    <div class="nuke-column">
      <div class="nuke-stem"></div>
      <div class="nuke-head">
        <span class="billow smoke b-top1"></span>
        <span class="billow smoke b-top2"></span>
        <span class="billow b-left"></span>
        <span class="billow b-right"></span>
        <span class="billow b-mid"></span>
        <span class="billow b-core"></span>
      </div>
    </div>`;
  fadeOverlayAfter(750);
}
