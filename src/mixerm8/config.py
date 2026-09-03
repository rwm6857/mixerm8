"""Remembers the console address so nobody has to retype an IP on a Sunday."""

from __future__ import annotations

import json
import os
from pathlib import Path


def config_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "MixerM8"


def config_path() -> Path:
    return config_dir() / "config.json"


def load() -> dict:
    try:
        return json.loads(config_path().read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save(**fields) -> None:
    data = load()
    data.update(fields)
    try:
        config_dir().mkdir(parents=True, exist_ok=True)
        config_path().write_text(json.dumps(data, indent=2), "utf-8")
    except OSError:
        pass    # a read-only profile is not worth crashing the booth over
