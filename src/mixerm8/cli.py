"""Command-line entry point for the MixerM8 bridge."""

from __future__ import annotations

import argparse

from . import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mixerm8", description="MixerM8 local bridge.")
    parser.add_argument("--version", action="version", version=f"mixerm8 {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    parser.parse_args(argv)
    print(f"mixerm8 {__version__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
