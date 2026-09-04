# MixerM8

A read-only bridge from a Behringer X32 Compact to a booth tablet, plus the
tablet app itself. Volunteers at the desk get a guide that follows whatever
screen the mixer is showing.

## The one rule

**Nothing in this repo may ever write to the console.** A volunteer's Sunday
depends on it. The guarantee is structural, not a convention:

- `osc.encode_query(address)` is the *only* encoder, and it accepts no
  arguments. On the X32, an argument-less message is a read.
- `ALLOWED_PATTERNS` in `osc.py` matches full addresses, not prefixes.
- `tests/test_osc.py::test_only_one_socket_send_exists_in_the_package` pins the
  number of `sendto()` calls at two and asserts both go through `encode_query`.

If a task seems to need an argument sent to the desk, stop and raise it rather
than widening the encoder. `/node` is unsupported for exactly this reason.

## Architecture

| Path            | What it is                              | Ships via                      |
| --------------- | --------------------------------------- | ------------------------------ |
| `docs/`         | The tablet app (vanilla HTML/CSS/JS)    | GitHub Pages + bundled in wheel |
| `src/mixerm8/`  | The bridge (stdlib only)                | PyPI + PyInstaller exe         |
| `editor/`       | The guide editor (vanilla HTML/CSS/JS)  | Bundled in wheel + exe, never Pages |
| `content/`      | Source material, shipped nowhere        | —                              |
| `packaging/`    | PyInstaller spec, Windows install script | —                             |

`docs/` has **two** delivery paths from one copy of the files. Pages serves it
directly; hatchling `force-include` copies it into the wheel as
`mixerm8/webroot`, and the PyInstaller spec bundles it as `webroot`.
`server.webroot()` resolves all three cases. Do not duplicate these files.

`editor/` ships the same way minus Pages, and `editor.editorroot()` resolves
it. It is **not** under `docs/` on purpose: Pages is a static host, so an
editor served from there would be a Save button with nothing behind it.

**GitHub Pages cannot host the live booth page.** It is HTTPS, and an HTTPS page
may not open `http://`/`ws://` connections to a LAN address — mixed content.
This is why the bridge serves its own copy, and why the app auto-detects
"bridge" vs "reference" mode instead of being configured. Any proposal to have
the Pages copy talk to the bridge runs into this; don't re-litigate it.

## Four stations, and pages inside them

The guide is the product; the console bridge is an add-on. Keep it that way —
three of the four stations have no console at all.

| Station | Data file | Palette | Pages as shipped |
| --- | --- | --- | --- |
| `audio` | `docs/data/audio.json` | green | Home · Before · Problems · Order · Mixer |
| `media` | `docs/data/media.json` | amber | Home · Before · Problems · Order · Equipment |
| `livestream` | `docs/data/livestream.json` | violet | Home · Before · Problems · Order · Equipment |
| `misc` | `docs/data/misc.json` | slate | Home |

**A station's tabs are its `pages`, in the order they are written.** Each
page carries its own `id`, `kind`, bilingual `label`, optional `blurb` (the
line on the front page) and `lede` (the line under the tab), an optional
`next` naming the page its Next button goes to, and an optional `hidden`.
Nothing about the tab bar is hardcoded any more, so a station can be given a
fifth page, have two checklists, or call "Order" something else, without
touching `app.js`.

The `kind` decides which renderer draws it: `checklist`, `problems`, `flow`,
`equipment`, `cards`, or `mixer`. `cards` is the general one — a titled card
with severity, body, an optional action and an optional picture — and every
other kind is that with a particular job. `mixer` holds no items; its content
is `guides.json`.

**An empty page hides its own tab rather than being an error.** This replaced
the old rule that a declared layer had to be complete, which was right about
the tablet and wrong about the editor: the only way to build a page is to
make an empty one first, and the old rule made that a validation failure with
no way to fix it from the UI. The guarantee a volunteer cares about — never a
tab onto nothing — now lives in `validate.visible_pages()`, so a half-built
page is invisible instead of invalid.
`test_an_empty_page_hides_itself_instead_of_breaking_the_guide` pins it.

**Home is not one of the pages, on purpose.** It is `intro` + `faq` at the top
of the station file, it is always first, and it cannot be reordered away,
hidden or deleted — it is what a QR sticker lands on.

