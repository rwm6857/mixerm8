"""Checks GitHub Releases for a newer build. Never installs anything itself."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

from . import __version__

LATEST_URL = "https://api.github.com/repos/rwm6857/mixerm8/releases/latest"
RELEASES_URL = "https://github.com/rwm6857/mixerm8/releases/latest"


def _parse(tag: str) -> tuple:
    return tuple(int(p) for p in tag.lstrip("v").split(".") if p.isdigit())


def check() -> str | None:
    """Return the newer version string, or None. Silent when offline."""
    try:
        req = urllib.request.Request(
            LATEST_URL, headers={"Accept": "application/vnd.github+json"}
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            tag = json.load(resp).get("tag_name", "")
        if tag and _parse(tag) > _parse(__version__):
            return tag.lstrip("v")
    except (urllib.error.URLError, ValueError, OSError, TimeoutError):
        pass
    return None


def check_in_background(report) -> None:
    """Run check() off the startup path so no internet never means no booth."""
    def worker():
        newer = check()
        if newer:
            report(newer)
    threading.Thread(target=worker, daemon=True).start()
