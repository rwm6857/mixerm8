"""Command-line entry point for the MixerM8 bridge."""

from __future__ import annotations

import argparse
import sys
import time
import webbrowser

from . import __version__, config, update
from .console import Console, discover
from .server import local_ip, serve

DEFAULT_PORT = 8080


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="mixerm8",
        description="Read-only bridge between an X32 and the booth tablet.",
    )
    p.add_argument("ip", nargs="?", help="console IP address (default: last used, "
                                         "or auto-discovered)")
    p.add_argument("--port", type=int, default=DEFAULT_PORT,
                   help=f"port to serve the tablet app on (default {DEFAULT_PORT})")
    p.add_argument("--discover", action="store_true",
                   help="list consoles on the network and exit")
    p.add_argument("--open", action="store_true",
                   help="open the app in a browser on this machine")
    p.add_argument("--no-update-check", action="store_true",
                   help="skip the check for a newer MixerM8 release")
    p.add_argument("--version", action="version", version=f"mixerm8 {__version__}")
    return p


def resolve_ip(requested: str | None) -> str | None:
    """Explicit argument, then remembered address, then the network."""
    if requested:
        return requested
    remembered = config.load().get("ip")
    if remembered:
        print(f"Using remembered console address {remembered}")
        return remembered
    print("Looking for a console on the network...")
    found = discover()
    if not found:
        return None
    c = found[0]
    label = " ".join(x for x in (c["model"], c["name"]) if x)
    print(f"Found {label or 'a console'} at {c['ip']}")
    return c["ip"]


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.discover:
        found = discover()
        if not found:
            print("No consoles answered. Check the network cable and that the "
                  "desk is switched on.")
            return 1
        for c in found:
            print(f"  {c['ip']:<16} {c['model']} {c['name']} {c['firmware']}")
        return 0

    ip = resolve_ip(args.ip)
    if not ip:
        print("Could not find a console, and none was given.")
        print("Find the IP on the desk: SETUP -> Network, then run:")
        print("    mixerm8 192.168.1.50")
        return 1

    console = Console(ip)
    console.start()
    config.save(ip=ip)

    try:
        server = serve(console, args.port)
    except OSError as exc:
        print(f"Could not start the web server on port {args.port}: {exc}")
        print("Another copy of MixerM8 may already be running.")
        return 1

    url = f"http://{local_ip()}:{args.port}"
    print()
    print(f"  Watching the console at {ip}  (read-only)")
    print(f"  Open this on the tablet:  {url}")
    print()

    if not args.no_update_check:
        update.check_in_background(
            lambda v: print(f"  A newer MixerM8 is available ({v}): "
                            f"{update.RELEASES_URL}\n")
        )
    if args.open:
        webbrowser.open(f"http://127.0.0.1:{args.port}")

    print("Close this window to stop.")
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        console.stop()
        server.shutdown()

    seen = console.snapshot()["seen"]
    unmapped = {k: v for k, v in seen.items() if v == "unknown"}
    if unmapped:
        print("\nUnmapped tab numbers seen this session: "
              + ", ".join(sorted(unmapped, key=int)))
        print("Add them to CHAN_PAGES in src/mixerm8/console.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
