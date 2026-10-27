// Score acoustic output with the exact parser used by the game and browser lab.
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { cpus } from "node:os";
import { createHash } from "node:crypto";
import { parseVoiceCommand } from "../../frontend/src/voice/commands.ts";

const directory = new URL("./", import.meta.url);
const data = JSON.parse(await readFile(new URL("results.json", directory), "utf8"));
const corpus = JSON.parse(await readFile(new URL("corpus.json", directory), "utf8"));
const audioHashes = new Map(await Promise.all([...new Set(data.rows.map((row) => row.file))].map(async (file) =>
  [file, createHash("sha256").update(await readFile(new URL(`audio/${file}`, directory))).digest("hex")])));
const rows = data.rows.map((row) => {
  const predicted = parseVoiceCommand(row.text);
  // `phrase` is the spoken source; `text` is the recognizer's raw transcript.
  return { ...row, phrase: row.phrase ?? corpus.find((sample) => sample.id === row.id)?.text ?? "",
    audio_sha256: audioHashes.get(row.file), predicted, correct: isDeepStrictEqual(predicted, row.expected) };
});
const percent = (count, total) => total ? `${(100 * count / total).toFixed(1)}%` : "—";
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = [];
let markdown = "# French bidding recognition — synthetic benchmark\n\n";
markdown += "Two Piper voices, 26 phrases each, clean / faster / 15 dB added white noise, plus silence and noise-only. ";
markdown += "Inference times are warm CPU Python measurements, excluding audio decoding, model loading and network. ";
markdown += "These are not browser/iPhone latency measurements or human-speech accuracy estimates.\n\n";
markdown += "| Engine | Command clips correct | Non-command false activations | Median inference |\n| --- | ---: | ---: | ---: |\n";
for (const engine of [...new Set(rows.map((row) => row.engine))]) {
  const group = rows.filter((row) => row.engine === engine);
  const positive = group.filter((row) => row.expected !== null);
  const negative = group.filter((row) => row.expected === null);
  const correct = positive.filter((row) => row.correct).length;
  const falseActivations = negative.filter((row) => row.predicted !== null).length;
  const latency = median(group.map((row) => row.inference_ms));
  summary.push({ engine, command_correct: correct, command_total: positive.length,
    false_activations: falseActivations, negative_total: negative.length, median_inference_ms: latency });
  markdown += `| ${engine} | ${correct}/${positive.length} (${percent(correct, positive.length)}) | ${falseActivations}/${negative.length} (${percent(falseActivations, negative.length)}) | ${latency} ms |\n`;
}
markdown += "\n## By condition\n\n| Engine | Condition | Correct commands | False activations |\n| --- | --- | ---: | ---: |\n";
for (const entry of summary) {
  for (const condition of [...new Set(rows.map((row) => row.condition))]) {
    const group = rows.filter((row) => row.engine === entry.engine && row.condition === condition);
    const positive = group.filter((row) => row.expected !== null);
    const negative = group.filter((row) => row.expected === null);
    markdown += `| ${entry.engine} | ${condition} | ${positive.filter((row) => row.correct).length}/${positive.length} | ${negative.filter((row) => row.predicted !== null).length}/${negative.length} |\n`;
  }
}
markdown += "\n## Failures to inspect\n\nAll errors are retained in results.csv. Selected clean cases:\n\n";
for (const entry of summary) {
  const failures = rows.filter((row) => row.engine === entry.engine && row.condition === "clean" && !row.correct);
  markdown += `### ${entry.engine}\n\n`;
  for (const row of failures.slice(0, 10)) {
    markdown += `- ${row.voice}, ${row.id}: transcript ${JSON.stringify(row.text)} → ${JSON.stringify(row.predicted)}; expected ${JSON.stringify(row.expected)}.\n`;
  }
  if (!failures.length) markdown += "No clean failures.\n";
  markdown += "\n";
}
markdown += "## Limits\n\n- Only two synthetic voices, not held-out human speakers, accents, room acoustics or overlapping conversation.\n";
markdown += "- White noise is not a substitute for a real family/table recording.\n- Grammar constraints can turn unrelated speech into plausible commands, even with `[unk]`.\n";
markdown += "- No confidence cutoff was tuned; engine confidences are not interchangeable.\n- Native browser recognition needs testing with real Safari/Chrome devices and was not measured here.\n";
markdown += "- Game turn/round validation further restricts actions; these metrics deliberately measure parsing before that validation.\n";
const columns = ["engine", "voice", "condition", "id", "file", "audio_sha256", "seconds", "phrase", "text", "expected", "predicted", "correct", "confidence", "inference_ms"];
const cell = (value) => `"${String(typeof value === "object" ? JSON.stringify(value) : value ?? "").replaceAll('"', '""')}"`;
const csv = [columns.join(","), ...rows.map((row) => columns.map((key) => cell(row[key])).join(","))].join("\n") + "\n";
await writeFile(new URL("results.csv", directory), csv);
await writeFile(new URL("RESULTS.md", directory), markdown);
await writeFile(new URL("summary.json", directory), JSON.stringify({ ...data.metadata,
  processor: data.metadata.processor || cpus()[0]?.model, summary }, null, 2) + "\n");
console.log(markdown.split("## By condition")[0]);
