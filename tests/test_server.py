import pytest

from mixerm8 import server


def test_webroot_resolves_to_the_app():
    root = server.webroot()
    assert (root / "index.html").is_file()
    assert (root / "data" / "guides.json").is_file()


class _StubConsole:
    """Enough of a Console for the HTTP layer to start."""

    def __init__(self):
        self.presses = 0

    def snapshot(self):
        return {"ok": False, "ip": None, "searching": True, "version": 0, "seen": []}

    def wait_for_change(self, since, timeout):
        return 0

    def reconnect(self):
        self.presses += 1
        return self.presses == 1        # the real one debounces; so does this


def _running_server(console=None):
    import contextlib
    import http.client

    srv = server.serve(console or _StubConsole(), 0)
    port = srv.server_address[1]

    @contextlib.contextmanager
    def request(path, method="GET"):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            conn.request(method, path)    # sent raw: no client-side "/.." fixup
            yield conn.getresponse()
        finally:
            conn.close()

    return srv, request


# ---------------------------------------------------------------------------
# POST /reconnect is the only endpoint on this server that changes anything,
# and the reason the editor is a separate command on loopback is that a write
# endpoint here would be one URL away from every volunteer holding a tablet.
# So the exception is pinned: what it can do, and that nothing else joined it.
# ---------------------------------------------------------------------------

def test_a_tablet_can_ask_the_bridge_to_look_for_the_desk():
    import json

    console = _StubConsole()
    srv, request = _running_server(console)
    try:
        with request("/reconnect", method="POST") as r:
            assert r.status == 200
            body = json.loads(r.read())
        assert body["started"] is True
        assert console.presses == 1
        assert "searching" in body, "the tablet needs the state back to render"

        # Leaning on the button is one press, not a broadcast storm.
        with request("/reconnect", method="POST") as r:
            assert json.loads(r.read())["started"] is False
    finally:
        srv.shutdown()


def test_reconnect_is_the_only_post_the_bridge_answers():
    srv, request = _running_server()
    try:
        for path in ("/", "/index.html", "/data/guides.json", "/state", "/events"):
            with request(path, method="POST") as r:
                assert r.status == 404, f"POST {path} returned {r.status}"
    finally:
        srv.shutdown()


def test_only_one_endpoint_on_the_lan_server_writes_anything():
    """A second do_POST branch should have to be argued for, not slipped in."""
    from pathlib import Path
    source = Path(server.__file__).read_text("utf-8")
    branches = [ln.strip() for ln in source.splitlines()
                if ln.strip().startswith("if path ==") or ln.strip().startswith("elif path ==")]
    assert 'if path == "/reconnect":' in branches, branches


# ---------------------------------------------------------------------------
# A church's own wording lives outside the repo. These tests pin the
# precedence, because getting it backwards would either publish a staff
# member's name or silently ignore the file someone just edited.
# ---------------------------------------------------------------------------

def test_a_local_data_file_beats_the_bundled_example(tmp_path, monkeypatch):
    monkeypatch.setattr(server.config, "config_dir", lambda: tmp_path)
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "guides.local.json").write_text(
        '{"whose": "this church"}', "utf-8"
    )

    srv, request = _running_server()
    try:
        with request("/data/guides.local.json") as r:
            assert r.status == 200
            assert b"this church" in r.read()
    finally:
        srv.shutdown()


def test_missing_local_file_404s_so_the_app_falls_back(tmp_path, monkeypatch):
    """The app asks for the local copy first; a 404 is the normal answer."""
    monkeypatch.setattr(server.config, "config_dir", lambda: tmp_path)

    srv, request = _running_server()
    try:
        with request("/data/guides.local.json") as r:
            assert r.status == 404
        with request("/data/guides.json") as r:
            assert r.status == 200       # the shipped example still serves
    finally:
        srv.shutdown()


def test_the_override_cannot_serve_arbitrary_files(tmp_path, monkeypatch):
    monkeypatch.setattr(server.config, "config_dir", lambda: tmp_path)
    (tmp_path / "data").mkdir()
    (tmp_path / "secret.txt").write_text("not for the tablet", "utf-8")

    srv, request = _running_server()
    try:
        for path in ("/data/../secret.txt", "/data/sub/guides.local.json",
                     "/data/guides.local.yaml"):
            with request(path) as r:
                assert r.status in (403, 404), f"{path} returned {r.status}"
    finally:
        srv.shutdown()


