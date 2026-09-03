"""Watches an X32 and reports what screen it is showing. Never writes to it."""

from __future__ import annotations

import socket
import threading
import time

from .osc import decode, encode_query

OSC_PORT = 10023
RESUBSCRIBE_EVERY = 8.0     # the X32 drops /xremote subscribers after ~10s
POLL_EVERY = 2.0            # ask outright too, in case a push is missed

# Confirmed against the X32 node list order.
SCREENS = {
    0: "Home", 1: "Meters", 2: "Routing", 3: "Setup", 4: "Library",
    5: "Effects", 6: "Monitor", 7: "USB", 8: "Scenes", 9: "Assign",
}

# UNCONFIRMED on the Compact. Numbers that arrive without a mapping surface
# in the tablet UI as "not mapped yet" so they can be identified at the desk
# and corrected here. See the "Mapping the tabs" section of the README.
CHAN_PAGES = {
    0: "Home", 1: "Config", 2: "Gate", 3: "Dynamics",
    4: "EQ", 5: "Sends", 6: "Main",
}

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
        for addr in ("255.255.255.255", "<broadcast>"):
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

    def __init__(self, ip: str):
        super().__init__(name="x32-watcher")
        self.ip = ip
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(0.4)
        # `changed` lets the SSE stream block until something actually moves,
        # instead of polling the snapshot in a loop.
        self.changed = threading.Condition()
        self.version = 0
        self._state = {
            "ok": False, "screen": None, "page": None,
            "channel": None, "name": None, "seen": {}, "last_seen": 0.0,
        }
        self._name_asked: int | None = None
        self._stopping = threading.Event()

    # -- outgoing -------------------------------------------------------
    def _query(self, address: str) -> None:
        """Send one argument-less OSC message. Cannot carry a value."""
        try:
            self.sock.sendto(encode_query(address), (self.ip, OSC_PORT))
        except OSError:
            pass

    # -- lifecycle ------------------------------------------------------
    def stop(self) -> None:
        self._stopping.set()

    def run(self) -> None:
        last_sub = last_poll = 0.0
        while not self._stopping.is_set():
            now = time.time()

            if now - last_sub > RESUBSCRIBE_EVERY:
                self._query("/xremote")
                last_sub = now

            if now - last_poll > POLL_EVERY:
                for address in _POLLED:
                    self._query(address)
                last_poll = now

            # Console has gone quiet: report it rather than showing stale state.
            if self._state["ok"] and now - self._state["last_seen"] > 5.0:
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
        fields: dict = {"ok": True, "last_seen": time.time()}

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
            page = self._state["page"]
            if page is not None and str(page) not in self._state["seen"]:
                self._state["seen"][str(page)] = CHAN_PAGES.get(page, "unknown")
                dirty = True
            if dirty:
                self.version += 1
                self.changed.notify_all()

    # -- outgoing snapshot ----------------------------------------------
    def snapshot(self) -> dict:
        with self.changed:
            s = dict(self._state)
            s["seen"] = dict(s["seen"])
            s["version"] = self.version
        s.pop("last_seen", None)
        s["screen_name"] = SCREENS.get(s["screen"])
        s["page_name"] = CHAN_PAGES.get(s["page"])
        # A channel page is only meaningful while the Home screen is showing.
        s["on_channel"] = s["screen"] == 0
        return s

    def wait_for_change(self, since: int, timeout: float) -> int:
        """Block until the snapshot version passes `since`, or timeout."""
        with self.changed:
            if self.version <= since:
                self.changed.wait(timeout)
            return self.version
