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


def test_the_bridge_serves_the_guide_even_with_no_console(monkeypatch):
    """The media PC boots before the sound desk most Sundays.

    Quitting at that moment would take the guide down with it -- for all
    four stations, three of which have no console at all -- and it would do
    it in a window that is minimised, so nobody would see why.
    """
    from mixerm8 import cli, config, update

    built = {}

    class _Watcher:
        def __init__(self, ip):
            built["ip"] = ip
            self.ip = None
        def start(self): pass
        def stop(self): pass
        def snapshot(self): return {"seen": []}

    served = []

    def _sleep(_seconds):
        raise KeyboardInterrupt        # stands in for closing the window

    monkeypatch.setattr(config, "load", dict)
    monkeypatch.setattr(config, "save", lambda **_: None)
    monkeypatch.setattr(cli, "Console", _Watcher)
    monkeypatch.setattr(cli, "discover", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("the bridge blocked on discovery before serving")))
    monkeypatch.setattr(cli, "serve", lambda console, port: served.append(port) or
                        types.SimpleNamespace(shutdown=lambda: None))
    monkeypatch.setattr(cli, "local_ip", lambda: "192.0.2.9")
    monkeypatch.setattr(update, "check_in_background", lambda *_a, **_k: None)
    monkeypatch.setattr(cli.time, "sleep", _sleep)

    assert cli.main([]) == 0
    assert built["ip"] is None, "it invented an address rather than hunting"
    assert served == [8080], "the app was never served"