**Audio ships no `equipment` page**: the Mixer page already is the sound
desk's equipment page, and the boxes behind the desk are not a volunteer's
to touch. The two stations with no console needed somewhere to say what the
gear in front of them is — one card per box, with `where` a required field.
A blank there is a fine answer (nobody wrote it down) but silence is not, so
it is never simply absent. Problem titles are *symptoms* ("Someone is too
quiet"), never component names ("Gate") — a page called "Gate" only helps
someone who already knows the word, and that person is not who the kind is
for. `test_the_problem_pages_are_problem_shaped` guards it.

Routing is the hash, because a QR sticker is the whole user interface:
`#<role>` and `#<role>/<lang>`, with `en`, `ko` and `both`. A bare URL is the
station picker, which is also the tablet's home screen. Changing station
resets to that station's home; changing only the language does not, so
switching EN/KO does not lose someone's place. The hash stays two segments —
a QR sticker addresses a station and a language, not a tab.

**The station home is the landing view, and the Mixer tab never is.** A
station has to work with the bridge dead, so the first thing a volunteer sees
must not depend on a UDP reply — the home page is entirely static for exactly
that reason. The Mixer tab is present for `audio` whether or not a bridge
answered — the screen guides are worth reading on a Tuesday — but only the
follow row inside it depends on the bridge. `Before` is the first card in the
home nav, so the Sunday-morning path is one tap.

### Colour and collapsing

A station's palette is set as `data-theme` on `<html>` (and on each card in
the picker, so all four are visible at once). It drives **chrome only** —
tab underline, timeline dots, icon wells, the language segment. The severity
colours (`--ok`, `--caution`, `--danger`) never change between stations: a
"do not change this" card has to look identical everywhere or the colour
stops meaning anything. `docs/kit.html` is an unlinked page showing every
element at every palette; it is for whoever maintains the guide, not for a
Sunday morning.

The running order and the questions are native `<details>` cards, so
collapsing needs no script. Two rules: **a card carrying an unfilled blank
opens by default** (hiding a `____` behind a closed summary would make the gap
silent, which is the one thing the blanks convention exists to prevent), and
**problem steps are never collapsed** — somebody is reading those while a
microphone squeals.

## Content is two-layered, for privacy

The committed `docs/data/*.json` are a **generic example**.
A church's real wording goes in a sibling `*.local.json`, which the app
prefers and `.gitignore` excludes. Three resolution points, one convention:

- `app.js:loadData()` tries `data/<name>.local.json`, then `data/<name>.json`.
  On Pages the first simply 404s.
- `server.override_dir()` maps `/data/*.local.json` to
  `%APPDATA%/MixerM8/data/`, so a media director can reword the guide without
  git, a rebuild, or a reinstall. Restricted to a single `*.json` filename on
  purpose — it must not become a second file server.
- A gitignored `docs/data/*.local.json` also works in a source checkout.

This exists because a filled-in guide names a staff member and lists the
channel layout. Do not add site-specific text to the committed example files;
that publishes it.

**Diagrams follow the same split.** The committed `docs/img/*.svg` are
generic — the shape of any X32-family desk, the path sound takes from a
microphone to a speaker. A church's own drawings go in `docs/img/local/`,
which is gitignored, and a `*.local.json` points at `img/local/...`. The
bridge's override dir stays JSON-only: widening it to serve images would turn
a deliberately narrow single-filename lookup into a file server, and the
value does not pay for that. Every diagram is optional decoration around
wording that stands alone, and `wireDiagrams()` hides a figure whose image did
not load rather than leaving a broken-image icon on a tablet in a dark booth.
`test_every_diagram_points_at_a_file_that_ships` catches a committed one that
does not resolve.

**The rules live in `src/mixerm8/validate.py`, not in the tests.**
`tests/test_content.py` calls them and so does the editor, which is the
point: a media director rewording a checklist in a browser has no `pytest`
to run, so a draft that would fail CI is reported in the editor before it
is ever written. Adding a content rule means adding it there; the test that
names it stays, as the argument for why it exists.

**Emphasis is `**bold**`, `*italic*` and `++underline++`,** parsed in
`fill()` after escaping, so those three tags are the only ones that can
reach the page. Underscores are deliberately not used for it: four or more
of them already mean an unfilled blank, and one character cannot carry both
conventions without the guide occasionally underlining a gap instead of
showing it.

**Unfilled values are blanks, never guesses.** A run of four or more
underscores renders as a visible gap (`fill()` in `app.js`), and the entry
carries a bilingual `todo` saying what is missing.
`test_a_blank_is_never_silent` pins the pairing: a blank without a `todo`
fails the suite. The reason is concrete — the flow used to instruct volunteers
to load "the Sunday scene", which nobody had confirmed exists, and loading the
wrong scene resets every fader mid-service.

## Editing the guide

`mixerm8 --edit` opens a three-column editor: everything in the guide, a
form for the entry, and the real tablet app beside it showing the unsaved
draft. The preview is `docs/` served from the same files the bridge serves,
answering `/data/*.json` from memory — so it is the guide, not a mock-up of
it, and `app.js` needed no editor-shaped hooks to make that work.

**It is a separate command from the bridge, and that is the design.** The
bridge listens on the LAN so tablets can reach it; a write endpoint there
would put "rewrite the guide" one URL away from every volunteer holding a
tablet mid-service. The editor binds 127.0.0.1, checks the `Host` header,
and never opens a socket to the console at all — so it runs on a Mac with
no X32 in the building, which is where the writing actually happens.

