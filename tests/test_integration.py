"""The bridge against a stand-in console.

`test_osc.py` proves the encoder cannot express an argument. This proves the
whole running bridge never sends one -- observed from where the desk sits,
which is the only vantage point that actually matters.
"""

from __future__ import annotations

import time

import fake_x32
from mixerm8 import console as console_mod


def _run_against_fake(desk, want, timeout=6.0):
    """Pump the fake desk until the bridge has settled, or we run out."""
    bridge = console_mod.Console("127.0.0.1")
    bridge.start()
    try:
        deadline = time.time() + timeout
        while time.time() < deadline:
            desk.serve_once(0.2)
            snap = bridge.snapshot()
            if all(snap.get(k) == v for k, v in want.items()):
                return snap, bridge
        return bridge.snapshot(), bridge
    finally:
        bridge.stop()
        bridge.join(timeout=2.0)


def test_the_running_bridge_never_sends_an_argument(monkeypatch):
    desk = fake_x32.FakeX32(port=0)
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    try:
        snap, _ = _run_against_fake(desk, {"ok": True, "screen": 0, "page": 0})

        assert desk.writes == [], f"the bridge tried to write: {desk.writes}"
        assert desk.asked, "the bridge never spoke to the console at all"
        assert snap["ok"], "the bridge never saw a reply"
    finally:
        desk.close()


def test_it_only_ever_asks_for_allowlisted_addresses(monkeypatch):
    desk = fake_x32.FakeX32(port=0)
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    try:
        _run_against_fake(desk, {"ok": True, "name": "Pastor"})

        from mixerm8.osc import ALLOWED_PATTERNS
        for address in desk.asked:
            assert any(p.match(address) for p in ALLOWED_PATTERNS), address
    finally:
        desk.close()


def test_it_reports_what_the_desk_is_showing(monkeypatch):
    desk = fake_x32.FakeX32(port=0)
    desk.pos = 1                       # Home screen, EQ tab, channel 7
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    try:
        snap, _ = _run_against_fake(desk, {"ok": True, "page": 4, "channel": 7})

        assert snap["screen"] == 0
        assert snap["page"] == 4
        assert snap["on_channel"] is True
        assert snap["channel"] == 7     # selidx 6 is channel 7 on the desk
    finally:
        desk.close()


def test_an_unmapped_tab_is_surfaced_rather_than_hidden(monkeypatch):
    """The bridge reports numbers; the tablet decides which have guides.

    An unclaimed number still has to reach the UI, because that is how a tab
    nobody has written about gets identified at the desk.
    """
    desk = fake_x32.FakeX32(port=0)
    desk.pos = 3                       # page 9, which no guide claims
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    try:
        snap, _ = _run_against_fake(desk, {"ok": True, "page": 9})

        assert 9 in snap["seen"], snap["seen"]
    finally:
        desk.close()


def test_the_channel_name_is_asked_for_once_per_selection(monkeypatch):
    """A name query per poll would triple the traffic to a busy desk."""
    desk = fake_x32.FakeX32(port=0)
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    try:
        _run_against_fake(desk, {"ok": True, "name": "Pastor"}, timeout=6.0)
        assert desk.asked.get("/ch/07/config/name", 0) == 1, desk.asked
    finally:
        desk.close()


# ---------------------------------------------------------------------------
# The desk is not always on, and on most Sundays the media PC is up first.
# These stand where the desk stands for the other half of the story: what
# the bridge does before a console exists, and after one stops answering.
# ---------------------------------------------------------------------------

def _local_only(monkeypatch, desk):
    """Point discovery at the loopback fake instead of the whole subnet."""
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    monkeypatch.setattr(console_mod, "BROADCAST", ("127.0.0.1",))


