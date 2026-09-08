"""A local editor for the guide: edit the wording, watch the tablet update.

Started with `mixerm8 --edit`. It is a **separate command from the booth
bridge on purpose**. The bridge listens on the LAN so tablets can reach it,
and a write endpoint on that server would put "rewrite the guide" one URL
away from every volunteer holding a tablet mid-service. This one binds to
127.0.0.1 and talks to nobody else.

It also never opens a socket to the console. Editing wording has nothing to
do with the desk, so `mixerm8 --edit` works on a Mac with no X32 in the
building, which is where most of the writing actually happens.

TWO PLACES TO SAVE, and the difference is the point:

  repo   docs/data/<name>.json          the shipped generic example.
                                        Only offered in a source checkout.
                                        Git's business; you commit it.
  local  %APPDATA%/MixerM8/data/        this church's own wording, which
         <name>.local.json              names staff and lists the channel
                                        layout. Gitignored by convention
                                        and outside the repo in fact, so
                                        no pull, rebuild or MixerM8 update
                                        can overwrite it and no push can
                                        publish it.

The preview iframe is the real tablet app, served from the same `docs/`
the bridge serves, reading the draft instead of the files on disk. So what
you are looking at is not an approximation of the guide: it is the guide,
with your unsaved edits in it.
"""

from __future__ import annotations

import http.server
import json
import mimetypes
import sys
import threading
import unicodedata
from pathlib import Path

from . import config, validate
from .server import Server, resolve_within, webroot

REPO, LOCAL = "repo", "local"
DEFAULT_PORT = 8181

# Same as ruff's line-length for this repo. Measured in columns rather than
# characters, because a Korean glyph occupies two of them and half of every
# line in these files is Korean.
WIDTH = 100


# ---------------------------------------------------------------------------
# writing JSON back the way the files are already written
# ---------------------------------------------------------------------------

def _columns(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)