def test_static_paths_cannot_climb_out_of_the_webroot_over_http():
    """The guard is a path comparison, so a sibling prefix cannot sneak past."""
    srv, request = _running_server()
    try:
        for path in ("/../pyproject.toml", "/../../etc/passwd"):
            with request(path) as r:
                assert r.status == 403, f"{path} returned {r.status}"
    finally:
        srv.shutdown()


# ---------------------------------------------------------------------------
# The content's own shape is checked in tests/test_content.py, against the
# rules in mixerm8.validate that the editor shares. What is left here is the
# one question that is about the app rather than the wording.
# ---------------------------------------------------------------------------

def _load(path):
    import json
    return json.loads(path.read_text("utf-8"))


def _roles():
    return _load(server.webroot() / "data" / "roles.json")["roles"]


def test_the_app_can_draw_every_theme_and_icon_a_role_asks_for():
    """roles.json names them; app.js and styles.css have to know them.

    Drift here is invisible in the suite otherwise, and shows up on the
    tablet as a station with no icon or the wrong colour.
    """
    app = (server.webroot() / "app.js").read_text("utf-8")
    css = (server.webroot() / "styles.css").read_text("utf-8")
    themes = set()
    for role in _roles():
        assert f'{role["icon"]}:' in app, f"app.js has no icon named {role['icon']!r}"
        assert f'[data-theme="{role["theme"]}"]' in css, \
            f"styles.css has no palette named {role['theme']!r}"
        themes.add(role["theme"])
    assert len(themes) == len(_roles()), "two stations share a palette"


# ---------------------------------------------------------------------------
# A church's own pictures and video.
#
# This is the one place the bridge hands out something from outside the web
# root that is not a *.json wording file, so it is the one place worth
# probing from the outside. The rule it narrows -- "must not become a
# second file server" -- is kept by the shape of what follows: one flat
# directory, GET only, and a fixed list of types.
# ---------------------------------------------------------------------------

@pytest.fixture
def media(tmp_path, monkeypatch):
    monkeypatch.setattr(server.config, "config_dir", lambda: tmp_path)
    folder = tmp_path / "media"
    folder.mkdir()
    (folder / "booth.jpg").write_bytes(b"\xff\xd8\xff")
    (folder / "walk.mp4").write_bytes(b"\x00\x00\x00 ftyp")
    (folder / "notes.txt").write_text("not media")
    (folder / "page.html").write_text("<script>alert(1)</script>")
    (tmp_path / "secret.json").write_text('{"channel": "layout"}')
    return folder


def test_a_picture_in_the_media_folder_is_served(media):
    found = server.media_file("booth.jpg")
    assert found and found[1] == "image/jpeg"
    assert server.media_file("walk.mp4")[1] == "video/mp4"


def test_only_the_types_on_the_list_are_served(media):
    """`mimetypes` varies by machine and would happily hand out an .html
    off a directory a volunteer can drop files into."""
    assert server.media_file("notes.txt") is None
    assert server.media_file("page.html") is None


def test_the_media_folder_is_one_flat_directory(media):
    """No subdirectories and nothing that could be a path, refused on the
    name before the filesystem is touched at all."""
    (media / "sub").mkdir()
    (media / "sub" / "deep.jpg").write_bytes(b"x")
    for name in ("sub/deep.jpg", "../secret.json", "..%2Fsecret.json",
                 "/etc/hosts", "", ".", ".."):
        assert server.media_file(name) is None, name


def test_a_file_that_is_not_there_is_not_a_hint(media):
    assert server.media_file("nothing-here.jpg") is None


def test_the_bridge_serves_media_over_http(media):
    srv, request = _running_server()
    try:
        with request("/media/booth.jpg") as r:
            assert r.status == 200
            assert r.getheader("Content-Type") == "image/jpeg"
        for path in ("/media/page.html", "/media/notes.txt",
                     "/media/../secret.json", "/media/nothing.jpg"):
            with request(path) as r:
                assert r.status == 404, path
    finally:
        srv.shutdown()


def test_the_media_folder_is_read_only_from_the_lan(media):
    """The bridge answers exactly one POST, and this is not it -- a volunteer
    holding a tablet must not be able to put a file on the booth machine."""
    srv, request = _running_server()
    try:
        with request("/media/booth.jpg", method="POST") as r:
            assert r.status in (404, 501)
    finally:
        srv.shutdown()
