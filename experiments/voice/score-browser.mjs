import { readFile, writeFile } from "node:fs/promises";

const directory = new URL("./", import.meta.url);
const { metadata, rows } = JSON.parse(await readFile(new URL("browser-results.json", directory), "utf8"));
const summary = [];
let report = "# Vosk WASM: static-browser benchmark\n\n";
report += `Browser: ${metadata.userAgent}\n\nCross-origin isolated: ${metadata.crossOriginIsolated}. `;
report += "The production-build smoke test checks that only same-origin static-file GET requests are made. No ASR server or audio upload is used.\n\n";
report += "The same 158 synthetic clips used by the Python comparison were decoded in the browser and passed through Vosk's WASM worker. ";
report += "Inference includes worker round trips and recognizer creation, excluding model loading and audio decoding. This is desktop Chrome, not an iPhone/iPad measurement.\n\n";
report += "| Decoder | Command clips correct | Non-command false activations | Median WASM inference |\n| --- | ---: | ---: | ---: |\n";
for (const engine of [...new Set(rows.map((row) => row.engine))]) {
  const group = rows.filter((row) => row.engine === engine);
  const positive = group.filter((row) => row.expected !== null);
  const negative = group.filter((row) => row.expected === null);
  const correct = positive.filter((row) => row.correct).length;
  const falseActivations = negative.filter((row) => row.predicted !== null).length;
  const sorted = group.map((row) => row.inference_ms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  summary.push({ engine, correct, command_total: positive.length,
    false_activations: falseActivations, negative_total: negative.length, median_ms: median });
  report += `| ${engine} | ${correct}/${positive.length} | ${falseActivations}/${negative.length} | ${median} ms |\n`;
}
report += "\n## Requested phrases\n\n| Decoder | Phrase | Correct |\n| --- | --- | ---: |\n";
for (const entry of summary) {
  for (const id of ["take-hearts", "take-hearts-plural", "no", "two"]) {
    const group = rows.filter((row) => row.engine === entry.engine && row.id === id);
    report += `| ${entry.engine} | ${group[0].phrase} | ${group.filter((row) => row.correct).length}/${group.length} |\n`;
  }
}
report += "\nAll transcripts are retained in browser-results.csv. These are synthetic smoke tests; false activations remain a concern, and real device/microphone trials are still required.\n";
await writeFile(new URL("BROWSER_RESULTS.md", directory), report);
await writeFile(new URL("browser-summary.json", directory), JSON.stringify({ metadata, summary }, null, 2) + "\n");
console.log(report);
