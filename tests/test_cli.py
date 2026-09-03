from mixerm8 import __version__
from mixerm8.cli import main


def test_version_is_set():
    assert __version__


def test_main_exits_clean(capsys):
    assert main([]) == 0
    assert __version__ in capsys.readouterr().out
