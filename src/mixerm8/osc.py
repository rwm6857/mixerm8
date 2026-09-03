"""Minimal OSC codec with a structural read-only guarantee.

The X32 protocol has one property this whole module is built around:

    An OSC message WITH arguments sets a value.
    An OSC message WITHOUT arguments asks for one.

So this module offers no way to attach an argument to an outgoing message.
`encode_query` takes an address and nothing else. There is no code path,
anywhere in MixerM8, that can transmit an argument to the console -- which
means the bridge cannot alter the desk even if the rest of the code is wrong.

The one deliberate casualty is `/node`, which is a read but takes a string
argument. We query concrete addresses instead and keep the invariant intact.
"""

from __future__ import annotations

import re
import struct

# Every address the bridge is permitted to transmit, matched in full.
#
# These are patterns rather than prefixes on purpose. A prefix of "/ch/"
# would also admit "/ch/01/mix/fader" -- harmless while arguments are
# impossible, but the allowlist should not lean on that. Two independent
# guards are better than one.
ALLOWED_PATTERNS = tuple(re.compile(p + r"\Z") for p in (
    r"/xremote",                        # subscribe to the console's pushes
    r"/xinfo",                          # console identity
    r"/info",                           # discovery broadcast
    r"/-stat/[A-Za-z0-9/_-]*",          # which screen/tab/channel is showing
    r"/ch/\d{2}/config/name",           # channel names, for display only
    r"/auxin/\d{2}/config/name",
    r"/bus/\d{2}/config/name",
))


class ReadOnlyViolation(RuntimeError):
    """Raised when something tries to transmit outside the allowlist."""


def pad4(n: int) -> int:
    """Bytes of padding needed to reach the next 4-byte boundary."""
    return (4 - (n % 4)) % 4


def encode_query(address: str) -> bytes:
    """Encode an argument-less OSC message.

    This is the only encoder in MixerM8. It cannot express an argument,
    which is what makes the read-only guarantee structural rather than a
    matter of everyone remembering to be careful.
    """
    if not address.startswith("/"):
        raise ReadOnlyViolation(f"not an OSC address: {address!r}")
    if not any(p.match(address) for p in ALLOWED_PATTERNS):
        raise ReadOnlyViolation(
            f"address {address!r} is not in the read-only allowlist"
        )
    out = address.encode("ascii") + b"\x00"
    out += b"\x00" * pad4(len(out))
    tags = b",\x00"
    return out + tags + b"\x00" * pad4(len(tags))


def _read_string(data: bytes, i: int) -> tuple[str, int]:
    end = data.index(b"\x00", i)
    s = data[i:end].decode("latin-1")
    i = end + 1
    return s, i + pad4(i)


def decode(data: bytes) -> tuple[str, list] | None:
    """Decode an incoming OSC message, or None if it is unparseable.

    Unparseable packets are normal -- other gear on the network broadcasts
    too -- so this never raises.
    """
    try:
        address, i = _read_string(data, 0)
        if i >= len(data):
            return address, []
        tags, i = _read_string(data, i)
        args: list = []
        for t in tags.lstrip(","):
            if t == "i":
                args.append(struct.unpack(">i", data[i:i + 4])[0])
                i += 4
            elif t == "f":
                args.append(struct.unpack(">f", data[i:i + 4])[0])
                i += 4
            elif t == "s":
                s, i = _read_string(data, i)
                args.append(s)
            elif t == "b":
                n = struct.unpack(">i", data[i:i + 4])[0]
                i += 4 + n + pad4(n)
                args.append(None)
            else:
                return None
        return address, args
    except (ValueError, IndexError, struct.error, UnicodeDecodeError):
        return None
