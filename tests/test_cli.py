from mixerm8 import __version__
from mixerm8.cli import build_parser


def test_version_is_set():
    assert __version__


def test_ip_is_optional_so_discovery_can_run():
    args = build_parser().parse_args([])
    assert args.ip is None
    assert args.port == 8080


def test_ip_and_port_parse():
    args = build_parser().parse_args(["192.168.1.50", "--port", "9000"])
    assert args.ip == "192.168.1.50"
    assert args.port == 9000
