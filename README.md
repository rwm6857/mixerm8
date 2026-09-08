# MixerM8

A free Sunday guide for small church production teams, in plain English,
Korean, or any other language you add.

A volunteer scans the QR code at their station and gets steps for their own
job, on their own phone, in their own language. No account, no app, no
subscription, nothing to install for the person reading it.

Each station opens on a short front page — what the job is, where to go, and
the questions people actually ask — and behind it two layers: a list to tick
off before the service, and problem-shaped pages for when something goes wrong
mid-service.

| Station | Covers | "Something is wrong" reads like |
| --- | --- | --- |
| **Sound** | the mixing desk | *Someone is too quiet* · *A squeal or a howl* |
| **Media** | the projector computer | *Everyone can see my desktop* |
| **Livestream** | the cameras and stream | *No sound on the stream* |
| **Misc** | serving here in general | — questions and policies only |

In the sound booth there is optionally a wall-mounted tablet and a small
bridge program that reads which screen the mixer is showing and turns to the
matching page. That part is an add-on: the guide works completely without it,
and nothing about a broken bridge can stop a volunteer reading their steps.

**The bridge never writes to the console.** It cannot: the only OSC encoder in
the codebase takes an address and no arguments, and on the X32 a message
without arguments is a read. See [Read-only by construction](#read-only-by-construction).

## The QR codes 

Everything after the `#` picks the station and the language. Make one sticker
per station per language and put it where that volunteer stands.

    .../mixerm8/#audio            sound desk, reader's usual language
    .../mixerm8/#audio/en         sound desk, English
    .../mixerm8/#audio/ko         sound desk, Korean
    .../mixerm8/#media/ko         projector computer, Korean
    .../mixerm8/#livestream/en    streaming computer, English
    .../mixerm8/                  no station — shows the picker

The language after the second slash is any code you have declared — `es`,
`pt`, `zh-Hans` — not a fixed list. See [Languages](#languages).

Two stickers side by side at the same station, one `/en` and one `/ko`, is the
point of the whole thing: nobody has to find a language setting while a
service is starting. Any free QR generator will do — the link is all that
matters, and it never changes.

In the booth, use the address the bridge prints instead of the public one, so
the tablet can follow the desk:

    http://192.168.1.20:8080/#audio/ko

## Where this has actually run

| | |
| --- | --- |
| Console | Behringer X32 Compact |
| Firmware tested | **not yet tested against a console** |
| Channel-tab numbers | **unverified** — record yours with [`mixerm8 --learn`](#mapping-the-tabs) |

Everything here is written from the community's reverse-engineering of the
X32's OSC protocol, which Behringer does not document. The read-only guarantee
is structural and does not depend on that being right, but the *screen
following* does. Until someone has run the bridge next to a real desk, treat
the follow feature as unproven. The guides and the service running order do
not touch the console at all and work regardless.

## The two halves

| Path            | What it is                                | How it ships                     |
| --------------- | ----------------------------------------- | -------------------------------- |
| `docs/`         | The tablet app — plain HTML, CSS, JS      | GitHub Pages, and inside the exe |
| `src/mixerm8/`  | The Windows bridge that watches the X32   | PyPI, and a frozen .exe          |

Same files, two delivery paths:

- **In the booth**, the bridge serves the app itself on the LAN. Everything is
  same-origin, and it works with the church internet completely down.
- **Everywhere else**, <https://rwm6857.github.io/mixerm8/> serves the same app
  in reference mode — guides and service flow, no live mixer. Good for training
  a volunteer on a Tuesday.

The app detects which mode it is in. Nothing is configured.

> GitHub Pages **cannot** be the live booth page. It is served over HTTPS, and an
> HTTPS page is not allowed to open `http://` or `ws://` connections to a LAN
> address — browsers block that as mixed content. That is why the bridge serves
> its own copy.

## Running it in the booth

Download `MixerM8-windows.zip` from the [latest release][releases], unzip it on
the media computer, and run:

```powershell
powershell -ExecutionPolicy Bypass -File install_startup.ps1
```

That installs the exe, starts it minimized at every login, and puts a
**Booth Guide** shortcut on the desktop. Then open the address it prints on
the tablet — something like `http://192.168.1.20:8080`.

Undo it all with `install_startup.ps1 -Uninstall`.

[releases]: https://github.com/rwm6857/mixerm8/releases/latest

### Finding the console

MixerM8 finds the desk by itself on first run and remembers it afterwards. If
you need to be explicit, the IP is on the console under **SETUP → Network**:

```powershell
MixerM8.exe 192.168.1.50
mixerm8 --discover        # list every console answering on the network
mixerm8 --learn           # record which number the desk gives each channel tab
```

## Development

Python 3.10+, no runtime dependencies.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest && ruff check .
mixerm8 --discover
```

To work on the guide without a mixer, serve `docs/` directly — it comes up in
reference mode, with everything except the live follow:

```bash
python -m http.server -d docs 8000
```

To exercise the bridge without a console, run the stand-in desk in one
terminal and the bridge in another:

```bash
python tests/fake_x32.py
```

```bash
mixerm8 127.0.0.1
```

The stand-in answers the queries a real desk would, walks through a few
screens so the tablet has something to follow, and — the reason it exists —
asserts that every packet arriving from the bridge has an empty typetag. It
prints `write attempts: 0` and exits non-zero if that ever stops being true.
The same code runs inside `pytest` as `tests/test_integration.py`.

## Read-only by construction

The X32 has one useful property: a message **with** arguments sets a value, and a
message **without** arguments asks for one. MixerM8 leans on that.

- `osc.encode_query(address)` is the only encoder. It takes no `*args`, so there
  is no expressible way to attach a value.
- Every address is matched against a full-string allowlist, so a typo cannot
  wander onto a fader.
- A test asserts the package contains exactly two `sendto()` calls and that both
  route through `encode_query`.

`/node` queries are deliberately unsupported. They are reads, but they take a
string argument, and that would cost the invariant more than it is worth.

## Mapping the tabs

The desk reports a number when it changes screen; the guide says which screen
that number is. The numbers for CONFIG / GATE / DYNAMICS / EQ / SENDS are **a
guess that needs checking on a real Compact** — so they live in the guide with
the wording, not in the code, and fixing one needs no new release.

Stand at the desk and run:

```bash
mixerm8 --learn
```

It names each tab in turn, waits for you to press it, and records the number
the desk reports. Nothing is written until it shows you the result and asks.
It only ever fills in numbers for tabs the guide already describes — if the
desk reports a number nothing accounts for, it says so and leaves the writing
to you, because what that tab *is* is not something it can know.

You can also do it by hand: press a tab with the tablet visible, and anything
unaccounted for shows as *"Tab 4 — not mapped yet"* along with its number.
Put that number on the right screen in `mixerm8 --edit` and the guide attaches
itself on the next reload — no restart, no reinstall.

## Your own wording

The words the volunteers read are not in the code. They are in plain text
files, one block per language, and there is no build step — save the file and
reload the page.

    docs/data/audio.json       the sound desk station
    docs/data/media.json       the projector station
    docs/data/livestream.json  the streaming station
    docs/data/misc.json        questions and policies, no equipment
    docs/data/roles.json       the languages, the stations, their colours and tabs
    docs/data/ui.json          the app's own words — tab names, badges, messages
    docs/data/guides.json      what each screen on the mixer does, and its number

Each station file holds that station's home page (`intro` and `faq`) and
whichever of `checklist`, `problems`, `flow` and `equipment` it declares in
`roles.json`. `misc` declares none of them: it is questions and policies only.
Media and Livestream declare `equipment` — one card per piece of gear, saying
what it is, where it lives and what to do about it. The sound desk does not:
its Mixer tab already does that job.

**Do not edit those directly.** They are the generic example that ships with
MixerM8. Your own version goes in a file with `.local` in the name, one per
file you want to change:

    docs/data/audio.local.json
    docs/data/livestream.local.json

Copy the example, rename it, and edit the copy. The page prefers your copy
whenever it exists and falls back to the example when it does not. Or let the
editor do the copying for you — see below.

Why the extra step: a finished guide names the person to call when something
goes wrong and lists which microphone is on which channel. That belongs to
your church, not on the internet. The `.local.json` files are listed in
`.gitignore`, so they are never committed and never appear on GitHub Pages —
whereas anything you type into `guides.json` would be published the moment
you push.

### Languages

Which languages the guide offers is content, not code. `roles.json` declares
them and everything else follows — the buttons in the tablet's header, the
codes the QR stickers can use, and what the checks insist on:

```json
"languages": [
  { "id": "en", "label": "EN" },
  { "id": "ko", "label": "한국어" },
  { "id": "es", "label": "Español" }
]
```

`id` is the code that goes in a sticker as `#audio/es` and is the key every
block in every file is written under. `label` is what the button says; leave
it out and the tablet fills in the usual name for the code, so `"languages":
["en", "es"]` works too.

**Adding one is a two-minute edit and then a translation job**, and the
editor is honest about the second part. The moment you add `es`, the bar
along the bottom lists every sentence in the guide that has no Spanish yet
and tells you how many there are. Until a sentence is translated the tablet
shows it in the first declared language rather than leaving a card blank —
a card somebody can act on beats an empty one — but nothing pretends the
gap is not there.

To do the translating, set **Writing in** to Spanish and **Alongside** to
the language you are translating from. Each field then shows one box to
type into and the source sentence beside it to read from. The tree marks
every entry still missing a language, so you can work down the list.

The app's own words are in `docs/data/ui.json` and work the same way, which
is the point: without it a station added in Spanish would read half in
Spanish and half in English, with the tab names, the badges and the
connection messages stuck in whatever the code was written in.

One language is fine too. Declare only `en` and the header segment
disappears, because a choice of one is not a choice.

### The editor

Editing JSON by hand is fine if you already do that for a living. If you do
not:

```bash
mixerm8 --edit
```

That opens a page in your browser with everything in the guide down the left,
a form in the middle, and the real tablet app on the right showing your
unsaved changes as you type. It runs on your own machine only — nothing on
the network can reach it — and it never touches the mixer, so you can use it
on a Mac at home with no console anywhere nearby.

It checks as you type, and the line along the bottom tells you what is
left: *"8 things still need writing — click to go to the first"*. Clicking
puts the cursor in the empty box, and clicking again moves to the next one,
so finishing a translation is a matter of working the same button until the
line says nothing is missing.

Behind **Details** are the rules verbatim — the same ones the test suite
runs, so a `____` with no explanation above it, a sentence missing one of
your languages, or a problem page titled after a component rather than a
symptom all show up before you save rather than after you push — and how
much of each language is written.

Everything in the guide is reachable from the tree on the left: the
stations, the front cover, the language list, the app's own wording, and the
mixer screens, which are filed under whichever station has the console.
**Adding and reordering happen in that tree** — a `+` on each section, and
rows you can drag into the order a volunteer should read them in. The form
in the middle edits one entry at a time and holds the only Delete. Most of
the buttons are icons rather than labels; hover any of them for the words.

There are two places it can save, and it says which at the top:

- **The example (repo)** writes `docs/data/*.json` in your checkout. Offered
  only when you are running from a source checkout. Committing it is yours
  to do in a terminal: the editor runs no `git` at all, so you see the
  branch you are on first.
- **This church** writes `%APPDATA%/MixerM8/data/*.local.json` on Windows, or
  `~/.config/MixerM8/data/` elsewhere. This is the one for whoever sets the
  booth machine up: it starts from the example, saves your version alongside
  it, and the tablet prefers it from then on.

Your own wording is deliberately not pushable. It is written outside the
repository entirely, so a `git pull` cannot overwrite it, a MixerM8 update
cannot replace it, and there is no button anywhere in the editor that could
publish it — the editor has no way to run a command at all. If you want a
change to ship to everyone, make it in the example.

### Diagrams

Any entry can carry a picture, and the wording beside it always says the same
thing so the page still reads if the picture is missing:

    "diagram": {
      "src": "img/signal-flow.svg",
      "alt":     { "en": "...", "ko": "..." },
      "caption": { "en": "...", "ko": "..." }
    }

Two generic ones ship in `docs/img/`. Your own — a real channel layout, your
camera chain — go in `docs/img/local/`, which is gitignored for the same
reason the wording is, and are referenced from a `.local.json` as
`img/local/whatever.svg`. Note that this one works in a source checkout only:
the bridge's override folder deliberately serves `.json` and nothing else.

If you want to see every element the guide is built from — cards, checklists,
collapsing steps, all four station colours — open `docs/kit.html`. It is not
linked from the app; it is there for whoever maintains the guide.

### On the booth computer

If you are running MixerM8 from the released `.exe` there is no repository to
edit. Put your files here instead and the bridge will serve them:

    %APPDATA%\MixerM8\data\audio.local.json
    %APPDATA%\MixerM8\data\livestream.local.json

No reinstall and no rebuild — restart MixerM8 and reload the tablet.

### Blanks

Anything MixerM8 does not know about your church is left as a blank rather
than filled in with a plausible guess. A blank looks like four underscores in
the file:

```json
"detail": { "en": "SCENES → select ____ → LOAD." }
```

and shows on the tablet as an underlined gap, next to a note saying what is
missing. That is deliberate: a volunteer who reads "select ____" asks someone,
where a volunteer who reads an invented scene name loads the wrong scene in
the middle of a service. Fill the blanks in as you learn the answers, and
delete the `todo` note next to each one when you do.

The footer of the page always says which copy you are looking at — your own
wording, or the example with the blanks still in it.

## Releasing

Bump `version` in `pyproject.toml` and `__version__` in
`src/mixerm8/__init__.py`, then push a tag:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

GitHub Actions builds the Windows exe and attaches it to the release. Running
copies of MixerM8 notice the new version on startup and print the link.

## License

MIT — see [LICENSE](LICENSE).

## Not affiliated with Behringer

MixerM8 is an independent project. It is not affiliated with, endorsed by, or
supported by Behringer, Midas, or Music Tribe. "X32" is their trademark, used
here only to say which console this talks to.

The OSC behaviour MixerM8 relies on is community-documented — Behringer
publishes no specification for it — so it may change between firmware
versions without notice.
