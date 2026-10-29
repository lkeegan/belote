// Eight spoken commands, plus Vosk's unknown-speech marker.
export const VOSK_GRAMMAR: readonly string[] = Object.freeze([
  "oui", "prends", "non", "deux", "cœur", "piques", "carreaux", "trèfles",
  "[unk]", // Keep an unknown-speech path rather than forcing every sound into a command.
]);
