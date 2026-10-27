"""Local-only audio API for the browser lab. No game state or credentials."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import parse_qs, urlparse

from recognizers import ENGINES, RATE, Recognizers, read_audio

ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:4173", "http://127.0.0.1:4173"}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_OPTIONS(self):
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:
            return self.reply(403, {"error": "Use the local Vite dev/preview origin"})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, {"error": "not found"})
        self.reply(200, {"engines": ENGINES, "loaded_models": list(self.server.models.models)})

    def do_POST(self):
        origin = self.headers.get("Origin")
        if origin and origin not in ALLOWED_ORIGINS:
            return self.reply(403, {"error": "Use the local Vite dev/preview origin"})
        url = urlparse(self.path)
        engine = parse_qs(url.query).get("engine", [""])[0]
        if url.path != "/recognize" or engine not in ENGINES:
            return self.reply(400, {"error": "Choose a supported engine"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply(400, {"error": "Invalid Content-Length"})
        if not 0 < length <= 5_000_000:
            return self.reply(413, {"error": "Audio must be between 1 byte and 5 MB"})
        try:
            samples = read_audio(self.rfile.read(length))
            if len(samples) > RATE * 15:
                return self.reply(413, {"error": "Use at most 15 seconds of audio"})
            with self.server.lock:
                result = self.server.models.transcribe(engine, samples)
            self.reply(200, {"engine": engine, **result})
        except Exception as error:
            self.reply(400, {"error": f"Audio recognition failed: {error}"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.models = Recognizers()
    server.lock = Lock()
    print(f"Local ASR ready: http://localhost:{args.port}/health", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
