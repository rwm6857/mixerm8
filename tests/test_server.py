from pathlib import Path

from mixerm8 import server


def test_webroot_resolves_to_the_app():
    root = server.webroot()
    assert (root / "index.html").is_file()
    assert (root / "data" / "guides.json").is_file()


def test_guides_cover_every_mapped_channel_page():
    """A tab the console can report should have something to say about it."""
    import json

    from mixerm8.console import CHAN_PAGES

    guides = json.loads((server.webroot() / "data" / "guides.json").read_text("utf-8"))
    missing = [name for name in CHAN_PAGES.values() if name not in guides["pages"]]
    assert not missing, f"no guide written for: {missing}"


def test_every_guide_is_bilingual():
    import json

    guides = json.loads((server.webroot() / "data" / "guides.json").read_text("utf-8"))
    for group in ("pages", "screens"):
        for key, entry in guides[group].items():
            assert entry["body"].get("en"), f"{group}.{key} missing English"
            assert entry["body"].get("ko"), f"{group}.{key} missing Korean"


def test_static_paths_cannot_escape_the_webroot():
    root = server.webroot().resolve()
    escaped = (root / "../../../etc/passwd").resolve()
    assert not str(escaped).startswith(str(root))
    assert isinstance(root, Path)
