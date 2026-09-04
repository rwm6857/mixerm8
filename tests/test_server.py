from mixerm8 import server


def test_webroot_resolves_to_the_app():
    root = server.webroot()
    assert (root / "index.html").is_file()
    assert (root / "data" / "guides.json").is_file()


# ---------------------------------------------------------------------------
# A church's own wording lives outside the repo. These tests pin the
# precedence, because getting it backwards would either publish a staff
# member's name or silently ignore the file someone just edited.
# ---------------------------------------------------------------------------

class _StubConsole:
    """Enough of a Console for the HTTP layer to start."""

    def snapshot(self):
        return {"ok": False, "version": 0, "seen": {}}

    def wait_for_change(self, since, timeout):
        return 0


def _running_server():
    import contextlib
    import http.client

    srv = server.serve(_StubConsole(), 0)
    port = srv.server_address[1]

    @contextlib.contextmanager
    def request(path):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            conn.request("GET", path)      # sent raw: no client-side "/.." fixup
            yield conn.getresponse()
        finally:
            conn.close()

    return srv, request


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


