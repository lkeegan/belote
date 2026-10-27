"""Build a labelled, synthetic French corpus: two voices × three conditions."""
import io
import json
import math
import wave
from pathlib import Path

import numpy as np
from piper import PiperVoice, SynthesisConfig
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent
RATE = 16000


def save(path, samples):
    pcm = np.round(np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(RATE)
        target.writeframes(pcm.tobytes())


def main():
    corpus = json.loads((ROOT / "corpus.json").read_text())
    directory = ROOT / "audio"
    directory.mkdir(exist_ok=True)
    manifest = []
    rng = np.random.default_rng(42)
    for name in ("siwis", "tom"):
        model = ROOT / "models/piper/fr/fr_FR" / name / "medium" / f"fr_FR-{name}-medium.onnx"
        voice = PiperVoice.load(str(model))
        for phrase in corpus:
            for condition, length_scale in (("clean", 1.0), ("fast", 0.8), ("noise-15db", 1.0)):
                # Reuse the same clean synthesis for noise, changing only SNR.
                if condition != "noise-15db":
                    buffer = io.BytesIO()
                    with wave.open(buffer, "wb") as target:
                        voice.synthesize_wav(phrase["text"], target, SynthesisConfig(length_scale=length_scale))
                    buffer.seek(0)
                    with wave.open(buffer, "rb") as source:
                        rate = source.getframerate()
                        raw = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768
                    divisor = math.gcd(rate, RATE)
                    speech = resample_poly(raw, RATE // divisor, rate // divisor)
                    if condition == "clean":
                        clean = speech.copy()
                else:
                    noise = rng.standard_normal(len(clean)).astype(np.float32)
                    noise *= np.sqrt(np.mean(clean ** 2)) / (10 ** (15 / 20))
                    speech = clean + noise
                # Fixed endpointing padding for file-based recognizers.
                padded = np.concatenate((np.zeros(RATE // 5), speech, np.zeros(RATE // 2)))
                filename = f"{name}-{phrase['id']}-{condition}.wav"
                save(directory / filename, padded)
                manifest.append({**phrase, "voice": name, "condition": condition,
                                 "file": filename, "seconds": len(padded) / RATE})
        print(f"Synthesized {name}", flush=True)
    for name, samples in (("silence", np.zeros(RATE * 2)),
                          ("noise-only", rng.standard_normal(RATE * 2) * 0.025)):
        filename = f"{name}.wav"
        save(directory / filename, samples)
        manifest.append({"id": name, "text": "", "expected": None, "voice": "none",
                         "condition": "non-speech", "file": filename, "seconds": 2})
    (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"Generated {len(manifest)} labelled clips", flush=True)


if __name__ == "__main__":
    main()
