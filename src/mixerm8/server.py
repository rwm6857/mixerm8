"""Serves the tablet app and streams console state over Server-Sent Events."""

from __future__ import annotations

import http.server
import json
import mimetypes
import socket
import socketserver
import sys
import threading
from pathlib import Path

from . import config

HEARTBEAT_EVERY = 15.0    # keeps idle SSE connections from being reaped


def webroot() -> Path:
    """Locate the built app, however MixerM8 happens to be running.

    Installed wheel     -> mixerm8/webroot (force-included from docs/ at build)
    PyInstaller bundle  -> sys._MEIPASS/webroot
    Source checkout     -> ../../docs
    """
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidate = Path(bundled) / "webroot"
        if candidate.is_dir():
            return candidate
    here = Path(__file__).resolve().parent
    for candidate in (here / "webroot", here.parents[1] / "docs"):
        if (candidate / "index.html").is_file():
            return candidate
    raise FileNotFoundError("could not locate the MixerM8 web app")


def override_dir() -> Path:
    """Where a church's own guide wording lives on the media computer.

    Dropping `guides.local.json` in here beats the copy bundled in the exe,
    so a media director can reword the guide without git, without a rebuild
    and without reinstalling. Nothing in here is ever committed or published,
    which matters because a filled-in guide names staff and lists the
    channel layout.
    """
    return config.config_dir() / "data"


def resolve_within(root: Path, path: str) -> Path | None:
    """Resolve a URL path under `root`, or None if it climbs out.

    Compared as paths, not as a string prefix -- a sibling directory whose
    name merely starts with the web root's would pass a prefix test. The
    editor serves the same files from a second process, so it asks here
    rather than keeping its own copy of the guard.
    """
    root = root.resolve()
    target = (root / path.lstrip("/")).resolve()
    if target != root and root not in target.parents:
        return None
    return target


def local_ip() -> str:
    """Best guess at this machine's LAN address, for the printed URL."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.BaseHTTPRequestHandler):
    console = None
    root: Path = None
    protocol_version = "HTTP/1.1"

    # -- helpers --------------------------------------------------------
    def _headers(self, ctype: str, length: int | None = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _send_bytes(self, body: bytes, ctype: str) -> None:
        self._headers(ctype, len(body))
        self.wfile.write(body)

    # -- routes ---------------------------------------------------------
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        try:
            if path == "/events":
                self._stream()
            elif path == "/state":
                body = json.dumps(self.console.snapshot()).encode()
                self._send_bytes(body, "application/json; charset=utf-8")
            else:
                self._static(path)
        except (BrokenPipeError, ConnectionResetError):
            pass    # tablet went to sleep or wandered off the network

    def do_POST(self) -> None:
        """The one endpoint on this server that changes anything.

        Everything else here is a read, and that is the reason the guide
        editor is a separate command bound to loopback: a write endpoint on
        the LAN would put "rewrite the guide" one URL away from every
        volunteer holding a tablet. This one is judged worth the exception
        because of what it can actually do -- broadcast /info and point the
        watcher at whoever answers. It cannot reach the desk with anything
        but a read (`encode_query` still takes no arguments), it cannot
        touch a file, and the console debounces it, so a volunteer leaning
        on the button is one broadcast rather than a flood.
        """
        path = self.path.split("?", 1)[0]
        try:
            if path == "/reconnect":
                self._reconnect()
            else:
                self.send_error(404)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _reconnect(self) -> None:
        # Drain any body first, or the next request on this keep-alive
        # connection starts reading from the middle of this one.
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        started = self.console.reconnect()
        snap = self.console.snapshot()
        snap["started"] = started
        self._send_bytes(json.dumps(snap).encode(),
                         "application/json; charset=utf-8")

    def _stream(self) -> None:
        """Push a snapshot whenever the console changes. One thread per tablet."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        seen = -1
        while True:
            snap = self.console.snapshot()
            if snap["version"] != seen:
                seen = snap["version"]
                self.wfile.write(f"data: {json.dumps(snap)}\n\n".encode())
            else:
                self.wfile.write(b": ping\n\n")     # heartbeat
            self.wfile.flush()
            self.console.wait_for_change(seen, HEARTBEAT_EVERY)

    def _static(self, path: str) -> None:
        if path in ("/", ""):
            path = "/index.html"

        # A church's own wording wins over the bundled example. Restricted to
        # a single "*.json" filename so this cannot become a second file
        # server rooted outside the web root.
        if path.startswith("/data/"):
            name = path[len("/data/"):]
            if name.endswith(".json") and "/" not in name and ".." not in name:
                local = override_dir() / name
                if local.is_file():
                    self._send_bytes(local.read_bytes(),
                                     "application/json; charset=utf-8")
                    return

        target = resolve_within(self.root, path)
        if target is None:
            self.send_error(403)
            return
        if not target.is_file():
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith(("text/", "application/json", "application/javascript")):
            ctype += "; charset=utf-8"
        self._send_bytes(target.read_bytes(), ctype)

    def log_message(self, *args) -> None:
        pass    # the terminal is for console status, not HTTP noise


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve(console, port: int) -> Server:
    Handler.console = console
    Handler.root = webroot()
    server = Server(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
