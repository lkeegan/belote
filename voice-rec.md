# Browser Speech Recognition Command Plan

Use the browser's native `SpeechRecognition` / `webkitSpeechRecognition` API with `lang = "fr-FR"` to capture short French speech commands. Treat the recognizer output as raw text, then map it locally to a small fixed command set with deterministic fuzzy matching.

Canonical commands:

- `oui`
- `non`
- `deux`
- `carreau`
- `coeur`
- `pique`
- `trefle`

Alias mapping:

- `oui`: `oui`, `ouais`, `wi`, `we`, `je prends`, `je prend`, `je prends a`, `je prends à`, `j prends`, `jprends`, `prends`, `prendre`
- `non`: `non`, `nan`, `nom`
- `deux`: `deux`, `de`, `d eux`, `2`
- `carreau`: `carreau`, `carreaux`, `caro`, `carreau rouge`, `karo`
- `coeur`: `coeur`, `coeurs`, `cœur`, `cœurs`, `keur`
- `pique`: `pique`, `piques`, `pic`, `pics`
- `trefle`: `trefle`, `trefles`, `trèfle`, `trèfles`, `tref`, `treffe`

Matching process:

1. Normalize recognized text: lowercase, strip accents, remove punctuation, collapse whitespace.
2. Check for exact token-sequence matches against aliases.
3. For multi-word aliases, allow fuzzy token-by-token matching.
4. For single-token aliases longer than three characters, allow Levenshtein distance:
   - max distance `1` for short/medium tokens
   - max distance `2` for tokens of length six or more
5. Do not fuzzy-match tokens of length three or less, to avoid false positives for short commands like `oui`, `non`, and `de`.

Expected behavior:

- `oui`, `ouais`, or similar maps to `oui`.
- `je prends`, `je prends à pique`, or similar maps to `oui`.
- Suit words in longer phrases also map to their suit, so `je prends à piques` can produce `oui + pique`.
- Raw transcription is preserved separately from recognized command output for debugging and tuning.
