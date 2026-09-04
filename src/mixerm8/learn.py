"""Records which number the desk reports for each channel tab.

The mirror image of `editor.py`. The editor writes guide files and never
opens a socket to the console, because the writing happens on somebody's Mac
with no X32 in the building. This opens the watcher's socket and never serves
anything to the LAN, because the numbers can only come from a desk.

It reads the desk and nothing else. `Console` is the same watcher the bridge
runs, so every query it makes is argument-less and therefore a read; nothing
here adds an address or a transmission of its own.

Two rules shape the walk:

  * **The step list comes from the guide, not from here.** Whatever tabs the
    guide describes are the tabs the operator is asked to press, in the
    guide's own order. A number nobody has written a guide for is reported
    at the end rather than recorded, because inventing an entry titled
    "Tab 7" would be a guess about what tab 7 is, and an entry with an empty
    body fails the content checks anyway.
  * **Nothing is written until the operator says so.** The walk builds a map
    in memory and shows it before asking.
"""

from __future__ import annotations

import time

STEP_TIMEOUT = 12.0     # how long a step waits at the desk before it asks
SETTLE = 0.6            # a press can land in two updates; take the later one
SLICE = 1.0             # never block longer, so Ctrl-C lands promptly
CONNECT_TIMEOUT = 10.0

# The key a guide entry stores its number under. The two functions below are
# the only things here that know it.
NUMBER_KEY = "number"


def numbers(doc: dict) -> dict[str, int | None]:
    """The channel tabs the guide describes, and the number each claims."""
    out: dict[str, int | None] = {}
    for name, entry in (doc.get("pages") or {}).items():
        if isinstance(entry, dict):
            n = entry.get(NUMBER_KEY)
            out[name] = n if isinstance(n, int) and not isinstance(n, bool) else None
    return out


def set_number(doc: dict, name: str, n: int) -> dict:
    """A copy of `doc` with one tab's number recorded.

    Copied rather than edited in place because `editor.Guide.replace()`
    decides whether a file is dirty by comparing values -- an in-place edit
    would be silently dropped, which is the worst thing that could happen
    after somebody has walked the whole desk.

    Raises KeyError for a tab the guide does not describe. That is what keeps
    "never invent a guide entry" structural rather than a matter of
    remembering.
    """
    pages = doc.get("pages") or {}
    if name not in pages:
        raise KeyError(name)
    entry = dict(pages[name])
    if NUMBER_KEY in entry:
        entry[NUMBER_KEY] = n           # in place, so the key order holds
    else:
        entry = {NUMBER_KEY: n, **entry}
    return {**doc, "pages": {**pages, name: entry}}


def wait_for_connection(console, timeout: float | None = None) -> bool:
    deadline = time.time() + (CONNECT_TIMEOUT if timeout is None else timeout)
    while time.time() < deadline:
        if console.snapshot()["ok"]:
            return True
        console.wait_for_change(console.snapshot()["version"], SLICE)
    return console.snapshot()["ok"]


def await_press(console, baseline: int | None,
                timeout: float | None = None) -> int | None:
    """Block until the desk shows a channel tab other than `baseline`.

    Watching the snapshot version alone would not do: it also moves when the
    console goes quiet, when a channel is selected, and when a channel name
    arrives. So the version is the wake-up and the reading is the test.

    `on_channel` is load-bearing -- the channel tab number the desk reports
    is stale while it is showing Routing or Scenes, so a press is only
    believed while the channel strip is up.
    """
    deadline = time.time() + (STEP_TIMEOUT if timeout is None else timeout)
    while time.time() < deadline:
        snap = console.snapshot()
        page = snap["page"]
        if snap["ok"] and snap["on_channel"] and page is not None and page != baseline:
            time.sleep(SETTLE)
            settled = console.snapshot()
            if settled["on_channel"] and settled["page"] is not None:
                return settled["page"]
            return page
        console.wait_for_change(snap["version"], min(SLICE, max(deadline - time.time(), 0.05)))
    return None


def _show(title: str, mapping: dict[str, int | None], was: dict | None = None) -> None:
    print(f"\n  {title}")
    width = max((len(n) for n in mapping), default=0) + 2
    for name, n in mapping.items():
        line = f"    {name:<{width}}{'not recorded' if n is None else n}"
        if was is not None and was.get(name) != n:
            before = was.get(name)
            line += f"   (was: {'not recorded' if before is None else before})"
        print(line)


