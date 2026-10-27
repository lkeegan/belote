# Vosk WASM: static-browser benchmark

Browser: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36

Cross-origin isolated: false. The production-build smoke test checks that only same-origin static-file GET requests are made. No ASR server or audio upload is used.

The same 158 synthetic clips used by the Python comparison were decoded in the browser and passed through Vosk's WASM worker. Inference includes worker round trips and recognizer creation, excluding model loading and audio decoding. This is desktop Chrome, not an iPhone/iPad measurement.

| Decoder | Command clips correct | Non-command false activations | Median WASM inference |
| --- | ---: | ---: | ---: |
| vosk-grammar-wasm | 84/84 | 10/74 | 488 ms |
| vosk-free-wasm | 64/84 | 0/74 | 1895 ms |

## Requested phrases

| Decoder | Phrase | Correct |
| --- | --- | ---: |
| vosk-grammar-wasm | Je prends à cœur. | 6/6 |
| vosk-grammar-wasm | Je prends à cœurs. | 6/6 |
| vosk-grammar-wasm | Non. | 6/6 |
| vosk-grammar-wasm | Deux. | 6/6 |
| vosk-free-wasm | Je prends à cœur. | 5/6 |
| vosk-free-wasm | Je prends à cœurs. | 5/6 |
| vosk-free-wasm | Non. | 6/6 |
| vosk-free-wasm | Deux. | 6/6 |

All transcripts are retained in browser-results.csv. These are synthetic smoke tests; false activations remain a concern, and real device/microphone trials are still required.
