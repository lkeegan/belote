import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseVoiceCommand } from "../src/voice/commands";

test("Vosk recognises French WAVs using only static files, without isolation headers", async ({ page }) => {
  const requests: { url: string; method: string }[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[browser error] ${message.text()}`);
  });
  page.on("pageerror", (error) => console.log(`[browser error] ${error.message}`));
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.goto("voice.html");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await page.locator("#engine").selectOption("vosk-grammar");
  await page.locator("#load-model").click();
  await expect(page.locator("#status")).not.toContainText("Chargement", { timeout: 120000 });
  await expect(page.locator("#status")).toHaveText("Modèle Vosk prêt sur cet appareil.");
  for (const [file, command] of [
    ["take-hearts.wav", { kind: "take", suit: "hearts" }],
    ["non.wav", { kind: "pass", word: "non" }],
    ["deux.wav", { kind: "pass", word: "deux" }],
    ["greeting.wav", null],
  ] as const) {
    await page.locator("#audio-file").setInputFiles(fileURLToPath(new URL(`./audio/${file}`, import.meta.url)));
    await expect(page.locator("#status")).toHaveText("Terminé.", { timeout: 60000 });
    const parsed = JSON.parse(await page.locator("#command").innerText());
    expect(parsed.command, await page.locator("#transcript").innerText()).toEqual(command);
  }
  // Reload without allowing another model download: IndexedDB must supply it.
  await page.route("**/models/*.tar.gz", (route) => route.abort());
  await page.reload();
  await page.locator("#engine").selectOption("vosk-grammar");
  await page.locator("#load-model").click();
  await expect(page.locator("#status")).not.toContainText("Chargement", { timeout: 120000 });
  await expect(page.locator("#status")).toHaveText("Modèle Vosk prêt sur cet appareil.");
  expect(requests.some((request) => request.url.endsWith("vosk-model-small-fr-0.22.tar.gz"))).toBe(true);
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(requests.every((request) => request.url.startsWith("http://127.0.0.1:4175/") || request.url.startsWith("blob:"))).toBe(true);
});

test("benchmark both WASM decoders against the generated corpus", async ({ page }) => {
  test.skip(process.env.VOICE_BENCHMARK !== "1", "Run explicitly after generating the synthetic corpus");
  test.setTimeout(900000);
  const directory = new URL("../../experiments/voice/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("audio/manifest.json", directory), "utf8"));
  const rows = [];
  await page.goto("voice.html");
  await page.locator("#engine").selectOption("vosk-grammar");
  await page.locator("#load-model").click();
  await expect(page.locator("#status")).toHaveText("Modèle Vosk prêt sur cet appareil.", { timeout: 120000 });
  for (const engine of ["vosk-grammar", "vosk-free"]) {
    await page.locator("#engine").selectOption(engine);
    for (const sample of manifest) {
      await page.locator("#audio-file").setInputFiles(fileURLToPath(new URL(`audio/${sample.file}`, directory)));
      await expect(page.locator("#status")).toHaveText("Terminé.", { timeout: 60000 });
      const text = await page.locator("#transcript").innerText();
      const timing = await page.locator("#timing").innerText();
      const predicted = parseVoiceCommand(text === "(aucune transcription)" ? "" : text);
      rows.push({ ...sample, phrase: sample.text, engine: `${engine}-wasm`, text,
        predicted, inference_ms: Number(timing.match(/dont (\d+) ms/)?.[1]),
        correct: JSON.stringify(predicted) === JSON.stringify(sample.expected) });
      if (rows.length % 40 === 0) console.log(`WASM benchmark: ${rows.length}/${manifest.length * 2}`);
    }
  }
  const metadata = await page.evaluate(() => ({ userAgent: navigator.userAgent, crossOriginIsolated }));
  await writeFile(new URL("browser-results.json", directory), JSON.stringify({ metadata, rows }, null, 2) + "\n");
  const columns = ["engine", "voice", "condition", "id", "phrase", "text", "expected", "predicted", "correct", "inference_ms"];
  const cell = (value: unknown) => `"${String(typeof value === "object" ? JSON.stringify(value) : value ?? "").replaceAll('"', '""')}"`;
  await writeFile(new URL("browser-results.csv", directory), [columns.join(","),
    ...rows.map((row) => columns.map((key) => cell(row[key])).join(","))].join("\n") + "\n");
});
