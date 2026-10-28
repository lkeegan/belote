"""Prepare a pinned French Vosk model as a static WASM-compatible tar.gz asset.

Build-time only; uses Python's standard library. No inference server is needed.
"""
import gzip
import hashlib
import io
import sys
from pathlib import Path
import tarfile
import urllib.request
import zipfile

FRONTEND = Path(__file__).resolve().parents[1]
NAME = "vosk-model-small-fr-0.22"
SHA256 = "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad"
TARGET = FRONTEND / "public/models" / f"{NAME}.tar.gz"


def main():
    if TARGET.exists() and "--force" not in sys.argv:
        print(f"French Vosk static model ready: {TARGET.name}")
        return
    url = f"https://alphacephei.com/vosk/models/{NAME}.zip"
    print(f"Downloading {url}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as source:
        content = source.read()
    if hashlib.sha256(content).hexdigest() != SHA256:
        raise ValueError("French Vosk model checksum mismatch")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary = TARGET.with_suffix(".part")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as source, temporary.open("wb") as output:
            with gzip.GzipFile(filename="", fileobj=output, mode="wb", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w|") as archive:
                    for item in sorted(source.infolist(), key=lambda item: item.filename):
                        path = Path(item.filename)
                        if path.is_absolute() or ".." in path.parts or path.parts[0] != NAME:
                            raise ValueError("Unexpected model archive path")
                        info = tarfile.TarInfo(item.filename)
                        if item.is_dir():
                            # Preserve traversable directories: omitting these
                            # caused IDBFS sync failures in the browser test.
                            info.type = tarfile.DIRTYPE
                            info.mode = 0o755
                            archive.addfile(info)
                        else:
                            info.size = item.file_size
                            info.mode = 0o644
                            with source.open(item) as contents:
                                archive.addfile(info, contents)
        temporary.replace(TARGET)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Prepared {TARGET.name}: {TARGET.stat().st_size / 1_000_000:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