def _scalar(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _render(node, indent: int) -> str:
    pad = " " * indent
    if isinstance(node, dict):
        if not node:
            return "{}"
        if all(not isinstance(v, (dict, list)) for v in node.values()):
            one = "{ " + ", ".join(f"{_scalar(k)}: {_scalar(v)}"
                                   for k, v in node.items()) + " }"
            if indent + _columns(one) <= WIDTH:
                return one
        body = ",\n".join(f"{pad}  {_scalar(k)}: {_render(v, indent + 2)}"
                          for k, v in node.items())
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(node, list):
        if not node:
            return "[]"
        if all(not isinstance(v, (dict, list)) for v in node):
            one = "[" + ", ".join(_scalar(v) for v in node) + "]"
            if indent + _columns(one) <= WIDTH:
                return one
        body = ",\n".join(f"{pad}  {_render(v, indent + 2)}" for v in node)
        return "[\n" + body + "\n" + pad + "]"
    return _scalar(node)


def dumps(doc: dict) -> str:
    """Format a guide file the way the committed ones are formatted.

    Short `{ "en": ..., "ko": ... }` blocks stay on one line and long ones
    open up, with a blank line after every top-level section. This is not
    decoration: the whole value of saving to `docs/data` is that the diff
    afterwards shows the sentence somebody changed and nothing else, and
    `json.dump(indent=2)` would rewrite every file the first time anyone
    pressed Save. `test_the_editor_writes_the_files_exactly_as_they_are`
    pins it against the committed copies.
    """
    lines, items = [], list(doc.items())
    for i, (key, value) in enumerate(items):
        rendered = _render(value, 2)
        last = i == len(items) - 1
        lines.append(f"  {_scalar(key)}: {rendered}" + ("" if last else ","))
        if "\n" in rendered and not last:
            lines.append("")
    return "{\n" + "\n".join(lines) + "\n}\n"


# ---------------------------------------------------------------------------
# where a save can go
# ---------------------------------------------------------------------------

def repo_data_dir() -> Path | None:
    """docs/data, but only in a source checkout with git around it.

    An installed wheel and a frozen exe both resolve `webroot()` to files
    inside the install, which a MixerM8 update replaces wholesale. Writing
    a church's wording there would lose it on the next upgrade, so those
    two are offered `local` only.
    """
    root = webroot()
    if (root.parent / ".git").exists() and (root / "data").is_dir():
        return root / "data"
    return None


def local_data_dir() -> Path:
    """The override folder the bridge already reads `*.local.json` from."""
    return config.config_dir() / "data"


class Guide:
    """Every guide file, in memory, with somewhere to put it back."""

    def __init__(self, target: str = REPO) -> None:
        self.target = target if self.can(target) else LOCAL
        self.docs: dict[str, dict] = {}
        self.dirty: set[str] = set()
        self.load()

    # -- targets --------------------------------------------------------
    @staticmethod
    def can(target: str) -> bool:
        return target == LOCAL or repo_data_dir() is not None

    def path_for(self, name: str) -> Path:
        if self.target == LOCAL:
            return local_data_dir() / f"{name}.local.json"
        return repo_data_dir() / f"{name}.json"

    def set_target(self, target: str) -> None:
        if not self.can(target):
            raise ValueError(f"cannot save to {target} from here")
        self.target = target
        self.load()

    # -- content --------------------------------------------------------
    def load(self) -> None:
        """Start from what the tablet would show, for the chosen target.

        In `local` mode that means this church's file when it exists and
        the shipped example when it does not, which is the documented
        "copy the example and edit the copy" workflow with the copying
        already done.
        """
        self.docs = validate.load_documents(webroot() / "data")
        if self.target == LOCAL:
            for name in list(self.docs):
                path = local_data_dir() / f"{name}.local.json"
                if path.is_file():
                    try:
                        self.docs[name] = json.loads(path.read_text("utf-8"))
                    except ValueError:
                        pass    # a hand-mangled override is not worth crashing on
        self.dirty.clear()

    def replace(self, name: str, doc: dict) -> None:
        if name not in validate.DOCUMENTS:
            raise KeyError(name)
        if self.docs.get(name) != doc:
            self.docs[name] = doc
            self.dirty.add(name)

    def problems(self) -> list[str]:
        return validate.check(self.docs, webroot())

    def save(self) -> list[str]:
        written = []
        for name in sorted(self.dirty):
            path = self.path_for(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(dumps(self.docs[name]), "utf-8")
            written.append(str(path))
        self.dirty.clear()
        return written


# ---------------------------------------------------------------------------
# git, which this module does not run at all
# ---------------------------------------------------------------------------
#
# It used to read the branch and print the three commands for staging,
# committing and pushing, for you to run yourself. The rule behind that was
# right -- a church's own wording must not be pushable, so there is no
# button that could -- but repeating three shell lines on every screen of
# the editor was noise on the way to saying it, and where a save lands is
# already named in the header.
#
# So nothing here shells out to git, and `test_the_editor_offers_no_way_to_
# commit_or_push` now pins the stronger thing: this file imports nothing
# that could run a command, so there is no code path to a push to audit.

# ---------------------------------------------------------------------------
# the editor's own files
# ---------------------------------------------------------------------------

def editorroot() -> Path:
    """Where the editor's HTML lives, however MixerM8 is running.

    Deliberately not under `docs/`: that directory is published to GitHub
    Pages, and an editor served over HTTPS from a static host would be a
    Save button with nothing behind it.
    """
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidate = Path(bundled) / "editorroot"
        if candidate.is_dir():
            return candidate
    here = Path(__file__).resolve().parent
    for candidate in (here / "editorroot", here.parents[1] / "editor"):
        if (candidate / "index.html").is_file():
            return candidate
    raise FileNotFoundError("could not locate the MixerM8 editor")


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class EditorHandler(http.server.BaseHTTPRequestHandler):
    guide: Guide = None
    app_root: Path = None
    editor_root: Path = None
    protocol_version = "HTTP/1.1"

    # -- plumbing -------------------------------------------------------
    def _send(self, body: bytes, ctype: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload, status: int = 200) -> None:
        self._send(json.dumps(payload).encode("utf-8"),
                   "application/json; charset=utf-8", status)

    def _file(self, path: Path) -> None:
        if not path.is_file():
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith(("text/", "application/json", "application/javascript")):
            ctype += "; charset=utf-8"
        self._send(path.read_bytes(), ctype)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"null")

    def _is_local(self) -> bool:
        """Only this machine's browser may talk to a server that writes files.

        The socket is bound to loopback already; this rejects a page on some
        other site pointing a request at 127.0.0.1 under a hostname that
        resolves there.
        """
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return host in ("localhost", "127.0.0.1", "::1", "")

    # -- routes ---------------------------------------------------------
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if not self._is_local():
            self.send_error(403)
            return
        try:
            if path.startswith("/api/"):
                self._api_get(path)
            elif path == "/preview":
                self.send_response(301)
                self.send_header("Location", "/preview/")
                self.send_header("Content-Length", "0")
                self.end_headers()
            elif path.startswith("/preview/"):
                self._preview(path[len("/preview"):])
            else:
                self._editor(path)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_PUT(self) -> None:
        self.do_POST()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if not self._is_local():
            self.send_error(403)
            return
        g = self.guide
        try:
            if path.startswith("/api/doc/"):
                g.replace(path[len("/api/doc/"):], self._body())
            elif path == "/api/save":
                written = g.save()
                self._json({"written": written, **self._state()})
                return
            elif path == "/api/revert":
                g.load()
            elif path == "/api/target":
                g.set_target((self._body() or {}).get("target", REPO))
            else:
                self.send_error(404)
                return
            self._json(self._state())
        except (KeyError, ValueError) as exc:
            self._json({"error": str(exc)}, 400)
        except OSError as exc:
            self._json({"error": f"could not write: {exc}"}, 500)

    # -- handlers -------------------------------------------------------
    def _state(self) -> dict:
        g = self.guide
        return {
            "target": g.target,
            "repoAvailable": repo_data_dir() is not None,
            "willWriteTo": {name: str(g.path_for(name)) for name in g.docs},
            "dirty": sorted(g.dirty),
            "problems": g.problems(),
        }

    def _api_get(self, path: str) -> None:
        if path == "/api/guide":
            self._json({"docs": self.guide.docs, **self._state()})
        elif path == "/api/state":
            self._json(self._state())
        else:
            self.send_error(404)

    def _editor(self, path: str) -> None:
        if path in ("", "/"):
            path = "/index.html"
        target = resolve_within(self.editor_root, path)
        self._file(target) if target else self.send_error(403)

    def _preview(self, path: str) -> None:
        """The real tablet app, reading the draft instead of the disk."""
        if path in ("", "/"):
            path = "/index.html"

        # No console is attached to the editor, so the app finds no bridge
        # and renders in reference mode -- which is what a tablet on Pages
        # sees, and the honest thing to be previewing.
        if path in ("/state", "/events"):
            self.send_error(404)
            return

        if path.startswith("/data/"):
            name = path[len("/data/"):]
            local = name.endswith(".local.json")
            stem = name[:-len(".local.json")] if local else name.removesuffix(".json")
            if stem in self.guide.docs:
                # Which of the two names carries the draft decides what the
                # app's own footer says about whose wording this is, so the
                # preview tells the truth about the file being edited.
                editing_local = self.guide.target == LOCAL
                if local == editing_local:
                    self._send(dumps(self.guide.docs[stem]).encode("utf-8"),
                               "application/json; charset=utf-8")
                    return
                if local:
                    self.send_error(404)
                    return

        target = resolve_within(self.app_root, path)
        self._file(target) if target else self.send_error(403)

    def log_message(self, *args) -> None:
        pass


def serve(port: int = DEFAULT_PORT, target: str = REPO) -> Server:
    EditorHandler.guide = Guide(target)
    EditorHandler.app_root = webroot()
    EditorHandler.editor_root = editorroot()
    # Loopback only. This server writes files; nothing on the LAN gets a vote.
    server = Server(("127.0.0.1", port), EditorHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