def _fallback(ask, name: str, baseline: int | None, showing: int | None) -> str:
    """One blocking prompt, reached only when a step heard nothing.

    The happy path deliberately keeps the operator at the desk with both
    hands free, so this is the only place the walk asks for the keyboard.
    """
    if showing is not None and showing == baseline:
        print(f"    The desk is still showing tab {showing}.")
        print(f"    Enter = record {showing} for {name}, "
              f"a number = record that instead,")
        print("    s = skip it, q = stop walking.")
    else:
        print(f"    Nothing moved on the desk for {STEP_TIMEOUT:.0f} seconds.")
        print("    Enter = wait some more, a number = record it by hand,")
        print(f"    s = leave {name} as it is, q = stop walking.")
    return (ask(f"  {name}? ") or "").strip().lower()


def walk(console, guide, ask=input) -> int:
    """Walk the channel tabs, then offer to write what the desk reported."""
    doc = guide.docs.get("guides") or {}
    before = numbers(doc)
    if not before:
        print("The guide describes no channel tabs, so there is nothing to learn.")
        print("Write them first with mixerm8 --edit.")
        return 1

    path = guide.path_for("guides")
    print(f"  Numbers will be written to:  {path}")
    _show("Tab numbers as they stand:", before)
    print("\n  Select any channel on the desk, then press each tab as it is named")
    print("  here. Nothing is written until the end, and nothing is ever sent")
    print("  to the desk. Press Ctrl-C to stop without writing.")

    print("\n  Waiting for the console...", end="", flush=True)
    if not wait_for_connection(console):
        print(" no answer.")
        print(f"\nNothing answered at {console.ip} within "
              f"{CONNECT_TIMEOUT:.0f} seconds.")
        print("Check the network cable and that the desk is switched on.")
        return 1
    print("  connected.\n")

    recorded: dict[str, int] = {}
    width = max(len(f"  Press {n}.") for n in before) + 2
    for name in before:
        baseline = console.snapshot()["page"]
        print(f"  Press {name}.".ljust(width), end="", flush=True)
        n = await_press(console, baseline)

        if n is None:
            print()
            answer = _fallback(ask, name, baseline, console.snapshot()["page"])
            if answer == "q":
                break
            if answer == "s":
                continue
            if answer.isdigit():
                n = int(answer)
            elif answer == "" and console.snapshot()["page"] == baseline:
                n = baseline
            else:
                n = await_press(console, baseline)
                if n is None:
                    print(f"    Still nothing. Leaving {name} as it is.")
                    continue
            if n is None:
                continue

        taken = next((k for k, v in recorded.items() if v == n), None)
        if taken:
            print(f" -> tab {n}")
            print(f"    Tab {n} is already recorded for {taken} in this session.")
            if (ask(f"  Move it to {name} instead? [y/N] ") or "").strip().lower() != "y":
                print(f"    Ignored. Press {name} again, or run this once more.")
                continue
            del recorded[taken]
        else:
            print(f" -> tab {n}")
        recorded[name] = n

    if not recorded:
        print("\nNothing was recorded, so nothing was written.")
        return 1

    after = {**before, **recorded}
    _show("What the desk reported:", after, was=before)

    # A number the desk reported that no guide claims. Learn will not invent
    # the entry -- what tab 7 *is* is not something it can know -- so it says
    # so and leaves the writing to somebody who does.
    unclaimed = sorted(set(console.snapshot()["seen"]) - set(after.values()))
    if unclaimed:
        print(f"\n  The desk also reported tab "
              f"{', '.join(str(n) for n in unclaimed)}, which no guide names.")
        print("  Write a guide for it with mixerm8 --edit, then run this again.")

    if after == before:
        print("\nNothing changed, so nothing was written.")
        return 0

    if (ask(f"\nWrite these to {path.name}? [y/N] ") or "").strip().lower() != "y":
        print("Nothing was written.")
        return 0

    for name, n in recorded.items():
        doc = set_number(doc, name, n)
    guide.replace("guides", doc)
    try:
        guide.save()
    except OSError as exc:
        print(f"\nCould not write {path}: {exc}")
        return 1
    print(f"\n  Wrote {path}")
    return 0
