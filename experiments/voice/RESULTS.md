# French bidding recognition — synthetic benchmark

Two Piper voices, 26 phrases each, clean / faster / 15 dB added white noise, plus silence and noise-only. Inference times are warm CPU Python measurements, excluding audio decoding, model loading and network. These are not browser/iPhone latency measurements or human-speech accuracy estimates.

| Engine | Command clips correct | Non-command false activations | Median inference |
| --- | ---: | ---: | ---: |
| vosk-free | 63/84 (75.0%) | 0/74 (0.0%) | 780.1 ms |
| vosk-grammar | 84/84 (100.0%) | 10/74 (13.5%) | 40.1 ms |
| whisper-tiny | 43/84 (51.2%) | 0/74 (0.0%) | 278.3 ms |

## By condition

| Engine | Condition | Correct commands | False activations |
| --- | --- | ---: | ---: |
| vosk-free | clean | 23/28 | 0/24 |
| vosk-free | fast | 23/28 | 0/24 |
| vosk-free | noise-15db | 17/28 | 0/24 |
| vosk-free | non-speech | 0/0 | 0/2 |
| vosk-grammar | clean | 28/28 | 2/24 |
| vosk-grammar | fast | 28/28 | 4/24 |
| vosk-grammar | noise-15db | 28/28 | 4/24 |
| vosk-grammar | non-speech | 0/0 | 0/2 |
| whisper-tiny | clean | 15/28 | 0/24 |
| whisper-tiny | fast | 16/28 | 0/24 |
| whisper-tiny | noise-15db | 12/28 | 0/24 |
| whisper-tiny | non-speech | 0/0 | 0/2 |

## Failures to inspect

All errors are retained in results.csv. Selected clean cases:

### vosk-free

- siwis, take-clubs: transcript "je prends un trèfle" → null; expected {"kind":"take","suit":"clubs"}.
- siwis, hearts: transcript "car" → null; expected {"kind":"take","suit":"hearts"}.
- siwis, spades: transcript "erik" → null; expected {"kind":"take","suit":"spades"}.
- tom, hearts: transcript "q" → null; expected {"kind":"take","suit":"hearts"}.
- tom, spades: transcript "vic" → null; expected {"kind":"take","suit":"spades"}.

### vosk-grammar

- siwis, past-bid: transcript "je prends à piques" → {"kind":"take","suit":"spades"}; expected null.
- siwis, question: transcript "prends à cœur" → {"kind":"take","suit":"hearts"}; expected null.

### whisper-tiny

- siwis, take-clubs: transcript "Je prends un très flère." → null; expected {"kind":"take","suit":"clubs"}.
- siwis, two: transcript "D." → null; expected {"kind":"pass","word":"deux"}.
- siwis, hearts: transcript "Ciao !" → null; expected {"kind":"take","suit":"hearts"}.
- siwis, spades: transcript "1" → null; expected {"kind":"take","suit":"spades"}.
- siwis, clubs: transcript "Ça y est flem." → null; expected {"kind":"take","suit":"clubs"}.
- tom, take-spades: transcript "Je prends la pite." → null; expected {"kind":"take","suit":"spades"}.
- tom, take-clubs: transcript "Je prends à très fût." → null; expected {"kind":"take","suit":"clubs"}.
- tom, yes: transcript "Louis" → null; expected {"kind":"take","suit":null}.
- tom, two: transcript "Duk !" → null; expected {"kind":"pass","word":"deux"}.
- tom, hearts: transcript "Quech !" → null; expected {"kind":"take","suit":"hearts"}.

## Limits

- Only two synthetic voices, not held-out human speakers, accents, room acoustics or overlapping conversation.
- White noise is not a substitute for a real family/table recording.
- Grammar constraints can turn unrelated speech into plausible commands, even with `[unk]`.
- No confidence cutoff was tuned; engine confidences are not interchangeable.
- Native browser recognition needs testing with real Safari/Chrome devices and was not measured here.
- Game turn/round validation further restricts actions; these metrics deliberately measure parsing before that validation.
