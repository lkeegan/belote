"""Download versioned French models into the ignored models/ directory."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

from huggingface_hub import hf_hub_download, snapshot_download

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
VOICES = ("siwis", "tom")
PIPER_REVISION = "5041a7a49ae5b3a0f30e6837769eb03fdbb231bd"
WHISPER_REVISION = "d90ca5fe260221311c53c58e660288d3deb8d356"
VOSK_SHA256 = "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad"


def main():
    MODELS.mkdir(exist_ok=True)
    provenance = {}
    revision = PIPER_REVISION
    for voice in VOICES:
        prefix = f"fr/fr_FR/{voice}/medium"
        for filename in (f"fr_FR-{voice}-medium.onnx", f"fr_FR-{voice}-medium.onnx.json", "MODEL_CARD"):
            hf_hub_download("rhasspy/piper-voices", f"{prefix}/{filename}", revision=revision,
                            local_dir=MODELS / "piper")
        provenance[f"piper-{voice}"] = {"repo": "rhasspy/piper-voices", "revision": revision, "path": prefix}
    revision = WHISPER_REVISION
    snapshot_download("Systran/faster-whisper-tiny", revision=revision,
                      allow_patterns=["model.bin", "config.json", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"],
                      local_dir=MODELS / "whisper-tiny")
    provenance["whisper-tiny"] = {"repo": "Systran/faster-whisper-tiny", "revision": revision}
    url = "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip"
    archive = MODELS / "vosk-model-small-fr-0.22.zip"
    if not archive.exists():
        print(f"Downloading {url}", flush=True)
        temporary = archive.with_suffix(".part")
        urllib.request.urlretrieve(url, temporary)
        temporary.rename(archive)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    if checksum != VOSK_SHA256:
        raise ValueError("Vosk archive checksum does not match the benchmark model")
    with zipfile.ZipFile(archive) as zipped:
        if any(not (MODELS / member.filename).resolve().is_relative_to(MODELS.resolve()) for member in zipped.infolist()):
            raise ValueError("Archive path outside models directory")
        zipped.extractall(MODELS)
    provenance["vosk"] = {"url": url, "sha256": checksum}
    (MODELS / "sources.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print("Models ready; provenance saved in models/sources.json", flush=True)


if __name__ == "__main__":
    main()
