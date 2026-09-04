"""A stand-in X32, and the read-only check that makes it worth having.

The X32's own rule is that a message WITH arguments sets a value and one
WITHOUT asks for one. So the way to prove MixerM8 cannot touch a desk is not
to inspect our own code -- it is to stand where the desk stands and confirm
that every packet that arrives has an empty typetag.

Used two ways:
  * `test_integration.py` drives it in-process, in the normal test run.
  * `python tests/fake_x32.py` runs it standalone on port 10023 so you can
    point a real browser at a real bridge without a real console. Worth doing
    before a Sunday if you have changed anything in `console.py`.
"""

from __future__ import annotations

import socket
import struct
import threading
import time

OSC_PORT = 10023

# screen, CHAN page, selidx. No guide claims tab 9, deliberately, so the
# tablet's "not mapped yet" path gets exercised too.
SCRIPT = [
    (0, 0, 6),
    (0, 4, 6),
    (0, 3, 6),
    (0, 9, 6),
    (8, 0, 6),
]


def pad4(n: int) -> int:
    return (4 - (n % 4)) % 4


def read_string(data: bytes, i: int) -> tuple[str, int]:
    end = data.index(b"\x00", i)
    s = data[i:end].decode("latin-1")
    i = end + 1
    return s, i + pad4(i)


def parse(data: bytes) -> tuple[str, str]:
    """Return (address, typetag). An empty typetag means this was a read."""
    address, i = read_string(data, 0)
    if i >= len(data):
        return address, ""
    tags, _ = read_string(data, i)
    return address, tags


def encode(address: str, typ: str, value) -> bytes:
    out = address.encode() + b"\x00"
    out += b"\x00" * pad4(len(out))
    tags = ("," + typ).encode() + b"\x00"
    out += tags + b"\x00" * pad4(len(tags))
    if typ == "i":
        out += struct.pack(">i", value)
    elif typ == "s":
        v = value.encode() + b"\x00"
        out += v + b"\x00" * pad4(len(v))
    return out


class FakeX32:
    """Answers the queries MixerM8 makes, and records anything it should not."""

    def __init__(self, port: int = OSC_PORT, channel_name: str = "Pastor",
                 script: list | None = None):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.port = self.sock.getsockname()[1]
        self.channel_name = channel_name
        self.writes: list[tuple[str, str]] = []   # the thing that must stay empty
        self.asked: dict[str, int] = {}
        # A test that walks the tabs needs more of them than the shipped
        # script offers, and appending to that would move the numbers the
        # other tests select by position.
        self.script = script or SCRIPT
        self.pos = 0

    def state(self) -> tuple[int, int, int]:
        return self.script[self.pos]

    def serve_once(self, timeout: float = 0.4) -> str | None:
        """Handle one packet. Returns the address, or None on timeout."""
        self.sock.settimeout(timeout)
        try:
            data, addr = self.sock.recvfrom(4096)
        except (TimeoutError, OSError):
            return None

        address, tags = parse(data)
        # An argument on an outgoing message would be a write to the desk.
        if tags not in ("", ","):
            self.writes.append((address, tags))
        self.asked[address] = self.asked.get(address, 0) + 1

        screen, page, selidx = self.state()
        if address == "/-stat/screen/screen":
            self.sock.sendto(encode(address, "i", screen), addr)
        elif address == "/-stat/screen/CHAN/page":
            self.sock.sendto(encode(address, "i", page), addr)
        elif address == "/-stat/selidx":
            self.sock.sendto(encode(address, "i", selidx), addr)
        elif address.endswith("/config/name"):
            self.sock.sendto(encode(address, "s", self.channel_name), addr)
        elif address in ("/info", "/xinfo"):
            self.sock.sendto(encode(address, "s", "V2.07"), addr)
        return address

    def close(self) -> None:
        self.sock.close()


def _standalone() -> int:
    desk = FakeX32()
    print(f"fake X32 on 127.0.0.1:{desk.port} — run: mixerm8 127.0.0.1")

    def advance():
        while True:
            time.sleep(4.0)
            desk.pos = (desk.pos + 1) % len(desk.script)
            s, p, _ = desk.state()
            print(f"  desk moved to screen={s} page={p}")

    threading.Thread(target=advance, daemon=True).start()
    try:
        while True:
            desk.serve_once(1.0)
    except KeyboardInterrupt:
        pass
    print("\n--- what the bridge asked for ---")
    for address, n in sorted(desk.asked.items()):
        print(f"  {n:5d}  {address}")
    print(f"\nwrite attempts: {len(desk.writes)}")
    return 1 if desk.writes else 0


if __name__ == "__main__":
    raise SystemExit(_standalone())
