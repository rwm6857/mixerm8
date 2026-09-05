"""Watches an X32 and reports what screen it is showing. Never writes to it."""

from __future__ import annotations

import socket
import threading
import time

from .osc import decode, encode_query

OSC_PORT = 10023
RESUBSCRIBE_EVERY = 8.0     # the X32 drops /xremote subscribers after ~10s
POLL_EVERY = 2.0            # ask outright too, in case a push is missed

# The desk announces nothing. It has no mDNS record and sends no beacon: it
# answers /info when broadcast at, and pushes changes only for the ~10s an
# /xremote subscription lasts. So there is nothing to sit and listen for,
# and finding a console means shouting for one. The cost of shouting is
# three small datagrams, which is why the backoff below tops out where it
# does rather than giving up.
BROADCAST = ("255.255.255.255", "<broadcast>")
SEARCH_TIMEOUT = 0.6        # how long one broadcast waits for an answer
SEARCH_FIRST = 2.0          # first hunt this soon after coming up cold
SEARCH_MAX = 30.0           # ...backing off to this while nothing answers
RECONNECT_EVERY = 2.0       # a volunteer leaning on the button is one press
SILENT_AFTER = 5.0          # no reply for this long and the desk is "off"

CHANNEL_SCREEN = 0          # the channel strip; its tab decides what shows

# This module reports numbers and nothing else. Which screen a number *is*
# lives in docs/data/guides.json, on the guide for that screen, because the
# numbers are unverified on the Compact and a church correcting one should
# not need a new release to do it. The tablet does the lookup, so a remap
# takes effect on a reload without restarting the bridge. `mixerm8 --learn`
# records them from the desk.

# Polled every POLL_EVERY seconds. All argument-less, therefore all reads.
_POLLED = (
    "/-stat/screen/screen",
    "/-stat/screen/CHAN/page",
    "/-stat/selidx",
)


def discover(timeout: float = 1.5) -> list[dict]:
    """Broadcast /info and collect X32 replies. Saves typing an IP address."""
    found: dict[str, dict] = {}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(0.3)
    try:
        for addr in BROADCAST:
            try:
                sock.sendto(encode_query("/info"), (addr, OSC_PORT))
            except OSError:
                pass
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                data, (ip, _) = sock.recvfrom(4096)
            except TimeoutError:
                continue
            except OSError:
                break
            msg = decode(data)
            if msg and msg[0] == "/info" and ip not in found:
                args = msg[1]
                found[ip] = {
                    "ip": ip,
                    "name": args[1] if len(args) > 1 else "",
                    "model": args[2] if len(args) > 2 else "",
                    "firmware": args[3] if len(args) > 3 else "",
                }
    finally:
        sock.close()
    return list(found.values())