**Pages are managed from the tree.** Add one, name it, choose its kind,
drag it earlier or later, hide it, point a Next button at it, delete it.
A new page is valid the moment it exists — it seeds no `blurb` or `lede`,
because seeding them empty would make a page that is invalid as soon as it
is born — and the page-settings form carries "+ Add the first one" so an
empty page is never a dead end.

**Pictures upload to `img/local/`,** which is one path in the JSON and two
places on disk: `docs/img/local/` in a checkout, `%APPDATA%/MixerM8/img/`
on the booth machine. Both are outside git. This widened the bridge's
override from JSON-only, which had been judged not to pay for itself — a
photo of the actual booth changed that — but only into the same shape of
lookup: one prefix, one filename, no slashes, no `..`, and an extension on
`server.IMAGE_TYPES`. It is still not a file server.

**Two places to save, and the difference is the whole point:**

| Target | Writes | Who |
| --- | --- | --- |
| `repo` | `docs/data/<name>.json` | you, in a checkout; git's business |
| `local` | `%APPDATA%/MixerM8/data/<name>.local.json` | the church, on the booth machine |

`repo` is only offered in a source checkout, because a wheel and a frozen
exe are both replaced wholesale by an update and wording written into one
would be lost. **Local wording is not pushable, and the editor has no button
that could make it so.** It is outside the repo in fact, not only by
`.gitignore`, so no pull and no MixerM8 update overwrites it and no push
publishes it. For `repo` the editor prints the git commands and stops;
running them is yours, so you see the branch first.
`test_the_editor_offers_no_way_to_commit_or_push` pins that every `git`
call in `editor.py` names a read.

**`editor.dumps()` is how a guide file is written, and the committed files
are already in that form.** Short `{ "en": …, "ko": … }` blocks stay inline,
long ones open up, measured in display columns because a Korean glyph is two
of them. This is not tidiness: without it the first press of Save reformats
all six files and buries the sentence somebody changed.
`test_the_editor_writes_the_files_exactly_as_they_are` pins it — so a file
hand-edited into a shape the editor would churn fails the suite rather than
surprising the next person who saves.

## Constraints

- **No runtime dependencies.** `dependencies = []` is deliberate: it keeps
  `pip install` trivial and the frozen exe small. Transport is Server-Sent
  Events precisely because it needs no library. Adding a dependency needs a
  reason worth stating in the commit message.
- **No build step for the app.** `docs/` is hand-written, loads its content from
  `docs/data/*.json`, and uses relative URLs so it works at both `/` (bridge)
  and `/mixerm8/` (Pages). No bundler, no npm, no framework.
- **The tablet is the target.** 19px base, dark-only (a white screen blinds the
  operator in a dim booth), 52px minimum tap targets, English and Korean.

## Commands

```bash
pip install -e ".[dev]"    # stdlib only at runtime; this adds pytest + ruff
pytest                     # 85 tests, ~8s
ruff check .               # line length 100
mixerm8 --discover         # find consoles on the network
mixerm8 --edit             # the guide editor, localhost only, no console needed
python -m http.server -d docs 8000   # the app in reference mode, no mixer
```

Testing without a desk: `tests/fake_x32.py` is that UDP responder. It answers
the three `/-stat` queries, walks a script of screens (including tab 9, which
is deliberately unmapped so the "not mapped yet" path gets exercised), and
asserts every inbound packet has an empty typetag. Run it standalone against
a real bridge and browser, or let `tests/test_integration.py` drive it
in-process — that is where the read-only guarantee is verified end to end,
from where the desk stands rather than from our own code.

## Gotchas

- `CHAN_PAGES` in `console.py` is **unverified against real hardware.** Unmapped
  numbers surface in the UI as "not mapped yet" on purpose; that is the
  discovery mechanism, not a bug to hide.
- The X32 drops `/xremote` subscribers after ~10s, hence `RESUBSCRIBE_EVERY = 8`.
- Version lives in `pyproject.toml` and `src/mixerm8/__init__.py`. Bump both.
- The exe can only be built on Windows, so `.github/workflows/release.yml` is
  load-bearing rather than a nicety — a tag push is the only way to ship a build.
- `Console.snapshot()` is compared by value to decide whether to push an SSE
  frame, so adding a field that changes every tick would flood every tablet.
  `last_seen` is popped for exactly this reason.
- **Open questions that gate content**, all of them currently blanks in the
  example files rather than invented values: whether this desk uses scenes and
  which is safe to load (gates the EQ and Scenes wording), the channel/label
  layout, which software runs the livestream PC, the power-on order for the
  camera chain, and who to escalate to. Ask; do not fill these in.
