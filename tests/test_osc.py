"""The read-only guarantee is the whole safety story. Test it hard."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from mixerm8 import osc


def test_query_is_four_byte_aligned():
    for address in ("/xremote", "/-stat/selidx", "/ch/01/config/name"):
        packet = osc.encode_query(address)
        assert len(packet) % 4 == 0


def test_query_carries_an_empty_typetag():
    # ",\0" plus padding and nothing after it: on the X32 this reads a value.
    packet = osc.encode_query("/-stat/selidx")
    address, rest = packet.split(b"\x00", 1)
    assert address == b"/-stat/selidx"
    assert packet.endswith(b",\x00\x00\x00")


def test_no_encoder_can_attach_an_argument():
    # encode_query takes exactly one parameter. If that ever changes, this
    # fails and someone has to think about why.
    import inspect
    sig = inspect.signature(osc.encode_query)
    assert list(sig.parameters) == ["address"]


@pytest.mark.parametrize("address", [
    "/ch/01/mix/fader",     # a real write target on the desk
    "/main/st/mix/on",
    "/config/mute",
    "not-an-address",
    "",
])
def test_addresses_outside_the_allowlist_are_refused(address):
    with pytest.raises(osc.ReadOnlyViolation):
        osc.encode_query(address)


def test_allowlisted_addresses_pass():
    for address in ("/xremote", "/xinfo", "/info", "/-stat/screen/screen",
                    "/ch/07/config/name"):
        assert osc.encode_query(address)


def test_only_one_socket_send_exists_in_the_package():
    """Every outgoing byte must go through the guarded helper.

    A second sendto() anywhere in the package would be a way around the
    allowlist, so the count is pinned here on purpose.
    """
    pkg = Path(osc.__file__).parent
    hits = [
        (p.name, i + 1, line.strip())
        for p in pkg.glob("*.py")
        for i, line in enumerate(p.read_text("utf-8").splitlines())
        if ".sendto(" in line
    ]
    assert len(hits) == 2, f"unexpected sendto() calls: {hits}"
    assert all("encode_query" in line for _, _, line in hits), hits


def test_decode_round_trips_an_int():
    body = b"/-stat/selidx\x00\x00\x00" + b",i\x00\x00" + struct.pack(">i", 6)
    assert osc.decode(body) == ("/-stat/selidx", [6])


def test_decode_returns_none_on_junk():
    assert osc.decode(b"\x01\x02\x03") is None
    assert osc.decode(b"") is None
