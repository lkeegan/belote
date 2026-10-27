# French voice bidding: investigation and prototypes

Targets: iPad/iPhone Safari and desktop Chrome. Investigated 27 October 2026.
Audio is off until enabled with a button. While enabled, it recognises speech
continuously during the selected player’s bidding turns and pauses otherwise.

## Working prototypes

1. **Grammar-constrained Vosk in the real game.** Select a seat, then press
   **🎙 Activer l’audio** once. The microphone/AudioWorklet feeds Vosk's WASM
   worker during your bidding turns. Between turns the microphone remains
   enabled, but frames are discarded and a fresh recognizer is used for the
   next turn. Final commands are matched and checked against the current deal,
   round, turn and seat before bidding; partial text is display-only. The debug
   row shows raw detected text and whether it matched, was unavailable, was
   ignored after a turn change, or was sent. One turn cannot submit twice.
   Toggle off, change seats or hide the tab to release the microphone. No audio
   is uploaded. Native browser recognition is retained only as a lab comparison.
2. **Native on-device recognition, experimental.** The lab probes and explicitly
   installs French language packs, then sets `processLocally = true`. Unsupported
   browsers fail explicitly; there is no remote fallback. This is not a universal
   offline solution for the target iOS devices.
3. **Vosk WASM, free vocabulary and Belote grammar, entirely in-browser.**
   Both use the same French model in a Web Worker. The model is a static file
   (42.2 MB), loaded only when Vosk is chosen and cached by the library in
   IndexedDB. Audio never leaves the device. No ASR server or special
   cross-origin isolation headers are needed. A production-build Chrome test
   verifies the three requested commands and a network trace containing only
   same-origin static-file GETs.
4. **Whisper Tiny, multilingual French: Python benchmark only.** The reference
   implementation uses CPU/int8, forced French, no English-only `.en` model and
   no command prompt. It is not a runtime dependency of the webpage.

Open `frontend/voice.html` through Vite at
`http://localhost:5173/belote/voice.html`. The lab displays raw transcripts,
parsed commands, legal bids under a simulated first/second round, and timing.
It never sends game actions. See [setup instructions](experiments/voice/README.md).

## Options and device fit

| Approach | Fit for these devices | Tradeoff | Status |
| --- | --- | --- | --- |
| Browser Web Speech | Safari/iOS and Chrome, feature-detected | Service/network and permissions depend on the browser | Lab comparison only |
| Browser forced local | Browsers exposing the experimental language-pack APIs | Check French pack availability; no remote fallback | Probe/install/listen controls in lab |
| Vosk WASM French | Static webpage, Chrome tested; iOS device trial pending | 42.2 MB model plus lazy WASM/JS bundle; grammar can force unrelated speech into commands | Browser implementation and real Chrome test; Python baseline also retained |
| Whisper | Static browser implementation possible via ONNX/WASM | Model download/compute; Tiny struggles with short isolated words | Python benchmark only; browser port not implemented |
| Hosted French STT, e.g. Google Cloud | Audio through an authenticated backend | French recognition/phrase adaptation; paid service, credentials and backend needed | Researched, not called or benchmarked |

Primary sources:

- [WebKit: Safari speech recognition](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/)
  describes its Siri-based engine and the Siri setting on iOS/iPadOS.
