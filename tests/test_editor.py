"""The editor: where it writes, where it refuses to, and what it writes.

The interesting properties are not "does the form work" but the two the
guide's privacy rests on -- that a church's own wording lands outside the
repository and that the editor cannot be reached from the LAN -- plus the
formatting, because a Save that rewrites all six files is a Save nobody
will use twice.
"""

import contextlib
import http.client
import json
import re
from pathlib import Path

import pytest

from mixerm8 import editor, server, validate


def _data_files():
    return sorted((server.webroot() / "data").glob("*.json"))


# ---------------------------------------------------------------------------
# writing files back
# ---------------------------------------------------------------------------

def test_the_editor_writes_the_files_exactly_as_they_are():
    """Formatting a committed file is a no-op, so a Save shows one change.

    Without this the first press of Save reformats every guide file and the
    diff buries the sentence somebody actually edited.
    """
    for path in _data_files():
        text = path.read_text("utf-8")
        assert editor.dumps(json.loads(text)) == text, \
            f"{path.name} is not in the form the editor writes"


def test_formatting_survives_a_second_pass():
    for path in _data_files():
        once = editor.dumps(json.loads(path.read_text("utf-8")))
        assert editor.dumps(json.loads(once)) == once


def test_a_short_bilingual_block_stays_on_one_line():
    out = editor.dumps({"title": {"en": "Home", "ko": "홈"}})
    assert '"title": { "en": "Home", "ko": "홈" }' in out


def test_a_long_bilingual_block_opens_up():
    long = "word " * 30
    out = editor.dumps({"body": {"en": long, "ko": long}})
    assert '"body": {\n' in out


def test_korean_counts_as_two_columns_when_deciding():
    """Half of every line in these files is Korean, and it is double-width.

    Measured in characters instead, a line of Korean fits the limit twice
    over and then runs off the side of the editor it was formatted for.
    """
    korean = {"a": {"en": "x", "ko": "가" * 60}}
    assert '"a": {\n' in editor.dumps(korean)
    assert len(json.dumps(korean, ensure_ascii=False)) < editor.WIDTH


def test_unicode_is_never_escaped():
    assert "홈" in editor.dumps({"t": {"ko": "홈"}})


# ---------------------------------------------------------------------------
# where a save goes
# ---------------------------------------------------------------------------

def test_this_checkout_can_write_the_example_files():
    assert editor.repo_data_dir() == server.webroot() / "data"


def test_a_churchs_own_wording_lands_outside_the_repository():
    """The whole privacy split rests on this, so it is asserted, not assumed.

    A local file that landed in docs/data would be one `git add .` away from
    publishing a staff member's name and the channel layout.
    """
    local = editor.local_data_dir().resolve()
    repo = editor.repo_data_dir().parent.parent.resolve()
    assert repo not in local.parents and local != repo


def test_a_local_save_cannot_be_reached_by_a_pull_or_an_update(monkeypatch, tmp_path):
    """It is not in the checkout and not in the install, so nothing replaces it."""
    monkeypatch.setattr(editor.config, "config_dir", lambda: tmp_path)
    guide = editor.Guide(editor.LOCAL)
    guide.replace("media", {**guide.docs["media"], "version": 99})
    written = [Path(p).resolve() for p in guide.save()]

    assert written, "nothing was written"
    install = server.webroot().resolve()
    for path in written:
        assert install not in path.parents, "an update would replace this"
        assert tmp_path.resolve() in path.parents, "not in the override folder"
        assert path.name.endswith(".local.json")


def test_without_a_checkout_only_the_local_copy_is_offered(monkeypatch, tmp_path):
    """A wheel and a frozen exe both get replaced wholesale by an update."""
    monkeypatch.setattr(editor, "repo_data_dir", lambda: None)
    monkeypatch.setattr(editor.config, "config_dir", lambda: tmp_path)
    assert editor.Guide(editor.REPO).target == editor.LOCAL