class Console(threading.Thread):
    """Subscribes to one console and keeps a snapshot of what it is showing."""

    daemon = True

    def __init__(self, ip: str | None = None):
        super().__init__(name="x32-watcher")
        # `ip` is None when nobody has told us where the desk is and nothing
        # has answered yet. The watcher runs anyway: the media PC boots
        # before the sound desk does most Sundays, and a bridge that gave up
        # at that moment would take the whole guide down with it.
        self.ip = ip
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(0.4)
        # `changed` lets the SSE stream block until something actually moves,
        # instead of polling the snapshot in a loop.
        self.changed = threading.Condition()
        self.version = 0
        self._state = {
            # Searching until a desk has actually answered, even when an
            # address was remembered from last week: nothing here is
            # evidence that address is still right, and a desk on a new DHCP
            # lease is the ordinary way for it to be wrong. Once one answers
            # this stays off -- see _hunt().
            "ok": False, "ip": ip, "searching": True,
            "screen": None, "page": None,
            "channel": None, "name": None, "seen": [], "last_seen": 0.0,
        }
        self._name_asked: int | None = None
        self._stopping = threading.Event()
        # Hunt bookkeeping. `_hunt_now` and `_hunt_delay` are also written
        # by reconnect() from an HTTP thread; the worst a race can do is
        # delay a broadcast by one pass of the loop.
        self._hunt_at = 0.0
        self._hunt_delay = SEARCH_FIRST
        self._hunt_now = False
        self._last_press = 0.0
        self._last_sub = self._last_poll = 0.0

    # -- outgoing -------------------------------------------------------
    def _query(self, address: str) -> None:
        """Send one argument-less OSC message. Cannot carry a value."""
        if not self.ip:
            return
        try:
            self.sock.sendto(encode_query(address), (self.ip, OSC_PORT))
        except OSError:
            pass

    # -- lifecycle ------------------------------------------------------
    def stop(self) -> None:
        self._stopping.set()

    def reconnect(self) -> bool:
        """Hunt for the desk right now. False if asked again too soon.

        This is what the tablet's Connect button reaches. It is the only
        way back into search mode once a console has answered, which is
        deliberate -- see _hunt().
        """
        now = time.time()
        if now - self._last_press < RECONNECT_EVERY:
            return False
        self._last_press = now
        self._hunt_delay = SEARCH_FIRST
        self._hunt_now = True
        self._update(searching=True)
        return True

    def _hunt(self) -> None:
        """Broadcast for a desk. The only thing that ever sets self.ip.

        Hunting runs until a desk answers and never restarts on its own. It
        covers the two ways an address can be missing at startup -- none
        remembered, or one remembered that has since moved -- and stops for
        good at the first reply, from a broadcast or an ordinary poll alike.

        It does not restart when a desk goes quiet later, and that asymmetry
        is the point: a desk that stops answering mid-service is still the
        desk we want, we keep polling its address, and it comes back by
        itself when the power does. Hunting at that moment could instead
        latch onto a second console in the building and follow the wrong one
        without anybody noticing. Getting back out is the button's job.
        """
        self._hunt_now = False
        self._hunt_at = time.time() + self._hunt_delay
        self._hunt_delay = min(self._hunt_delay * 2, SEARCH_MAX)

        found = [c["ip"] for c in discover(SEARCH_TIMEOUT)]
        if not found:
            return

        ip = self.ip if self.ip in found else found[0]
        self._hunt_delay = SEARCH_FIRST
        if ip != self.ip:
            # Whatever the last desk was showing is not this one's business.
            self.ip = ip
            self._name_asked = None
            self._update(ip=ip, ok=False, screen=None, page=None,
                         channel=None, name=None, seen=[])
        self._update(searching=False)
        self._last_sub = self._last_poll = 0.0    # subscribe and poll at once

    def run(self) -> None:
        while not self._stopping.is_set():
            now = time.time()

            if self._hunt_now or (self._state["searching"] and now >= self._hunt_at):
                self._hunt()
                now = time.time()

            if now - self._last_sub > RESUBSCRIBE_EVERY:
                self._query("/xremote")
                self._last_sub = now

            if now - self._last_poll > POLL_EVERY:
                for address in _POLLED:
                    self._query(address)
                self._last_poll = now

            # Console has gone quiet: report it rather than showing stale state.
            if self._state["ok"] and now - self._state["last_seen"] > SILENT_AFTER:
                self._update(ok=False)

            try:
                data, _ = self.sock.recvfrom(4096)
            except TimeoutError:
                continue
            except OSError:
                time.sleep(0.5)
                continue

            msg = decode(data)
            if not msg or not msg[1]:
                continue
            self._handle(*msg)

    def _handle(self, address: str, args: list) -> None:
        # A reply is the proof the hunt was after, whoever asked for it --
        # a broadcast or an ordinary poll of a remembered address.
        fields: dict = {"ok": True, "searching": False, "last_seen": time.time()}

        if address == "/-stat/screen/screen":
            fields["screen"] = args[0]
        elif address == "/-stat/screen/CHAN/page":
            fields["page"] = args[0]
        elif address == "/-stat/selidx":
            ch = args[0] + 1
            if ch != self._state["channel"]:
                fields["channel"] = ch
                fields["name"] = None
                self._name_asked = None
        elif address.endswith("/config/name"):
            fields["name"] = args[0] or None

        self._update(**fields)

        # Ask for the channel's name once per selection, for display only.
        ch = self._state["channel"]
        if ch and self._state["name"] is None and self._name_asked != ch:
            self._name_asked = ch
            self._query(f"/ch/{ch:02d}/config/name")

    def _update(self, **fields) -> None:
        with self.changed:
            dirty = False
            for key, value in fields.items():
                if self._state.get(key) != value:
                    self._state[key] = value
                    if key != "last_seen":
                        dirty = True
            # Every tab number this desk has reported, whether or not a guide
            # claims it. Kept sorted so the value-compare in snapshot() stays
            # stable and an unchanged console never pushes a frame.
            page = self._state["page"]
            if page is not None and page not in self._state["seen"]:
                self._state["seen"] = sorted(self._state["seen"] + [page])
                dirty = True
            if dirty:
                self.version += 1
                self.changed.notify_all()

    # -- outgoing snapshot ----------------------------------------------
    def snapshot(self) -> dict:
        with self.changed:
            s = dict(self._state)
            s["seen"] = list(s["seen"])
            s["version"] = self.version
        s.pop("last_seen", None)
        # A channel page is only meaningful while the Home screen is showing.
        # This one stays here rather than moving into the guide with the
        # names: it decides which reading to believe, so a content edit must
        # not be able to make the bridge report a tab the desk is not on.
        s["on_channel"] = s["screen"] == CHANNEL_SCREEN
        return s

    def wait_for_change(self, since: int, timeout: float) -> int:
        """Block until the snapshot version passes `since`, or timeout."""
        with self.changed:
            if self.version <= since:
                self.changed.wait(timeout)
            return self.version
