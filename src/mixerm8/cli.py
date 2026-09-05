"""Command-line entry point for the MixerM8 bridge."""

from __future__ import annotations

import argparse
import sys
import time
import webbrowser

from . import __version__, config, editor, update
from . import learn as learn_mod
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
    p.add_argument("--learn", action="store_true",
                   help="walk the desk's channel tabs and record their numbers")
    p.add_argument("--edit", action="store_true",
                   help="open the guide editor in a browser on this machine")
    p.add_argument("--edit-port", type=int, default=editor.DEFAULT_PORT,
                   help=f"port for the editor (default {editor.DEFAULT_PORT})")
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


def learn(args) -> int:
    """Record the tab numbers from a real desk. The mirror image of edit().

    The editor never opens a socket to the console; this one has to, because
    the numbers can only come from a desk. What it never does is serve
    anything -- there is no port here and nothing on the LAN can reach it.
    Read-only holds throughout: it runs the same watcher the bridge runs.
    """
    # A frozen build started without a console has no stdin at all, which is
    # `None` rather than a closed file -- hence the truthiness check first.
    if not (sys.stdin and sys.stdin.isatty()):
        print("--learn needs a keyboard and a screen. Run it from a terminal.")
        return 1

    ip = resolve_ip(args.ip)
    if not ip:
        print("Could not find a console, and none was given.")
        print("Find the IP on the desk: SETUP -> Network, then run:")
        print("    mixerm8 --learn 192.168.1.50")
        return 1

    guide = editor.Guide()
    console = Console(ip)
    console.start()
    config.save(ip=ip)
    print()
    print(f"  Learning the channel tabs on the desk at {ip}  (read-only)")
    if guide.target == editor.LOCAL:
        print("  This is not a source checkout, so the numbers go in this")
        print("  church's own copy of the guide, which is never published.")
    try:
        code = learn_mod.walk(console, guide)
    except (KeyboardInterrupt, EOFError):
        # Ctrl-C, or a stdin that went away mid-walk. Either way there is no
        # keyboard left to confirm with, and nothing is written without one.
        print("\nStopping. Nothing was written.")
        code = 1
    finally:
        console.stop()

    if code == 0 and guide.target == editor.REPO:
        git = editor.git_status(guide)
        if git.get("available") and git.get("commands"):
            print()
            for line in git["commands"]:
                print(f"      {line}")
    return code


def edit(args) -> int:
    """Run the guide editor and nothing else.

    Deliberately not part of a normal run. The bridge listens on the LAN so
    tablets can reach it; the editor writes files, so it stays on loopback
    and never shares a process with a server volunteers can reach. It also
    never opens a socket to the desk, which is why this returns before any
    Console is built -- the writing happens on somebody's laptop, usually
    nowhere near the building.
    """
    try:
        server = editor.serve(args.edit_port)
    except OSError as exc:
        print(f"Could not start the editor on port {args.edit_port}: {exc}")
        return 1

    url = f"http://127.0.0.1:{args.edit_port}/"
    guide = editor.EditorHandler.guide
    print()
    print(f"  Editing the guide:  {url}")
    print(f"  Saves go to:        {guide.path_for('media').parent}")
    if editor.repo_data_dir() is None:
        print("  (This is not a source checkout, so only this church's own")
        print("   wording can be edited. It is never committed or published.)")
    print()
    print("  This does not touch the console, and only this machine can reach it.")
    print("  Close this window to stop.")
    webbrowser.open(url)
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.shutdown()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.edit:
        return edit(args)

    # Ordered by reach: --edit touches no network, --learn opens a socket to
    # the desk but serves nothing, --discover broadcasts, the bridge serves
    # the LAN.
    if args.learn:
        return learn(args)

    if args.discover:
        found = discover()
        if not found:
            print("No consoles answered. Check the network cable and that the "
                  "desk is switched on.")
            return 1
        for c in found:
            print(f"  {c['ip']:<16} {c['model']} {c['name']} {c['firmware']}")
        return 0

    # No blocking discovery here, and no exit when nothing answers. The
    # media PC boots before the sound desk on most Sundays, and the bridge
    # serves the guide as well as the console state -- quitting because the
    # desk is off would take the checklist down with it, for all four
    # stations, none of which have a console at all. The watcher hunts in
    # the background instead and the tablet says which of the two it is.
    ip = args.ip or config.load().get("ip")
    if ip and not args.ip:
        print(f"Using remembered console address {ip}")

    console = Console(ip)
    console.start()
    if ip:
        config.save(ip=ip)

    try:
        server = serve(console, args.port)
    except OSError as exc:
        print(f"Could not start the web server on port {args.port}: {exc}")
        print("Another copy of MixerM8 may already be running.")
        return 1

    url = f"http://{local_ip()}:{args.port}"
    print()
    if ip:
        print(f"  Watching the console at {ip}  (read-only)")
    else:
        print("  Looking for a console on the network  (read-only)")
        print("  If it never finds one, read the IP off the desk")
        print("  (SETUP -> Network) and run:  mixerm8 192.168.1.50")
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
            # The watcher is what finds a desk, whether at startup or when
            # somebody presses Connect on the tablet. Remember the address
            # it settled on so the next boot starts pointed at it.
            if console.ip and console.ip != ip:
                ip = console.ip
                config.save(ip=ip)
                print(f"  Found the console at {ip}")
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        console.stop()
        server.shutdown()

    # The bridge no longer knows which of these have guides -- the tablet
    # decides that -- so report them all and let the reader compare.
    seen = console.snapshot()["seen"]
    if seen:
        print("\nTab numbers this desk reported this session: "
              + ", ".join(str(n) for n in seen))
        print('Anything without a guide showed as "not mapped yet" on the tablet.')
        print("Record them all with mixerm8 --learn.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