def test_git_has_nothing_to_say_about_local_wording(monkeypatch, tmp_path):
    monkeypatch.setattr(editor.config, "config_dir", lambda: tmp_path)
    status = editor.git_status(editor.Guide(editor.LOCAL))
    assert status["available"] is False
    assert "outside the repository" in status["why"]


def test_the_editor_offers_no_way_to_commit_or_push():
    """Read-only by construction: `git` only ever appears with a read verb.

    The rule the editor exists under is that a church's own wording is not
    pushable, and a button that could push it is the thing that would make
    that untrue, so there is no code path to one.
    """
    source = Path(editor.__file__).read_text("utf-8")

    # One place runs git, and every call into it names a read.
    assert source.count("subprocess.run") == 1
    calls = re.findall(r'_git\(repo, "([a-z-]+)"', source)
    assert calls, "the guard found no git calls to check"
    assert set(calls) <= {"rev-parse", "status", "log", "diff"}, calls

    # And the browser has no endpoint to ask for one: the commands are text.
    handled = re.findall(r'path == "(/api/[a-z]+)"', source)
    assert "/api/commit" not in handled and "/api/push" not in handled


# ---------------------------------------------------------------------------
# the draft
# ---------------------------------------------------------------------------

@pytest.fixture
def guide():
    return editor.Guide(editor.REPO)


def test_a_fresh_draft_is_what_ships(guide):
    assert set(guide.docs) == set(validate.DOCUMENTS)
    assert guide.dirty == set()
    assert guide.problems() == []


def test_editing_marks_only_that_file(guide):
    guide.replace("media", {**guide.docs["media"], "version": 7})
    assert guide.dirty == {"media"}


def test_replacing_a_file_with_itself_is_not_a_change(guide):
    guide.replace("media", guide.docs["media"])
    assert guide.dirty == set()


def test_an_unknown_file_is_refused(guide):
    with pytest.raises(KeyError):
        guide.replace("../../etc/passwd", {})


def test_the_draft_is_checked_against_the_same_rules_as_ci(guide):
    broken = json.loads(json.dumps(guide.docs["media"]))
    gear = next(p for p in broken["pages"] if p["id"] == "equipment")
    del gear["items"][0]["todo"]              # leaves a "____" unexplained
    guide.replace("media", broken)
    assert any("blank with no 'todo'" in p for p in guide.problems())


# ---------------------------------------------------------------------------
# over HTTP
# ---------------------------------------------------------------------------

def _running_editor(tmp_path, monkeypatch):
    monkeypatch.setattr(editor.config, "config_dir", lambda: tmp_path)
    srv = editor.serve(0)
    port = srv.server_address[1]

    @contextlib.contextmanager
    def request(path, method="GET", host="127.0.0.1", body=None):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            conn.request(method, path, body=body, headers={"Host": host})
            yield conn.getresponse()
        finally:
            conn.close()

    return srv, request


def test_the_editor_listens_on_loopback_only(tmp_path, monkeypatch):
    """It writes files. Nothing on the church wifi gets a vote."""
    srv, _ = _running_editor(tmp_path, monkeypatch)
    try:
        assert srv.server_address[0] == "127.0.0.1"
    finally:
        srv.shutdown()


def test_a_request_from_another_hostname_is_refused(tmp_path, monkeypatch):
    """Guards against a web page pointing a name that resolves here at us."""
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        with request("/api/guide", host="evil.example.com") as r:
            assert r.status == 403
        with request("/api/guide", host="localhost") as r:
            assert r.status == 200
    finally:
        srv.shutdown()


def test_the_preview_serves_the_draft_rather_than_the_disk(tmp_path, monkeypatch):
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        edited = json.loads(json.dumps(editor.EditorHandler.guide.docs["media"]))
        edited["intro"]["en"] = "A sentence that is not in any file."
        with request("/api/doc/media", "PUT", body=json.dumps(edited)) as r:
            assert r.status == 200
        with request("/preview/data/media.json") as r:
            assert b"not in any file" in r.read()
        # ...and the file on disk is untouched until somebody presses Save.
        assert "not in any file" not in \
            (server.webroot() / "data" / "media.json").read_text("utf-8")
    finally:
        srv.shutdown()


