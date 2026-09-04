import types
from pathlib import Path

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


def test_learn_takes_the_same_console_address_as_the_bridge():
    args = build_parser().parse_args(["--learn", "192.168.1.50"])
    assert args.learn and args.ip == "192.168.1.50"


def test_learning_the_tabs_never_starts_the_update_check(monkeypatch):
    """A release notice printed from a daemon thread would land mid-prompt."""
    from mixerm8 import cli, config, editor, update

    def boom(*_a, **_k):
        raise AssertionError("the update check ran during --learn")

    monkeypatch.setattr(update, "check_in_background", boom)
    monkeypatch.setattr(config, "save", lambda **_: None)
    monkeypatch.setattr(cli, "resolve_ip", lambda _: "192.0.2.1")
    monkeypatch.setattr(cli.sys.stdin, "isatty", lambda: True, raising=False)
    monkeypatch.setattr(cli, "Console", lambda ip: types.SimpleNamespace(
        ip=ip, start=lambda: None, stop=lambda: None))
    monkeypatch.setattr(editor, "Guide", lambda *a, **k: types.SimpleNamespace(
        target=editor.LOCAL, docs={}, path_for=lambda n: Path("x")))
    monkeypatch.setattr(cli.learn_mod, "walk", lambda *a, **k: 0)

    assert cli.main(["--learn"]) == 0
