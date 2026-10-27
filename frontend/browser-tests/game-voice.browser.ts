import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { createGame } from "../../worker/src/game/state";
import { makeRng } from "../../worker/src/game/deck";

test.use({
  channel: "chromium", // full browser/new headless mode, including microphone capture
  permissions: ["microphone"],
  reducedMotion: "reduce",
  launchOptions: { args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fileURLToPath(new URL("./audio/microphone.wav", import.meta.url))}`,
  ] },
});

test("Vosk microphone controls bid in the real game and show the detected text", async ({ page }) => {
  const state = createGame(0, makeRng("voice-game"));
  state.trumpCard = { suit: "hearts", rank: "7" };
  const { talon, ...publicState } = state;
  const initial = { ...publicState, legal: [], replaceLegal: [], canShowAnnonces: [false, false, false, false] };
  // Keep the real game UI/audio pipeline; replace only its multiplayer transport.
  await page.addInitScript((initial) => {
    const app = globalThis as typeof globalThis & {
      voiceTestSent: unknown[];
      voiceTestTracks: MediaStreamTrack[];
    };
    app.voiceTestSent = [];
    app.voiceTestTracks = [];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      app.voiceTestTracks.push(...stream.getTracks());
      return stream;
    };
    class Socket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      constructor() {
        super();
        setTimeout(() => {
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(initial) }));
        }, 0);
      }
      send(text: string) { app.voiceTestSent.push(JSON.parse(text)); }
      close() { this.readyState = 3; }
    }
    Object.assign(globalThis, { WebSocket: Socket });
  }, initial);
  const requests: { method: string; url: string }[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  page.on("pageerror", (error) => console.log(`[game error] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[game console] ${message.text()}`);
  });
  await page.goto("./");
  await page.locator(".seat-pick").first().click();
  const button = page.locator("#voice-bid");
  await expect(button).toHaveText("🎙 Activer l’audio");
  expect(await page.evaluate(() => (globalThis as any).voiceTestTracks.length)).toBe(0);
  expect(requests.some((request) => /assets\/vosk-|models\/vosk-/.test(request.url))).toBe(false);
  await button.click();
  await expect.poll(async () => ({
    enabled: await button.getAttribute("aria-pressed"),
    status: await page.locator("#voice-msg").innerText(),
  })).toMatchObject({ enabled: "true" }).catch(async (error) => {
    console.log("Audio activation:", await page.locator("#voice-msg").innerText());
    throw error;
  });
  await expect(page.locator("#voice-msg")).toHaveText("Audio activé — à vous de parler.", { timeout: 120000 });
  await expect.poll(() => page.evaluate(() => (globalThis as any).voiceTestSent), { timeout: 60000 }).toEqual([
    { path: "/bid", body: { seat: 0, suit: "hearts" } },
  ]);
  await expect(page.locator("#voice-transcript")).toContainText("prends");
  await expect(page.locator("#voice-match")).toHaveText("Reconnu : prend à cœur — envoyé");
  await expect(page.locator("#voice-msg")).toContainText("en attente");
  // The authoritative state has not advanced: another utterance cannot bid again.
  expect(await page.evaluate(() => (globalThis as any).voiceTestSent.length)).toBe(1);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => (globalThis as any).voiceTestTracks.every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
  await expect(page.locator("#voice-transcript")).toContainText("prends");
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(requests.every((request) => request.url.startsWith("http://127.0.0.1:4175/") || request.url.startsWith("blob:"))).toBe(true);
});