def test_the_preview_has_no_bridge_so_it_renders_as_a_tablet_would(tmp_path, monkeypatch):
    """No console is attached to the editor, and pretending otherwise would
    preview a Mixer tab that does not match any real state."""
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        for path in ("/preview/state", "/preview/events"):
            with request(path) as r:
                assert r.status == 404
    finally:
        srv.shutdown()


def test_the_preview_shows_local_wording_only_when_that_is_what_is_edited(
        tmp_path, monkeypatch):
    """The app picks its footer from which filename answered, so the preview
    has to answer on the same one the editor is about to write."""
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        with request("/preview/data/media.local.json") as r:
            assert r.status == 404          # editing the example
        with request("/api/target", "POST", body=json.dumps({"target": "local"})) as r:
            assert r.status == 200
        with request("/preview/data/media.local.json") as r:
            assert r.status == 200          # editing this church's copy
    finally:
        srv.shutdown()


def test_the_editor_cannot_serve_files_outside_its_own_two_roots(tmp_path, monkeypatch):
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        for path in ("/../pyproject.toml", "/preview/../../pyproject.toml",
                     "/../../etc/passwd"):
            with request(path) as r:
                assert r.status in (403, 404), f"{path} returned {r.status}"
    finally:
        srv.shutdown()


def test_saving_writes_and_clears(tmp_path, monkeypatch):
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        with request("/api/target", "POST", body=json.dumps({"target": "local"})) as r:
            r.read()
        doc = json.loads(json.dumps(editor.EditorHandler.guide.docs["misc"]))
        doc["intro"]["en"] = "Reworded by the editor."
        with request("/api/doc/misc", "PUT", body=json.dumps(doc)) as r:
            assert json.loads(r.read())["dirty"] == ["misc"]
        with request("/api/save", "POST", body="{}") as r:
            out = json.loads(r.read())
        assert out["dirty"] == []
        written = tmp_path / "data" / "misc.local.json"
        assert written.is_file()
        assert "Reworded by the editor." in written.read_text("utf-8")
        # written in the same canonical form as everything else
        assert editor.dumps(json.loads(written.read_text("utf-8"))) == \
            written.read_text("utf-8")
    finally:
        srv.shutdown()


# ---------------------------------------------------------------------------
# Pictures. Uploading one widened the bridge's override folder, which had been
# JSON-only on the grounds that a second lookup did not pay for itself. A photo
# of the actual booth is worth more than any generic diagram, so it now does --
# but only as the same shape of lookup, not as a file server.
# ---------------------------------------------------------------------------

def test_a_filename_off_a_camera_becomes_a_boring_one():
    assert editor.slug_filename("Booth Photo (1).PNG") == "booth-photo-1.png"
    assert editor.slug_filename("한글.jpg") == "image.jpg"
    assert editor.slug_filename("../../etc/passwd.png") == "passwd.png"


def test_only_pictures_are_accepted():
    for name in ("evil.php", "notes.txt", "run.exe", "guide.json", "noextension"):
        assert editor.slug_filename(name) is None, name
    for name in ("a.svg", "a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif"):
        assert editor.slug_filename(name), name


def test_a_picture_too_big_for_the_church_wifi_is_refused(monkeypatch, tmp_path):
    monkeypatch.setattr(editor.config, "config_dir", lambda: tmp_path)
    guide = editor.Guide(editor.LOCAL)
    with pytest.raises(ValueError, match="limit"):
        guide.save_image("big.png", b"x" * (editor.MAX_IMAGE_BYTES + 1))


