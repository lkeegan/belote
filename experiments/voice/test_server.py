"""Integration checks after generating audio; opens only a loopback test port."""
import json
from pathlib import Path
import subprocess
import tempfile
from threading import Lock, Thread
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from recognizers import Recognizers, read_audio
from server import Handler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent


class AudioAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wav = ROOT / "audio/siwis-take-hearts-clean.wav"
        if not cls.wav.exists():
            raise unittest.SkipTest("Generate the synthetic corpus first")
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.models = Recognizers()
        cls.server.lock = Lock()
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def request(self, path, data=None, origin="http://localhost:5173", method=None):
        return urlopen(Request(self.base + path, data=data, method=method, headers={
            "Origin": origin, "Content-Type": "application/octet-stream",
        }), timeout=60)

    def test_health_and_preflight(self):
        with self.request("/health") as response:
            self.assertIn("vosk-grammar", json.load(response)["engines"])
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:5173")
        with self.request("/recognize", method="OPTIONS") as response:
            self.assertEqual(response.status, 204)

    def test_rejects_untrusted_origins_and_invalid_audio(self):
        for path, data, origin, status in (
            ("/recognize?engine=vosk-free", b"x", "https://example.com", 403),
            ("/recognize?engine=invalid", b"x", "http://localhost:5173", 400),
            ("/recognize?engine=vosk-free", b"not audio", "http://localhost:5173", 400),
        ):
            with self.assertRaises(HTTPError) as raised:
                self.request(path, data, origin)
            self.assertEqual(raised.exception.code, status)

    def test_wav_chrome_webm_and_safari_mp4(self):
        with tempfile.TemporaryDirectory() as directory:
            files = [self.wav]
            for extension, codec in (("webm", "libopus"), ("m4a", "aac")):
                target = Path(directory) / f"sample.{extension}"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(self.wav),
                                "-c:a", codec, str(target)], check=True)
                files.append(target)
            for audio in files:
                samples = read_audio(audio.read_bytes())
                self.assertGreater(len(samples), 1600)
                for engine in ("vosk-free", "vosk-grammar", "whisper-tiny"):
                    with self.request(f"/recognize?engine={engine}", audio.read_bytes()) as response:
                        result = json.load(response)
                    self.assertTrue(result["text"], (audio.suffix, engine, result))
                    self.assertIn("inference_ms", result)
                    print(audio.suffix, engine, repr(result["text"]), flush=True)


if __name__ == "__main__":
    unittest.main()
