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
    del broken["equipment"][0]["todo"]        # leaves a "____" unexplained
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
