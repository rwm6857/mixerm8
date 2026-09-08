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

## Four stations, and where the console sits

The guide is the product; the console bridge is an add-on. Keep it that way —
three of the four stations have no console at all.

| Station | Data file | Palette | Tabs |
| --- | --- | --- | --- |
| `audio` | `docs/data/audio.json` | green | Home · Before · Problems · Order · Training · Mixer |
| `media` | `docs/data/media.json` | amber | Home · Before · Problems · Order · Equipment |
| `livestream` | `docs/data/livestream.json` | violet | Home · Before · Problems · Order · Equipment |
| `misc` | `docs/data/misc.json` | slate | Home |

**A station's tabs come from `layers` in `roles.json`, never from an
assumption.** `misc` is questions and policies with no equipment behind it, so
it declares no layers and gets no tab bar — one tab is not a choice.
`test_a_role_declares_exactly_the_layers_its_file_carries` pins it in both
directions: a declared layer must be complete, and an undeclared one must be
absent, because a tab offering an empty checklist is worse than no tab.

Every station has a **home page** (`intro` + `faq`) and the five optional
layers are `checklist`, `problems`, `flow`, `equipment` and `pages` — the
last being the free-form one, described under Blocks below.
**Audio declares no `equipment` layer**: the Mixer tab already is the sound
desk's equipment page, and the boxes behind the desk are not a volunteer's
to touch. The two stations with no console needed somewhere to say what the
gear in front of them is, which is what the layer is for — one card per box,
with `where` a required field. A blank there is a fine answer (nobody wrote
it down) but silence is not, so it is never simply absent. Two layers by design: the
checklist is for the volunteer who has done this before, the problem pages are
for the one who has not. Problem titles are *symptoms* ("Someone is too
quiet"), never component names ("Gate") — a page called "Gate" only helps
someone who already knows the word, and that person is not who the layer is
for. `test_the_problem_pages_are_problem_shaped` guards it.

Routing is the hash, because a QR sticker is the whole user interface:
`#<role>` and `#<role>/<lang>`, where `<lang>` is any code declared in
`roles.json`. A bare URL is the station picker, which is also the tablet's
home screen. Changing station resets to that station's home; changing only
the language does not, so switching language does not lose someone's place.
The hash stays two segments — a QR sticker addresses a station and a
language, not a tab.

## Languages are declared, not built in

**`languages` in `roles.json` is the only place that says which languages
exist**, and `validate.languages()` is the only thing that reads it. Every
rule asks it rather than assuming: `incomplete_layers`, `missing_home_page`,
`guides_missing_language`, `todos_missing_a_language` and
`broken_diagrams` all iterate the declared list. So a church adding Spanish
edits content, not code, and `mixerm8 --edit` is where that happens.

An entry is `{ "id": "es", "label": "Español" }` or the bare string `"es"`.
The label is the segment button's text; `LANGUAGE_NAMES` in `app.js` supplies
the endonym when it is absent, and that table is chrome exactly like `ICONS`.
`editor.js` deliberately carries no copy of it — it shows the code instead —
because two tables of language names would drift.

**There is no `both` any more.** Two languages stacked in every card pushed
the thing somebody needed off the bottom of a tablet, and the segment in the
header was always one tap away. `two()` and every `.ko` rule in `styles.css`
went with it. What replaced it is a fallback chain: `langs()` returns the
language on screen followed by the rest in declared order, so a sentence
nobody has translated shows in the first declared language rather than
leaving a blank card. That is a safety net, not a feature — a declared
language missing anywhere fails the suite.

**The app's own words are content too, in `docs/data/ui.json`.** Tab names,
the severity badges, the status pill, the footer and the connection messages
used to be a `UI` dict in `app.js`, which meant a station added in a third
language read half in that language and half in English with nothing to say
so. They are a seventh document now, so they go through the same
`*.local.json` fallback, the same override dir and the same editor as
everything else. `FAILED_UI` is the one exception left in `app.js`: four
English sentences saying the guide did not load, which is the single moment
`ui.json` cannot be relied on to be there.
`test_the_app_and_its_wording_file_name_the_same_strings` pins the two
lists together in both directions — a `t1("tabHme")` renders an empty tab
label and says nothing anywhere, and a string nothing displays is one
somebody is asked to translate for nothing. It is how `stateStarting` was
found and removed: the pill's first word comes from `index.html`, before any
fetch has returned, so no language can be known for it.

Declaring a language and translating it are different jobs, and the second
is weeks. So adding `es` immediately reports every gap it opens — 350-odd
lines on the shipped example, which is why the editor's bar along the
bottom counts rather than lists them.

**That bar is one line that names the next thing to do and goes there.** It
used to print the rule messages as a bulleted list with a per-language
progress block under it. Both were true and neither was addressed to the
person reading them: `audio.json.problems[3].todo missing es` is a dotted
path, and somebody finishing a translation wants the empty box, not its
name. So the line reads *"8 things still need writing — click to go to the
first"*, each click lands the cursor **in** the box — switching the
language being written, because a form shows one at a time, and taking the
preview with it — and the messages are verbatim behind Details along with
the progress figures.

`findGaps()` walks the draft rather than parsing the rule messages back
into locations — the messages are prose meant to be read, and a second
parser for a human format is a standing invitation to drift.
`test_the_bar_names_the_next_thing_to_do` pins both halves. It is also why
`entryAt()` exists: the tree and the form each narrowed a document to a
section separately, which nothing noticed until the bar walked the tree's
own list and counted `roles.json` twice, filing half of it under Front
cover. One function narrows now, and
`test_one_place_decides_what_a_form_edits` counts the references.

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

## Every entry has an address

**`id` on every entry, because position is not an address.** Each entry in
`faq`, `checklist`, `problems`, `flow` and `equipment` carries one, slugged
from its own wording in the first declared language when it was created and
**never regenerated** — renaming a heading must not break a link to it.
`guides` needs no such field: its pages and screens are a map, so the key
already is the id.

The cost of not having them was concrete and live. Checklist ticks were
stored as `done: [0, 2, 5]`, so reordering the list — one drag in the
editor, which is a feature the editor now has — silently moved a
volunteer's ticks onto different steps. They are keyed by id now, and a
number left in an older install's `localStorage` matches nothing and reads
as unticked, which is the right answer anyway. Three rules guard the data
side: every entry has an id, no two in a section claim one, and an id is
the shape a link could carry.

## Wording, and the three things it may contain

`fill()` in `app.js` **escapes first, always**, and everything after that
runs on the escaped string — so no amount of markup in a guide file can put
a tag on the page that is not one of the handful written there. In order:
blanks, then links lifted out to placeholders, then emphasis, then the
links put back. The lifting is why an asterisk inside a URL cannot turn
half of it italic.

- `____` — a blank nobody has filled in. See the blanks section below.
- `**bold**` and `*italic*`. **Asterisks rather than underscores**, because
  four underscores already mean something here and the two conventions
  would collide in the one place it matters least to be ambiguous.
- `[label](target)`.

**No sizes, no colours, no fonts, and that is the whole list.** A card's
meaning comes from its severity, and wording that could restyle itself is
wording that could quietly stop looking like a warning.

**A link either leaves the guide or lands inside it.** An internal target
is `station`, `station/tab` or `station/tab/entry`, and it renders as an
anchor with `data-to` and *no href*: the hash addresses a station and a
language and nothing deeper, because that is what a QR sticker says, so a
"see also" inside the guide is navigation rather than an address. Crossing
to another station still goes through the hash — that is what makes
`route()` load the other file — but only ever as `#station/language`, with
which entry to open travelling in `state.jump`. External links are
`http`, `https` or `mailto` only and carry a `↗`, because a volunteer
mid-service who taps one loses the page they were on.

`dead_links()` resolves every internal target against the guide it sits
in. A "see also" pointing at a renamed entry reads as an answer and goes
nowhere, which is worse than not offering one. The committed example uses
all three marks on purpose — `test_the_shipped_guide_actually_uses_links_and_emphasis`
fails if it stops, because a check guarding a feature nothing uses is a
check that has stopped being tested.

## Blocks

An entry's fixed fields say what that entry **always** has to say — a problem
page has a symptom, a piece of equipment has a `where`. `blocks` is
everything after that, in whatever order somebody put it: a paragraph, a
video, a checklist of what was in the video, collapsible steps with a diagram
inside one of them.

**Additive on purpose.** The fixed fields are untouched and a file with no
`blocks` is a file that has not changed, so nothing is ever half-migrated and
the guide keeps working while the platform grows around it. Blocks render
after the fixed body on the home page, on a question, on a problem page, on a
running-order step and on a piece of equipment — and they are the *whole* body
of a `pages` entry.

**Three files list the types, because each does a different job with the
list**: `BLOCKS` in `validate.py` (what a block must carry), `BLOCKS` in
`app.js` (how it renders) and `BLOCK_TYPES` in `editor.js` (how it is
edited). Two agreeing and one not is a block that saves, validates, and
renders as a gap on the tablet, so
`test_the_editor_and_the_app_agree_on_the_block_types` parses all three and
compares them.

The types are `text`, `media`, `callout`, `checklist` and `steps`. Each keeps
the look it already had elsewhere — a callout is a severity card, steps are
the running order's cards, a checklist ticks like the Before tab — so a page
assembled out of them looks like the guide rather than like a document.

**A `steps` item's own content is blocks too**, which is how a diagram goes
inside the step it explains rather than above the whole list. **One level and
no more**: `steps_nested_too_deep` refuses steps inside steps, because a
volunteer opening a card to find another card mid-service is the opposite of
what the layer is for. The editor does not offer the type at that depth
either, but the rule is what makes it true — a hidden button is not a
guarantee.

**Checklist item ids are unique across the whole station file, not per
block.** That is not tidiness: the ticks are one flat set per station keyed
by id, so two items sharing one anywhere in the file would tick together.

`pages` is the fifth layer and the free-form one — walkthroughs and
background reading, the material that does not answer a Sunday-morning
question. A page insists on nothing but a heading, so
`pages_with_nothing_on_them` is what keeps that freedom from being a way to
publish a blank. In `editor.js` its section is called `training` rather than
`pages`, because the console's channel tabs had already taken that word in
`SECTIONS`; `at` names the real key, and `keyOf()` is the one place that
maps a section to it.

## A church's own pictures and video

`media_dir()` in `server.py` serves `%APPDATA%/MixerM8/media/` — one flat
directory, GET only, and a fixed list of types.

**This is a deliberate narrowing of the rule next door, not a hole in it.**
`override_dir()` is restricted to a single `*.json` filename with a comment
arguing that widening it to images would turn a narrow lookup into a file
server "and the value does not pay for that". Then guides grew media blocks,
and a booth PC running the frozen exe had no way to show a photo of its own
booth — which is the most obviously useful diagram there is. So the value
changed and the rule moved with it, to the narrowest thing that does the job:
no subdirectories, nothing executable, nothing written, and the type list in
`MEDIA_TYPES` rather than `mimetypes`, which varies by machine and would
happily hand out an `.html` off a folder a volunteer can drop files into.
`tests/test_server.py` probes it from the outside, including that a POST to
it is refused — `/reconnect` is still the only thing on the LAN server that
changes anything.

Three kinds of `src`, and only one is checkable here: something shipping in
`docs/`, which must exist; something under `media/`, which lives on the booth
machine and is not in the repo to look at; and an https address, which is
somebody else's server. What is always checkable is the suffix, because the
app decides between `<img>` and `<video>` from it. A video is never
autoplayed and never loops — somebody is holding a tablet in a booth with the
service about to start.

The editor's end is `/api/media`: a listing filtered through the same
allowlist, and an upload, which is the one place that server takes something
that is not JSON. It is loopback-only like the rest of it, and the name and
type are checked in `save_media` rather than trusted from the browser.

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

**Everything in the guide means everything**: the stations, the front cover,
the language list and the app's own wording were all unreachable at one
point or another, which is invisible until somebody needs to change the
front cover. `test_every_top_level_key_is_reachable_from_the_editor` greps
the section and field names out of `editor.js` and fails when a new
top-level key arrives with no form behind it. `NOT_IN_THE_EDITOR` in that
test is the list of deliberate exceptions and the reason for each — the
`note` blocks are there, because the editor exists so nobody has to read
the JSON the notes are addressed to.

**Icons where a word is not earning its place.** `ICONS` in `editor.js` is
chrome in the code, the same way it is in `app.js`, and `iconBtn()` is the
only thing that emits the class — because it is also the only thing that
sets a `title` and an `aria-label`, and a trashcan is only obvious to
somebody who can see it. `test_no_icon_button_ships_without_words_behind_it`
pins that. A word still earns its place on a button that appears once and
says something specific: `Save`, and the segments naming the two save
targets and the languages. It does not earn it on the nineteen add buttons
in the tree, or on a Remove sitting under a field whose own label already
says what it is.

**The tree owns adding and reordering; the form owns editing.** A `+` on
each section, and rows that drag. They are navigation rather than editing:
you decide where a step goes by looking at the steps around it, and the
form only ever shows one of them. Delete stayed in the form, where you can
see the thing you are about to remove.
`test_adding_and_reordering_are_not_in_the_form` pins the split. Dragging
is confined to one section — a checklist step dropped into the problem
pages is a step lost — and a map is rebuilt in the new key order rather
than sorted, because for the screen guides the key order *is* the order
the tiles appear in on the tablet.

**The mixer screens are filed under the station that has the console.**
They live in `guides.json`, but a top-level "Mixer screens" heading put
them as far from the sound desk as the tree could manage. So a tree row
names the document it edits and the sound group draws from two files,
keyed off `role.console` rather than off the string "audio".

**The language list is one page, and the only section with no `Writing
in` on it.** Every other section is wording somebody translates; this one
is the setup deciding what they get translated *into*, so a language picker
over the top of it would be asking which language to write a language code
in — hence `untranslated` on the spec. It is also just a short list, so a
tree row and a page per language was more navigation than content: all of
them are rows on one page, with the code, the name and the order together.

**Bold, italic and link are on the box, not above the form.** `MARKS` in
`editor.js` drives both the hover toolbar and ⌘B / ⌘I / ⌘K, bound to the
textarea rather than the window so a shortcut only ever formats the box the
cursor is in. `applyMark()` edits the text and dispatches `input`, so a
keystroke and a button press take the same one path into the draft. It
wraps and unwraps, because pressing bold on something already bold is what
the muscle memory expects. Deliberately not `contenteditable`: what is
stored stays the handful of marks the tablet renders, with no stray spans,
no pasted styling, and a diff that shows the sentence somebody changed.

**The block editor is generated from `BLOCK_TYPES`, and one handler does
every list.** `renderField` takes a path prefix, so the same field spec
works on an entry and on a picture three levels inside it
(`blocks.2.items.1.blocks.1.src`); every control carries that path, and
`arrup`/`arrdown`/`arrdrop`/`blockadd`/`itemadd` splice at any depth through
`atPath`. Without the prefix there would be a form per nesting level, which
is the drift this file's generated forms exist to avoid.

**One language at a time, and the preview is the other view of it.** A
column per language was fine at two and unusable at four: every field
became a wrapping grid and the form got longer in proportion to how many
languages the guide offered. So there is one language — `state.writing`,
kept in `localStorage` because it is a working position rather than part of
the guide — and a field shows one box whether the guide is in two languages
or eight. `renderForm()` repairs it in one place when a language is renamed
or removed out from under it.

**`Writing in` and the segment inside the preview are two ends of one
value.** The mistake was never that the app in the frame has a language
segment — it is the guide, not a mock-up of it, and that control belongs on
a volunteer's tablet. The mistake was a *second* control out here that
could disagree with it. So `showLangInPreview()` presses the app's own
segment (rather than reloading, which would throw away where you had
scrolled to) and `watchPreviewLang()` catches a press of it on the way
down, with `setWriting(lang, fromPreview)` breaking the loop that two
controls telling each other would otherwise make. `previewPlan()` puts the
language back in the hash so a reload lands where you were. The
Tablet/Phone pair is simply gone: the guide is designed for a tablet at one
width.

**The editor runs no git at all.** It used to read the branch and print the
three commands for you to run yourself. The rule behind that was right — a
church's own wording must not be pushable, so there is no button that
could — but repeating three shell lines on every screen was noise on the
way to saying it, and the header already names where a save lands.
`test_the_editor_offers_no_way_to_commit_or_push` now pins the stronger
thing: `editor.py` imports nothing that could run a command, so there is no
code path to audit.

**It is a separate command from the bridge, and that is the design.** The
bridge listens on the LAN so tablets can reach it; a write endpoint there
would put "rewrite the guide" one URL away from every volunteer holding a
tablet mid-service. The bridge has exactly one endpoint that changes
anything — `POST /reconnect`, which broadcasts for a console and can do
nothing else — argued for under "The desk is not always on" rather than
being the start of a trend. The editor binds 127.0.0.1, checks the `Host` header,
and never opens a socket to the console at all — so it runs on a Mac with
no X32 in the building, which is where the writing actually happens.

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
publishes it. Committing a `repo` save is yours to do in a terminal, where
you see the branch first — see "The editor runs no git at all" above.

**`editor.dumps()` is how a guide file is written, and the committed files
are already in that form.** Short `{ "en": …, "ko": … }` blocks stay inline,
long ones open up, measured in display columns because a Korean glyph is two
of them. This is not tidiness: without it the first press of Save reformats
all six files and buries the sentence somebody changed.
`test_the_editor_writes_the_files_exactly_as_they_are` pins it — so a file
hand-edited into a shape the editor would churn fails the suite rather than
surprising the next person who saves.

## Which screen the desk is showing

The console reports **numbers**: `/-stat/screen/screen` and
`/-stat/screen/CHAN/page`. Which screen a number *is* lives on the guide
entry, as `"number"`, and the tablet does the lookup. `console.py` holds no
table of names at all.

This is deliberate and worth not undoing. The numbers are unverified on the
Compact, so the thing most likely to be wrong was the thing that needed a new
release to fix. As content it can be corrected in `mixerm8 --edit`, overridden
per-church in a `*.local.json`, and it takes effect on a tablet reload without
restarting the bridge. Having the bridge resolve names instead would mean
reimplementing the tablet's `.local.json` fallback *and* the override dir in a
second place, and the two could then disagree about what tab 4 is called.

What stays in Python is protocol rather than label: the polled addresses, and
`on_channel = screen == CHANNEL_SCREEN`. That one decides *which reading to
believe* — a channel tab number is stale while the desk shows Routing — so a
content edit must not be able to make the bridge report a tab the desk is not
on. Three rules in `validate.py` guard the data side: every guide carries a
number, no two claim one, and none claims screen 0.

**`mixerm8 --learn` is the third command, and it is the mirror of `--edit`.**
The editor writes guide files and never opens a socket to the desk, because
the writing happens on a Mac with no X32 in the building. Learn opens the
watcher's socket and never serves anything, because the numbers can only come
from a desk. It reuses `editor.Guide`, so a save goes through the same
formatter and the same repo-vs-local target logic as pressing Save.

Writing to the *committed* example is right here, where it is wrong for
wording: a tab number is a fact about the model of desk in the room, carrying
no staff name and no channel layout, so the privacy argument does not apply.
A checkout standing at a real Compact is exactly how the gotcha gets retired.
Learn will not invent a guide entry, though — an empty body fails the content
checks, and titling one "Tab 7" would be a guess about what tab 7 is, so it
reports the number and stops.

## The desk is not always on

The media PC boots before the sound desk on most Sundays, and three of the
four stations never had a console to begin with. So the bridge starts
without one.

- **`mixerm8` no longer resolves an address before it serves anything.** It
  starts the watcher with whatever it remembers — possibly nothing — and
  brings the web server up immediately, so the guide loads whether or not a
  desk exists. The old behaviour was to print "could not find a console"
  and exit 1, from a window the install script minimises, so the visible
  symptom was a tablet that would not load at all.
- **There is nothing to sit and listen for.** The X32 has no mDNS record
  and sends no beacon: it answers `/info` when broadcast at, and pushes
  changes only for the ~10s an `/xremote` subscription lasts. Finding a desk
  means shouting for one, which is why `Console._hunt()` broadcasts on a
  backoff (2s, doubling to 30s) instead of waiting for an announcement that
  never comes.
- **It hunts until a desk answers, even when it remembered an address.**
  Last week's address is not evidence about this week's, and a desk on a new
  DHCP lease used to mean a bridge that sat polling a dead address all
  morning. The first reply ends the hunt, from a broadcast or an ordinary
  poll alike.
- **It never restarts the hunt on its own, and that asymmetry is the
  point.** A desk that goes quiet mid-service is still the desk we want: the
  watcher keeps polling its address and it comes back by itself when the
  power does. Hunting at that moment could instead latch onto a second
  console in the building and follow the wrong one without anybody noticing.
- **`POST /reconnect` is the tablet's Connect button, and the only endpoint
  on the LAN server that changes anything.** It is the deliberate exception
  to the rule that keeps the editor on loopback, and it is narrow: it can
  broadcast `/info` and re-point the watcher, and that is all. It cannot
  reach the desk with anything but a read — `encode_query` still takes no
  arguments — it cannot touch a file, and `Console.reconnect()` debounces
  it, so a volunteer leaning on the button is one broadcast.
  `test_reconnect_is_the_only_post_the_bridge_answers` pins that nothing
  has joined it.
- **The snapshot carries `ip` and `searching`** so the tablet can tell apart
  three states that used to share one message: no bridge (the Pages copy),
  a bridge that has never found a desk, and a desk that was found and has
  gone quiet. Only the last one means "go and switch something on", and
  sending someone to check a cable that is fine costs a Sunday morning.

On the booth machine `install_startup.ps1` still starts the bridge at login
from the Startup folder, and now also installs a **Restart MixerM8** desktop
shortcut next to the Booth Guide one. A Scheduled Task with restart-on-
failure was the alternative; it hides the window, and "is it running?" has
to stay answerable by looking.

## Constraints

- **No runtime dependencies.** `dependencies = []` is deliberate: it keeps
  `pip install` trivial and the frozen exe small. Transport is Server-Sent
  Events precisely because it needs no library. Adding a dependency needs a
  reason worth stating in the commit message.
- **No build step for the app.** `docs/` is hand-written, loads its content from
  `docs/data/*.json`, and uses relative URLs so it works at both `/` (bridge)
  and `/mixerm8/` (Pages). No bundler, no npm, no framework.
- **The tablet is the target.** 19px base, dark-only (a white screen blinds the
  operator in a dim booth), 52px minimum tap targets. One language on screen
  at a time, whichever ones `roles.json` declares.

## Commands

```bash
pip install -e ".[dev]"    # stdlib only at runtime; this adds pytest + ruff
pytest                     # 133 tests, ~28s
ruff check .               # line length 100
mixerm8 --discover         # find consoles on the network
mixerm8 --edit             # the guide editor, localhost only, no console needed
mixerm8 --learn            # record the tab numbers from a real desk
python -m http.server -d docs 8000   # the app in reference mode, no mixer
```

Testing without a desk: `tests/fake_x32.py` is that UDP responder. It answers
the three `/-stat` queries, walks a script of screens (including tab 9, which
is deliberately unmapped so the "not mapped yet" path gets exercised), and
asserts every inbound packet has an empty typetag. Run it standalone against
a real bridge and browser, or let `tests/test_integration.py` drive it
in-process — that is where the read-only guarantee is verified end to end,
from where the desk stands rather than from our own code. A loopback socket
never receives a subnet broadcast, so the tests that exercise the hunt point
`console.BROADCAST` at `127.0.0.1`; that tuple exists as a seam for them and
for nothing else.

## Gotchas

- **The channel-tab numbers are unverified against real hardware.** They live
  on the guide entries in `docs/data/guides.json` (`"number"`), not in
  `console.py`, so correcting one is a content edit rather than a release.
  A number no guide claims surfaces in the UI as "not mapped yet" on purpose;
  that is the discovery mechanism, not a bug to hide. `mixerm8 --learn` is
  how it gets retired.
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
