"""The walkthrough that records what number the desk gives each channel tab.

Two kinds of test here. The read-only ones drive the real watcher against
`fake_x32`, because that is the only vantage point from which "it never
writes to the desk" means anything. The rest drive a scripted stand-in, so
that what is under test is the walk's own decisions rather than UDP timing.
"""

from __future__ import annotations

import json

import pytest

import fake_x32
from mixerm8 import console as console_mod
from mixerm8 import editor, learn


@pytest.fixture(autouse=True)
def brisk(monkeypatch):
    """The walk waits for a human. The tests should not."""
    monkeypatch.setattr(learn, "SETTLE", 0.0)
    monkeypatch.setattr(learn, "STEP_TIMEOUT", 0.3)
    monkeypatch.setattr(learn, "CONNECT_TIMEOUT", 3.0)
    monkeypatch.setattr(learn, "SLICE", 0.05)


class ScriptedDesk:
    """A console that moves to the next tab each time it is waited on.

    Stands in for somebody pressing buttons. `presses` is what the desk shows
    next, in order; when it runs dry the desk has stopped moving, which is
    the case the keyboard fallback exists for.
    """

    ip = "192.0.2.1"

    def __init__(self, presses, page=None):
        self.presses = list(presses)
        self.page = page
        self.version = 0
        self.seen = [] if page is None else [page]

    def snapshot(self):
        return {"ok": True, "on_channel": True, "page": self.page,
                "version": self.version, "seen": list(self.seen)}

    def wait_for_change(self, since, timeout):
        if self.presses:
            self.page = self.presses.pop(0)
            if self.page not in self.seen:
                self.seen = sorted(self.seen + [self.page])
            self.version += 1
        return self.version

    def stop(self):
        pass


def answers(*steps, write="n", move="n"):
    """A stand-in for the keyboard, answering each prompt by which one it is.

    `steps` are consumed by the per-tab fallback in order; anything after
    them skips. The two decisions that are not part of the walk -- whether to
    move a number that is already taken, and whether to write at the end --
    are named rather than queued, so a test cannot accidentally answer one
    with a leftover.
    """
    pending = list(steps)
    def ask(prompt=""):
        if "Write these to" in prompt:
            return write
        if "Move it to" in prompt:
            return move
        return pending.pop(0) if pending else "s"
    return ask


@pytest.fixture
def guide(tmp_path, monkeypatch):
    """A draft that writes into a temporary directory, never the checkout."""
    monkeypatch.setattr(editor, "local_data_dir", lambda: tmp_path)
    g = editor.Guide(editor.LOCAL)
    return g


def tabs_of(guide):
    return learn.numbers(guide.docs["guides"])


# ---------------------------------------------------------------------------
# what it does to the desk, seen from the desk
# ---------------------------------------------------------------------------

def _walk_against_fake(monkeypatch, guide, ask, script):
    desk = fake_x32.FakeX32(port=0, script=script)
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    bridge = console_mod.Console("127.0.0.1")
    bridge.start()
    import threading
    stop = threading.Event()

    def pump():
        while not stop.is_set():
            desk.serve_once(0.05)

    pumper = threading.Thread(target=pump, daemon=True)
    pumper.start()
    try:
        learn.walk(bridge, guide, ask=ask)
        return desk
    finally:
        stop.set()
        pumper.join(timeout=2.0)
        bridge.stop()
        bridge.join(timeout=2.0)
        desk.close()


def test_learning_the_tabs_never_writes_to_the_desk(monkeypatch, guide):
    """The whole point, checked from where the console stands."""
    desk = _walk_against_fake(monkeypatch, guide, answers(),
                              [(0, 0, 6), (0, 1, 6), (0, 2, 6)])
    assert desk.writes == [], f"learn tried to write: {desk.writes}"
    assert desk.asked, "learn never spoke to the console at all"


def test_learn_asks_the_desk_for_nothing_the_bridge_does_not(monkeypatch, guide):
    """A new address here would be a new way to reach the desk."""
    desk = _walk_against_fake(monkeypatch, guide, answers(),
                              [(0, 0, 6), (0, 1, 6)])
    from mixerm8.osc import ALLOWED_PATTERNS
    for address in desk.asked:
        assert any(p.match(address) for p in ALLOWED_PATTERNS), address


# ---------------------------------------------------------------------------
# the walk's own decisions
# ---------------------------------------------------------------------------

def test_a_tab_press_at_the_desk_is_what_records_the_number(guide, capsys):
    """Press them out of order and the guide follows the desk, not a list."""
    names = list(tabs_of(guide))
    desk = ScriptedDesk([5, 3, 1] + list(range(20, 20 + len(names))), page=9)
    learn.walk(desk, guide, ask=answers(write="y"))

    after = tabs_of(guide)
    assert [after[n] for n in names[:3]] == [5, 3, 1]