- [MDN: SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
  documents language selection and possible server-based processing.
- [MDN: on-device recognition](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API#on-device_speech_recognition)
  documents availability checks, language packs and local-only processing.
- [MDN: deprecated SpeechGrammar](https://developer.mozilla.org/en-US/docs/Web/API/SpeechGrammar)
  explains that old browser grammars no longer affect recognition. Vosk's grammar
  is a separate decoder feature; we do not use the deprecated browser mechanism.
- [Vosk model list](https://alphacephei.com/vosk/models) and
  [Vosk Browser](https://github.com/ccoreilly/vosk-browser) describe French models
  and a WebAssembly/worker port. Python timing is not browser-port timing.
- [Transformers.js](https://huggingface.co/docs/transformers.js/v3.8.1/en/index)
  documents browser ASR using WASM/WebGPU;
  [faster-whisper](https://github.com/SYSTRAN/faster-whisper) is the CPU implementation tested here.
- [Google French support](https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages)
  and [phrase adaptation](https://docs.cloud.google.com/speech-to-text/docs/adaptation-model)
  describe the hosted option. No cloud credentials or paid calls were used.

## Actual browser/WASM measurements

Both WASM decoders were run against the same 158 clips in headless desktop
Chrome 156, served by a plain static production preview. The browser was not
cross-origin isolated. The smoke test verifies only same-origin GETs and no
audio uploads; the model is cached in IndexedDB.

| WASM decoder | Command clips correct | Non-command false activations | Median inference |
| --- | ---: | ---: | ---: |
| Vosk grammar | 84/84 | 10/74 | 488 ms |
| Vosk free vocabulary | 64/84 | 0/74 | 1895 ms |

The grammar decoder got all six trials of each requested phrase correct.
These remain synthetic tests on a desktop, not iOS performance estimates.
See [browser results](experiments/voice/BROWSER_RESULTS.md) and
[all browser transcripts](experiments/voice/browser-results.csv). The original
Python measurements below are retained as a separate reference.

## Python reference measurements

These numbers are the original Python benchmark, not WASM timings. Browser
results are recorded separately in `experiments/voice/browser-results.csv`.

Two French Piper voices (SIWIS and Tom), 26 phrases each, three conditions:
normal speech, faster synthesis (`length_scale=0.8`) and white noise at 15 dB SNR.
Add two non-speech clips: **158 clips per recognizer** (84 commands, 74
non-commands). Every decoder saw identical audio, then the same TypeScript
parser used by the game. There were **474 recognition runs**.

| Decoder | Command clips correct | Non-command false activations | Median warm inference |
| --- | ---: | ---: | ---: |
| Vosk free vocabulary | 63/84 (75.0%) | 0/74 | 780 ms |
| Vosk grammar + `[unk]` | 84/84 (100.0%) | 10/74 (13.5%) | 40 ms |
| Whisper Tiny, French CPU/int8 | 43/84 (51.2%) | 0/74 | 278 ms |

For the requested phrases, six voice/condition combinations per phrase:

| Phrase | Vosk free | Vosk grammar | Whisper Tiny |
| --- | ---: | ---: | ---: |
| Je prends à cœur | 5/6 | 6/6 | 6/6 |
| Je prends à cœurs | 5/6 | 6/6 | 6/6 |
| Non | 6/6 | 6/6 | 6/6 |
| Deux | 6/6 | 6/6 | 2/6 |

Grammar Vosk turned “Il a pris à pique” into “je prends à piques” and a question
about taking into “prends à cœur”. Whisper Tiny sometimes transcribed “Deux” as
“D.” or “Duk !”. The parser was not taught these benchmark-specific errors.

These are **synthetic smoke tests, not human accuracy estimates**. Measurements
used an Intel i7-1165G7 CPU; inference excludes loading, decoding and network.
Native browser recognition and iOS performance were not measured; desktop
WASM is evaluated separately from this Python table.
White noise does not model accents, microphone distance, room acoustics or
conversation overlap. No cross-engine confidence threshold was tuned.

See [full breakdown](experiments/voice/RESULTS.md),
[all labelled results](experiments/voice/results.csv) and
[model/version provenance](experiments/voice/summary.json).

## Command interpretation

`frontend/src/voice/commands.ts` is shared by the game, lab and scorer:

- Normalize case, accents, `œ`/`oe`, punctuation and spacing.
- Match whole utterances. Reject suits mentioned inside conversation, questions,
  negation or contradictory phrases, when those words survive transcription.
- Recognize `oui`/`je prends`, `non`/`je passe`, `deux`/`2`, and singular/plural
  suit names plus a small explicit alias set.
- Allow one character edit only for longer suit words; reject ambiguous matches.
  No fuzzy matching of short commands; bare “de” is not a pass.
- Unspecific `oui`/`je prends` takes the retourne in round one. Round two needs
  an explicit other suit. `deux` is allowed only in round two; `non` in either.
- Act on final text only, at most once, and preserve raw final text for diagnosis.
- Validate the live seat, connection, phase, turn, round and deal before sending.

## Recommendation and next device trial

The real game now uses **grammar-constrained Vosk WASM**, activated by an
explicit microphone toggle. It remains a static deployment and needs no ASR
service. Keep the detected-text display visible during real-device trials,
particularly because the synthetic benchmark showed false activations.

The static Vosk WASM prototype is available for a fully on-device option.
Its actual iPhone/iPad memory use and latency still need testing. The Python
grammar baseline is promising, but its false
activations make command accuracy alone insufficient for continuous automatic
bidding. Whisper Tiny is not convincing for isolated words; larger Whisper
models were not evaluated and may behave differently.

On each real iPhone/iPad/Chrome device, allow the microphone and try the
requested phrases and suits in both bidding rounds. The Siri setting is only
relevant to the native-browser comparison in the lab, not to Vosk.
Try quiet speech, table chatter and denied microphone access. Use the lab to
separate raw ASR errors from parser errors. Start listening, then change
seat/deal or disconnect to verify cancellation. Evaluate the enabled microphone with real table conversation before relying
on it: grammar constraints can convert unrelated speech into a valid command.
