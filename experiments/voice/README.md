# Reproducing the French voice prototypes

Run commands below from the repository root. Python/model dependencies are
isolated from the game and Worker. They are not bundled or deployed; the browser
lab lives in `frontend/voice.html`.

## Setup and benchmark

Requires `uv`, Node 24 and FFmpeg (FFmpeg is used only by codec tests). Setup
downloads Python 3.12 if missing, dependencies and about 300 MB of models/archive
files. Models, environment and generated audio are ignored by Git.

```bash
uv sync --frozen --project experiments/voice --python 3.12
experiments/voice/.venv/bin/python experiments/voice/download_models.py
experiments/voice/.venv/bin/python experiments/voice/synthesize.py
experiments/voice/.venv/bin/python experiments/voice/benchmark.py
node experiments/voice/score.mjs
```

The downloader pins model revisions and verifies the Vosk archive checksum.
`uv.lock` pins packages. PyAV is capped below 17 because faster-whisper 1.2.1
uses a decoder argument removed in newer releases.

Outputs:

- `audio/manifest.json` and WAVs: synthetic speech, no human recordings.
- `results.json`: generated raw recognizer output, ignored intermediate file.
- `results.csv`: every transcript, expected/predicted command, timing and audio
  SHA-256, retained for inspection.
- `summary.json`: machine/package/model provenance and aggregates.
- `RESULTS.md`: counts, conditions and representative failures.

Noise uses a fixed seed; Piper synthesis need not be bit-identical on another
run. The audio hashes identify the exact clips measured. Re-running the
benchmark replaces the reports. CPU timings are not browser/iOS measurements.

## Interactive comparison: static webpage

```bash
cd frontend
pnpm dev
```

Open `http://localhost:5173/belote/voice.html`. The lab offers native browser
recognition, experimental browser-local recognition, and Vosk WASM with free
vocabulary or a bidding grammar. Record a phrase or upload a generated WAV.
Everything needed by Vosk is served as static files; no Python ASR API is used.
The lab shows raw text and a simulated legal bid and never acts in the game.

`pnpm dev` / `pnpm build` prepare a versioned 42.2 MB tar.gz model using Python's
**standard library only, at build time**. This does not need the experiment's
Python environment. The pinned original ZIP is reused locally when available,
otherwise downloaded and hash-checked. The resulting file is ignored by Git and
copied into the static deployment. It includes directory entries required by
Vosk's browser filesystem/cache implementation.

The large WASM/JS bundle is dynamically imported only when loading Vosk. Its
Web Worker loads the model and caches it in IndexedDB. Recognition is on-device;
no audio uploads and no cross-origin isolation headers are needed. The browser
regression test verifies this against a production build. Microphone access
still requires HTTPS or localhost and user permission. Full offline page reloads
are not guaranteed: the site has no service worker.

On iPhone/iPad, use the HTTPS-hosted lab after deploying the frontend. No LAN
Python service or tunnel is needed. iOS memory/latency and actual microphone
recognition still require device testing. The original Python recognizers and
optional loopback `server.py` are reference research tools, not dependencies of
the static lab. Whisper Tiny is currently benchmark-only.

## Browser regression test and WASM benchmark

```bash
cd frontend
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
```

The committed synthetic WAV fixtures cover the three requested phrases and a
non-command. A separate real-game test uses Chrome’s synthetic microphone, the
real AudioWorklet and Vosk worker, and a stub multiplayer transport to verify a
bid, detected-text feedback and microphone shutdown. The audio test uses the
full Chromium browser in new headless mode (not the limited headless shell).
Playwright runs the production build in headless Chrome without
isolation headers and checks that the network uses only static-file GETs. It
then reloads with model downloads blocked to verify IndexedDB caching.

After generating the full corpus, explicitly benchmark both WASM decoders:

```bash
cd frontend
VOICE_BENCHMARK=1 pnpm test:browser
```

This additionally writes `browser-results.csv` and an ignored JSON intermediate
with browser metadata. The 316 browser transcriptions are separate from the
474 Python transcriptions; do not substitute Python timings for mobile/WASM.
From the repository root, generate the browser report with:

```bash
node experiments/voice/score-browser.mjs
```

## Validation

```bash
cd frontend
pnpm test
pnpm build
```

From the root after generating audio:

```bash
experiments/voice/.venv/bin/python -m unittest discover -s experiments/voice -p 'test_*.py'
```

Python tests exercise the real API and all three decoders with WAV, WebM and
MP4/AAC, plus CORS/error handling, using a temporary loopback port. Frontend
tests cover parsing, legal rounds, final-only actions, stale-result cancellation,
microphone denial, native-browser local-only mode, the Vosk activation toggle,
turn pausing, stale-result cancellation and game-to-WebSocket bids.

## Models and attribution

- [Vosk French small 0.22](https://alphacephei.com/vosk/models), Apache 2.0 per
  the upstream list.
- Multilingual [Whisper Tiny](https://huggingface.co/Systran/faster-whisper-tiny)
  through [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
- TTS uses [Piper](https://github.com/OHF-Voice/piper1-gpl). The
  [SIWIS model card](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD)
  lists CC-BY 4.0 dataset licensing; the
  [Tom model card](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/tom/medium/MODEL_CARD)
  lists AGPLv3. Model binaries and the full generated corpus are ignored by Git;
  four small SIWIS WAV fixtures are included for browser regression tests.

See [the investigation](../../voice-rec.md) for primary sources, device options,
measurements and remaining real-device tests.