def test_the_walk_follows_the_guides_own_order_rather_than_a_list_here(guide, capsys):
    desk = ScriptedDesk(range(30, 40), page=99)
    learn.walk(desk, guide, ask=answers())
    asked = [ln.split("Press ", 1)[1].split(".")[0]
             for ln in capsys.readouterr().out.splitlines() if "  Press " in ln]
    assert asked == list(tabs_of(guide))


def test_learn_never_invents_a_guide_entry(guide):
    """A number nobody has written about stays unwritten.

    An entry with an empty body would fail the content checks, and titling
    one "Tab 7" would be a guess about what tab 7 is.
    """
    before = set(guide.docs["guides"]["pages"])
    desk = ScriptedDesk(range(40, 50), page=99)
    learn.walk(desk, guide, ask=answers(write="y"))
    assert set(guide.docs["guides"]["pages"]) == before

    with pytest.raises(KeyError):
        learn.set_number(guide.docs["guides"], "Tab 7", 7)


def test_a_number_already_taken_is_queried_rather_than_moved_silently(guide, capsys):
    names = list(tabs_of(guide))
    # A third press lands back on a number an earlier tab already claimed,
    # which is much more likely a mis-press than a real remap.
    desk = ScriptedDesk([4, 7, 4], page=99)
    learn.walk(desk, guide, ask=answers(move="n", write="y"))

    out = capsys.readouterr().out
    assert "already recorded" in out
    after = tabs_of(guide)
    assert after[names[0]] == 4, "the earlier tab lost its number"
    assert after[names[2]] != 4, "the later tab quietly took it"


def test_nothing_is_written_until_it_is_confirmed(guide):
    path = guide.path_for("guides")
    desk = ScriptedDesk(range(60, 70), page=99)
    learn.walk(desk, guide, ask=answers(write="n"))
    assert not path.exists(), "declining still wrote the file"
    assert guide.dirty == set()


def test_a_step_that_gets_no_answer_falls_back_to_the_keyboard(guide, capsys):
    """A desk that has gone quiet must not strand somebody mid-walk."""
    names = list(tabs_of(guide))
    desk = ScriptedDesk([], page=None)        # a desk that never answers
    learn.walk(desk, guide, ask=answers("7", write="y"))

    out = capsys.readouterr().out
    assert "Nothing moved on the desk" in out
    assert tabs_of(guide)[names[0]] == 7, "the typed number was not recorded"


def test_a_desk_sitting_on_the_tab_can_confirm_it_where_it_is(guide, capsys):
    """Step one usually asks for the tab the desk already shows."""
    names = list(tabs_of(guide))
    desk = ScriptedDesk([], page=3)
    learn.walk(desk, guide, ask=answers("", write="y"))

    assert "still showing tab 3" in capsys.readouterr().out
    assert tabs_of(guide)[names[0]] == 3


def test_quitting_mid_walk_writes_nothing(guide):
    path = guide.path_for("guides")
    desk = ScriptedDesk([], page=99)
    learn.walk(desk, guide, ask=answers("q"))
    assert not path.exists()


def test_a_learned_number_survives_the_editors_formatter(guide):
    """Saving must not reformat the file around the number it just changed."""
    names = list(tabs_of(guide))
    desk = ScriptedDesk([6, 5, 4] + list(range(70, 80)), page=99)
    learn.walk(desk, guide, ask=answers(write="y"))

    text = guide.path_for("guides").read_text("utf-8")
    assert editor.dumps(json.loads(text)) == text
    assert '"number": 6' in text
    assert json.loads(text)["pages"][names[0]]["number"] == 6


def test_recording_a_number_leaves_the_wording_alone(guide):
    """set_number touches one key and copies the rest through untouched."""
    doc = guide.docs["guides"]
    name = next(iter(doc["pages"]))
    out = learn.set_number(doc, name, 6)

    assert out["pages"][name]["number"] == 6
    assert out["pages"][name]["body"] == doc["pages"][name]["body"]
    assert list(out["pages"][name]) == list(doc["pages"][name])
    assert out is not doc, "an in-place edit would never be saved"


def test_a_keyboard_that_goes_away_writes_nothing(guide):
    """Ctrl-D mid-walk used to end in a traceback. It has to stop cleanly.

    The walk lets EOFError out because the caller already treats it the same
    as Ctrl-C -- what matters is that it happens before anything is written.
    """
    def vanished(prompt=""):
        raise EOFError

    path = guide.path_for("guides")
    desk = ScriptedDesk([], page=99)
    with pytest.raises(EOFError):
        learn.walk(desk, guide, ask=vanished)
    assert not path.exists()
    assert guide.dirty == set()


def test_the_prompts_line_up_whatever_the_tabs_are_called(guide, capsys):
    """A ragged right edge in a dark booth is worse than it sounds."""
    desk = ScriptedDesk(range(80, 90), page=99)
    learn.walk(desk, guide, ask=answers())
    arrows = [ln.index("->") for ln in capsys.readouterr().out.splitlines()
              if "  Press " in ln and "->" in ln]
    assert len(set(arrows)) == 1, "the recorded numbers do not line up"
