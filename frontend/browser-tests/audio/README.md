# Synthetic French browser-test recordings

Generated with Piper and the French SIWIS medium voice, resampled to mono
16 kHz PCM with 0.2 s leading and 0.5 s trailing silence. No human recordings.

- `take-hearts.wav`: “Je prends à cœurs.”
- `non.wav`: “Non.”
- `deux.wav`: “Deux.”
- `greeting.wav`: “Bonjour tout le monde.”
- `microphone.wav`: the take-at-hearts phrase with seven seconds of silence on
  either side, for Chrome's fake microphone while the model loads.

Generation script: `experiments/voice/synthesize.py`. The pinned model revision
is recorded in `experiments/voice/summary.json`.

[Piper](https://github.com/OHF-Voice/piper1-gpl) and
[SIWIS model card](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD).
The model card credits the SIWIS corpus and its CC-BY 4.0 dataset license.
