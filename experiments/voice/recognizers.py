"""Offline ASR adapters used by both the benchmark and the live prototype."""
import io
import json
import time
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from vosk import KaldiRecognizer, Model, SetLogLevel

ROOT = Path(__file__).resolve().parent
RATE = 16000
ENGINES = ("vosk-free", "vosk-grammar", "whisper-tiny")
GRAMMAR = ["non", "deux", "oui", "je passe", "je prends"]
for suit in ("coeur", "cœur", "coeurs", "cœurs", "carreau", "carreaux", "pique", "piques", "trèfle", "trèfles"):
    GRAMMAR.extend((suit, f"je prends à {suit}", f"je prends au {suit}", f"je prends aux {suit}"))
GRAMMAR.append("[unk]")


class Recognizers:
    def __init__(self):
        self.models = {}
        self.load_ms = {}
        SetLogLevel(-1)

    def load(self, engine):
        key = "vosk" if engine.startswith("vosk-") else engine
        if key in self.models:
            return self.models[key]
        start = time.perf_counter()
        if key == "vosk":
            model = Model(str(ROOT / "models/vosk-model-small-fr-0.22"))
        elif key == "whisper-tiny":
            model = WhisperModel(str(ROOT / "models/whisper-tiny"), device="cpu", compute_type="int8",
                                 cpu_threads=4, num_workers=1, local_files_only=True)
        else:
            raise ValueError(f"Unknown engine: {engine}")
        self.models[key] = model
        self.load_ms[key] = round((time.perf_counter() - start) * 1000, 1)
        return model

    def transcribe(self, engine, samples):
        model = self.load(engine)
        start = time.perf_counter()
        if engine.startswith("vosk-"):
            recognizer = KaldiRecognizer(model, RATE, json.dumps(GRAMMAR, ensure_ascii=False)) if engine == "vosk-grammar" else KaldiRecognizer(model, RATE)
            recognizer.SetWords(True)
            pcm = np.round(np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
            parts = []
            confidences = []
            for offset in range(0, len(pcm), 8000):
                if recognizer.AcceptWaveform(pcm[offset:offset + 8000]):
                    part = json.loads(recognizer.Result())
                    parts.append(part.get("text", ""))
                    confidences.extend(word["conf"] for word in part.get("result", []))
            part = json.loads(recognizer.FinalResult())
            parts.append(part.get("text", ""))
            confidences.extend(word["conf"] for word in part.get("result", []))
            text = " ".join(part for part in parts if part)
            confidence = sum(confidences) / len(confidences) if confidences else None
        else:
            # No prompt: do not encourage the decoder to invent one of our bids.
            segments, _ = model.transcribe(samples, language="fr", task="transcribe", beam_size=3,
                                            condition_on_previous_text=False, vad_filter=False,
                                            temperature=0)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            confidence = None  # Not comparable to Vosk's word confidences.
        return {"text": text, "inference_ms": round((time.perf_counter() - start) * 1000, 1),
                "confidence": confidence}


def read_audio(data):
    """PyAV decodes WAV, Chrome WebM and Safari MP4 to mono 16 kHz float32."""
    return decode_audio(io.BytesIO(data), sampling_rate=RATE)
