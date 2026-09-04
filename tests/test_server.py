from mixerm8 import server


def test_webroot_resolves_to_the_app():
    root = server.webroot()
    assert (root / "index.html").is_file()
    assert (root / "data" / "guides.json").is_file()


def test_guides_cover_every_mapped_channel_page():
    """A tab the console can report should have something to say about it."""
    import json

    from mixerm8.console import CHAN_PAGES

    guides = json.loads((server.webroot() / "data" / "guides.json").read_text("utf-8"))
    missing = [name for name in CHAN_PAGES.values() if name not in guides["pages"]]
    assert not missing, f"no guide written for: {missing}"


def test_every_guide_is_bilingual():
    import json

    guides = json.loads((server.webroot() / "data" / "guides.json").read_text("utf-8"))
    for group in ("pages", "screens"):
        for key, entry in guides[group].items():
            assert entry["body"].get("en"), f"{group}.{key} missing English"
            assert entry["body"].get("ko"), f"{group}.{key} missing Korean"




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


def _data_files():
    root = server.webroot() / "data"
    return sorted(root.glob("*.json"))


def _load(path):
    import json
    return json.loads(path.read_text("utf-8"))


def test_a_blank_is_never_silent():
    """Every "____" has a `todo` at or above it saying what is missing.

    A blank with no explanation is just a gap a volunteer reads past. The
    rule is that unknown state is a display case, not an omission, so the
    two travel together or the suite fails. Tracked through lists as well
    as objects, because problem steps are a list of language blocks.
    """
    problems = []

    def walk(where, node, covered):
        if isinstance(node, dict):
            covered = covered or "todo" in node
            for k, v in node.items():
                walk(f"{where}.{k}", v, covered)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(f"{where}[{i}]", item, covered)
        elif isinstance(node, str) and "____" in node and not covered:
            problems.append(f"{where} has a blank with no 'todo' above it")

    for path in _data_files():
        walk(path.name, _load(path), False)

    assert not problems, problems


def test_every_todo_is_bilingual():
    missing = []

    def walk(where, node):
        if isinstance(node, dict):
            if isinstance(node.get("todo"), dict):
                for lang in ("en", "ko"):
                    if not node["todo"].get(lang):
                        missing.append(f"{where}.todo missing {lang}")
            for k, v in node.items():
                walk(f"{where}.{k}", v)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(f"{where}[{i}]", item)

    for path in _data_files():
        walk(path.name, _load(path))

    assert not missing, missing


# ---------------------------------------------------------------------------
# The stations. A QR code on a wall points at one of these, so a role whose
# file is missing is a volunteer standing at a station with a broken page and
# no way to fix it.
#
# Which layers a station has is declared per role, not assumed: `misc` is
# questions and policies with no equipment behind it, so it has none of the
# three. What is pinned is that a declared layer is complete and an
# undeclared one is absent, because a tab offering an empty checklist is
# worse than no tab at all.
# ---------------------------------------------------------------------------

LAYERS = ("checklist", "problems", "flow")


def _roles():
    return _load(server.webroot() / "data" / "roles.json")["roles"]


def test_every_role_has_a_content_file():
    roles = _roles()
    assert [r["id"] for r in roles] == ["audio", "media", "livestream", "misc"]
    for role in roles:
        path = server.webroot() / "data" / f"{role['id']}.json"
        assert path.is_file(), f"no content file for role {role['id']}"


def test_role_ids_survive_being_put_in_a_url():
    """They end up in a QR code as "#audio/ko", so keep them boring."""
    import re

    for role in _roles():
        assert re.fullmatch(r"[a-z][a-z0-9-]*", role["id"]), role["id"]


def test_a_role_declares_exactly_the_layers_its_file_carries():
    for role in _roles():
        data = _load(server.webroot() / "data" / f"{role['id']}.json")
        declared = set(role["layers"])
        assert declared <= set(LAYERS), f"{role['id']} declares an unknown layer"
        for layer in LAYERS:
            if layer in declared:
                assert data.get(layer), f"{role['id']} declares {layer} but has none"
            else:
                assert layer not in data, \
                    f"{role['id']} carries a {layer} it does not declare, so nothing shows it"


def test_every_station_introduces_itself_and_answers_questions():
    """The station's front page is the landing view, so it is never empty."""
    for role in _roles():
        data = _load(server.webroot() / "data" / f"{role['id']}.json")
        for lang in ("en", "ko"):
            assert data["intro"].get(lang), f"{role['id']}.intro missing {lang}"
        assert data["faq"], f"{role['id']} has no questions on its front page"
        for i, item in enumerate(data["faq"]):
            for lang in ("en", "ko"):
                assert item["q"].get(lang), f"{role['id']}.faq[{i}].q missing {lang}"
                assert item["a"].get(lang), f"{role['id']}.faq[{i}].a missing {lang}"


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


def test_every_diagram_points_at_a_file_that_ships():
    """A diagram is optional, but a broken one is a broken image on a tablet."""
    missing = []

    def walk(where, node):
        if isinstance(node, dict):
            fig = node.get("diagram")
            src = fig.get("src") if isinstance(fig, dict) else None
            if src:
                if not (server.webroot() / src).is_file():
                    missing.append(f"{where}.diagram -> {src} does not exist")
                for lang in ("en", "ko"):
                    assert node["diagram"]["alt"].get(lang), f"{where}.diagram.alt missing {lang}"
            for k, v in node.items():
                walk(f"{where}.{k}", v)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(f"{where}[{i}]", item)

    for path in _data_files():
        walk(path.name, _load(path))

    assert not missing, missing


def test_every_declared_layer_is_complete_in_both_languages():
    for role in _roles():
        data = _load(server.webroot() / "data" / f"{role['id']}.json")
        layers = role["layers"]

        for i, item in enumerate(data["checklist"] if "checklist" in layers else []):
            for lang in ("en", "ko"):
                assert item["text"].get(lang), \
                    f"{role['id']}.checklist[{i}] missing {lang}"

        for i, prob in enumerate(data["problems"] if "problems" in layers else []):
            for lang in ("en", "ko"):
                assert prob["title"].get(lang), \
                    f"{role['id']}.problems[{i}].title missing {lang}"
                assert prob["symptom"].get(lang), \
                    f"{role['id']}.problems[{i}].symptom missing {lang}"
            assert prob["steps"], f"{role['id']}.problems[{i}] has no steps"
            for j, step in enumerate(prob["steps"]):
                for lang in ("en", "ko"):
                    assert step.get(lang), \
                        f"{role['id']}.problems[{i}].steps[{j}] missing {lang}"

        for i, step in enumerate(data["flow"] if "flow" in layers else []):
            for key in ("when", "title", "detail"):
                for lang in ("en", "ko"):
                    assert step[key].get(lang), \
                        f"{role['id']}.flow[{i}].{key} missing {lang}"


def test_the_problem_pages_are_problem_shaped():
    """Titles describe what the volunteer notices, not what the gear is.

    A page called "Gate" only helps someone who already knows the word.
    The layer exists for the volunteer who does not, so each title has to
    read as a complaint.
    """
    for role in _roles():
        if "problems" not in role["layers"]:
            continue
        data = _load(server.webroot() / "data" / f"{role['id']}.json")
        for prob in data["problems"]:
            title = prob["title"]["en"]
            assert len(title.split()) >= 3, \
                f"{role['id']}: {title!r} reads like a component, not a symptom"