def test_a_picture_is_addressed_the_same_way_whichever_target_wrote_it(
        monkeypatch, tmp_path):
    """One `src` in the JSON, two places on disk.

    A guide written on a Mac and copied onto the booth machine has to keep
    working, so the path in the file cannot name either location.
    """
    monkeypatch.setattr(editor.config, "config_dir", lambda: tmp_path)
    for target in (editor.REPO, editor.LOCAL):
        guide = editor.Guide(target)
        assert guide.save_image("Booth.png", b"x") == "img/local/booth.png"
        assert (guide.image_dir() / "booth.png").is_file()
        (guide.image_dir() / "booth.png").unlink()


def test_uploaded_pictures_are_never_committed():
    """A photo of your own booth is as much yours as the wording is."""
    import subprocess

    guide = editor.Guide(editor.REPO)
    folder = guide.image_dir()
    folder.mkdir(parents=True, exist_ok=True)
    probe = folder / "test-probe.png"
    probe.write_bytes(b"x")
    try:
        out = subprocess.run(("git", "check-ignore", str(probe)),
                             cwd=folder.parents[2], capture_output=True, text=True)
        assert out.returncode == 0, f"{probe} is not gitignored"
    finally:
        probe.unlink()


def test_the_override_serves_pictures_but_only_one_filename_of_them():
    from mixerm8.server import override_file

    assert override_file("/img/local/booth.png")[1] == "image/png"
    assert override_file("/data/media.local.json")[1].startswith("application/json")
    for path in ("/img/local/../../secret.png", "/img/local/sub/booth.png",
                 "/img/local/notes.txt", "/img/local/", "/img/booth.png",
                 "/data/media.local.yaml", "/data/sub/media.json"):
        assert override_file(path) is None, path


def test_uploading_and_reading_a_picture_back(tmp_path, monkeypatch):
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        with request("/api/target", "POST", body=json.dumps({"target": "local"})) as r:
            r.read()
        # percent-encoded, because that is how a file picker's name arrives
        with request("/api/image/Booth%20Photo.PNG", "POST", body=b"not-really-a-png") as r:
            out = json.loads(r.read())
        assert out["src"] == "img/local/booth-photo.png"
        assert out["images"] == ["img/local/booth-photo.png"]
        assert (tmp_path / "img" / "booth-photo.png").is_file()

        with request("/preview/img/local/booth-photo.png") as r:
            assert r.status == 200
            assert r.read() == b"not-really-a-png"
        with request("/preview/img/local/nothing.png") as r:
            assert r.status == 404
    finally:
        srv.shutdown()


def test_an_uploaded_picture_cannot_climb_out_of_its_folder(tmp_path, monkeypatch):
    srv, request = _running_editor(tmp_path, monkeypatch)
    try:
        with request("/api/image/evil.php", "POST", body=b"<?php") as r:
            assert r.status == 400
            assert b"not a picture" in r.read()
        for path in ("/preview/img/local/..%2f..%2fpyproject.toml",
                     "/preview/img/local/../../pyproject.toml"):
            with request(path) as r:
                assert r.status in (403, 404), f"{path} returned {r.status}"
    finally:
        srv.shutdown()


# ---------------------------------------------------------------------------
# Pages, from the editor's side.
# ---------------------------------------------------------------------------

def test_adding_a_page_leaves_the_guide_valid(guide):
    """The bug this whole model exists to fix.

    Turning a layer on used to declare a tab whose content did not exist,
    which the rules rejected and the editor gave you no way to fill. A new
    page has to be legal the moment it is born, or adding one is a trap.
    """
    doc = json.loads(json.dumps(guide.docs["audio"]))
    doc["pages"].append({"id": "stage-box", "kind": "equipment",
                         "label": {"en": "Stage box", "ko": "스테이지 박스"},
                         "items": []})
    guide.replace("audio", doc)
    assert guide.problems() == []
    assert "stage-box" not in [p["id"] for p in validate.visible_pages(doc)]
