"""Evaluate each local recognizer on exactly the same generated audio."""
import json
import platform
from pathlib import Path
import time
from importlib.metadata import version

from recognizers import ENGINES, Recognizers, read_audio

ROOT = Path(__file__).resolve().parent


def main():
    manifest = json.loads((ROOT / "audio/manifest.json").read_text())
    models = Recognizers()
    rows = []
    for engine in ENGINES:
        models.load(engine)
        for index, sample in enumerate(manifest):
            samples = read_audio((ROOT / "audio" / sample["file"]).read_bytes())
            rows.append({**sample, "phrase": sample["text"], "engine": engine, **models.transcribe(engine, samples)})
            if index % 25 == 0:
                print(f"{engine}: {index + 1}/{len(manifest)}", flush=True)
    output = {"metadata": {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "platform": platform.platform(), "processor": platform.processor(),
        "python": platform.python_version(), "cpu_threads": 4,
        "packages": {name: version(name) for name in ("vosk", "faster-whisper", "piper-tts")},
        "model_load_ms": models.load_ms,
        "models": json.loads((ROOT / "models/sources.json").read_text()),
        "scope": "Synthetic speech only; CPU Python implementations, not iOS/browser performance. Inference excludes decoding, model load and network.",
    }, "rows": rows}
    (ROOT / "results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {len(rows)} results", flush=True)


if __name__ == "__main__":
    main()
