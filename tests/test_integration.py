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