def test_the_bridge_comes_up_with_no_console_and_finds_one_later(monkeypatch):
    """The tablet has to load when the desk is cold. So the watcher starts
    without an address, hunts on a backoff, and latches on by itself."""
    desk = fake_x32.FakeX32(port=0)
    _local_only(monkeypatch, desk)
    try:
        bridge = console_mod.Console(None)
        assert bridge.snapshot()["searching"] is True
        assert bridge.snapshot()["ip"] is None

        bridge.start()
        try:
            deadline = time.time() + 8.0
            while time.time() < deadline:
                desk.serve_once(0.2)
                snap = bridge.snapshot()
                if snap["ok"] and snap["ip"]:
                    break
            assert snap["ip"] == "127.0.0.1", snap
            assert snap["searching"] is False, "still hunting after it found one"
            assert desk.writes == [], f"the hunt tried to write: {desk.writes}"
        finally:
            bridge.stop()
            bridge.join(timeout=2.0)
    finally:
        desk.close()


def test_a_desk_that_goes_quiet_is_reported_and_kept(monkeypatch):
    """Powering the desk off must not look like following it, and must not
    lose its address either -- it is still the desk we want when it's back."""
    desk = fake_x32.FakeX32(port=0)
    monkeypatch.setattr(console_mod, "OSC_PORT", desk.port)
    monkeypatch.setattr(console_mod, "SILENT_AFTER", 0.5)
    try:
        # Not _run_against_fake: that one stops the watcher on its way out,
        # and this test is about what the watcher does next.
        bridge = console_mod.Console("127.0.0.1")
        bridge.start()
        try:
            deadline = time.time() + 6.0
            while time.time() < deadline and not bridge.snapshot()["ok"]:
                desk.serve_once(0.2)
            assert bridge.snapshot()["ok"], "the bridge never saw the desk at all"
            desk.close()                       # the desk is switched off
            deadline = time.time() + 4.0
            while time.time() < deadline and bridge.snapshot()["ok"]:
                time.sleep(0.1)
            gone = bridge.snapshot()
            assert gone["ok"] is False, "stale state shown as live"
            assert gone["ip"] == "127.0.0.1", "forgot the desk it was watching"
            assert gone["searching"] is False, \
                "hunting mid-service could latch onto a second console"
        finally:
            bridge.stop()
            bridge.join(timeout=2.0)
    finally:
        desk.close()


def test_a_remembered_address_is_not_taken_on_trust(monkeypatch):
    """Last week's address is not evidence about this week's.

    A desk on a new DHCP lease used to mean a bridge that sat polling a dead
    address all morning. It hunts until something answers instead, whether
    or not it started with an address to try.
    """
    desk = fake_x32.FakeX32(port=0)
    _local_only(monkeypatch, desk)
    try:
        bridge = console_mod.Console("192.0.2.1")     # where it was last week
        assert bridge.snapshot()["searching"] is True
        bridge.start()
        try:
            deadline = time.time() + 8.0
            while time.time() < deadline:
                desk.serve_once(0.2)
                snap = bridge.snapshot()
                if snap["ok"]:
                    break
            assert snap["ip"] == "127.0.0.1", snap
            assert desk.writes == [], f"the hunt tried to write: {desk.writes}"
        finally:
            bridge.stop()
            bridge.join(timeout=2.0)
    finally:
        desk.close()


def test_the_connect_button_is_the_way_back_into_searching(monkeypatch):
    """Nothing else re-enters search mode once a desk has answered."""
    desk = fake_x32.FakeX32(port=0)
    _local_only(monkeypatch, desk)
    try:
        bridge = console_mod.Console("127.0.0.1")
        bridge.start()
        try:
            deadline = time.time() + 6.0
            while time.time() < deadline and not bridge.snapshot()["ok"]:
                desk.serve_once(0.2)
            assert bridge.snapshot()["ok"], "the bridge never saw the desk"
            assert bridge.snapshot()["searching"] is False, \
                "a reply should have ended the hunt"

            assert bridge.reconnect() is True
            assert bridge.reconnect() is False, "a held button is one press"
            assert bridge.snapshot()["searching"] is True
        finally:
            bridge.stop()
            bridge.join(timeout=2.0)
    finally:
        desk.close()
