"""The rules a guide has to obey, in one place.

These used to live only in the test suite, which was fine while the files
were edited by hand next to a terminal. The editor changed that: a media
director rewording a checklist in a browser has no `pytest` to run and no
reason to know that a blank without a `todo` is a failure. So the rules
moved here, `tests/test_content.py` calls them, and the editor calls them
too. A draft that would fail CI is reported in the editor before it is
ever written to disk.

Every check takes parsed documents and returns a list of plain sentences.
Nothing raises: the editor shows all the problems at once rather than
stopping at the first, and a check that cannot apply returns nothing.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# The files that make up a guide, in the order the editor lists them.
DOCUMENTS = ("roles", "ui", "audio", "media", "livestream", "misc", "guides")

# The optional layers a station can declare in roles.json, and the fields
# each entry of one must carry in every declared language. Everything else
# on an entry -- `where`, `action`, `diagram`, `todo` -- is optional.
LAYERS = {
    "checklist": ("text",),
    "problems": ("title", "symptom"),
    "flow": ("when", "title", "detail"),
    "equipment": ("title", "where", "body"),
    # The free-form one. A page carries a heading and then whatever
    # `blocks` somebody put on it: a walkthrough video, a checklist of
    # what was in it, collapsible steps with a diagram inside one. The
    # other four layers each answer a question a volunteer has on a
    # Sunday; this is for the training and reference material that does
    # not fit any of them, which is why it insists on nothing but a title.
    "pages": ("title",),
}

LEVELS = ("ok", "caution", "danger", "info")

# ---------------------------------------------------------------------------
# blocks
# ---------------------------------------------------------------------------
#
# An entry's fixed fields say the things that entry always has to say -- a
# problem page has a symptom, a piece of equipment has a `where`. `blocks`
# is everything else, in whatever order somebody wants it: a paragraph, a
# video, a checklist of what was in the video, a set of collapsible steps
# with a diagram inside one of them.
#
# Deliberately additive. The fixed fields stay exactly as they were and a
# file with no `blocks` is a file that has not changed, so nothing is ever
# half-migrated and the guide keeps working while the platform grows around
# it.
#
# Each type names the fields it must carry in every declared language.
BLOCKS = {
    "text": ("text",),
    "media": (),                 # `src` is not wording; checked separately
    "callout": ("body",),
    "checklist": (),             # its items carry the wording
    "steps": (),
}

# The wording every item of a list-shaped block must carry.
BLOCK_ITEMS = {"checklist": ("text",), "steps": ("title",)}

# What a `media` block may point at. A church's own files live under
# `media/`, which the bridge serves from outside the web root; anything
# else has to ship in `docs/`.
MEDIA_KINDS = {
    "image": (".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"),
    "video": (".mp4", ".webm", ".m4v"),
}
MEDIA_SUFFIXES = tuple(sorted(x for v in MEDIA_KINDS.values() for x in v))

# Sections whose entries carry a stable `id`. Everything used to be
# addressed by array position, which meant a reorder moved a volunteer's
# checklist ticks onto different steps and a link between two pages had
# nothing to point at. `guides` needs no entry here: its pages and screens
# are a map, so the key already is the id.
IDENTIFIED = ("faq", *LAYERS)

# An id goes in a link, so it is kept to the shape a URL would carry.
ENTRY_ID = re.compile(r"[a-z0-9][a-z0-9-]*")

# `[label](target)` inside any piece of wording. An internal target names a
# station, a station and a tab, or an entry: "audio", "audio/problems",
# "audio/problems/a-squeal-or-a-howl". Anything with a scheme is external.
LINK = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")
SCHEME = re.compile(r"([a-z][a-z0-9+.-]*):", re.I)
LINKABLE_SCHEMES = ("http", "https", "mailto")

# Which languages a guide is written in is declared in roles.json, not
# fixed here: a church adding a third one should not need a release. This
# is only what to assume when nothing says otherwise, and it is one
# language rather than two because a file that declares nothing is a file
# that has said nothing about Korean either.
DEFAULT_LANGUAGES = ("en",)

# A language id ends up in a QR code as "#audio/ko", so it is kept to the
# shape of a BCP-47 tag: a subtag of letters, optionally more after a dash.
LANGUAGE_ID = re.compile(r"[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*")

BLANK = re.compile(r"_{4,}")


# ---------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------

def load_documents(directory: Path) -> dict[str, dict]:
    """Parse every guide file in a data directory. A missing one is skipped."""
    docs = {}
    for name in DOCUMENTS:
        path = directory / f"{name}.json"
        if path.is_file():
            docs[name] = json.loads(path.read_text("utf-8"))
    return docs


def roles(docs: dict[str, dict]) -> list[dict]:
    return docs.get("roles", {}).get("roles", []) or []


def languages(docs: dict[str, dict]) -> tuple[str, ...]:
    """The languages this guide is written in, in the order it declares them.

    `roles.json` is the one place that answers this, and every rule below
    asks it rather than assuming. An entry may be a bare `"es"` or a
    `{"id": "es", "label": "Español"}` -- the label is for the segment
    button on the tablet and means nothing here. The first one declared is
    what the app falls back to when a block is not translated yet, which is
    why order is preserved instead of sorted.
    """
    out: list[str] = []
    for item in docs.get("roles", {}).get("languages") or ():
        lang = item if isinstance(item, str) else (item or {}).get("id")
        if isinstance(lang, str) and lang.strip() and lang.strip() not in out:
            out.append(lang.strip())
    return tuple(out) or DEFAULT_LANGUAGES


def station_ids(docs: dict[str, dict]) -> list[str]:
    return [r["id"] for r in roles(docs) if "id" in r]


def _walk(docs, visit) -> None:
    """Every node of every document, with a dotted path for the message."""
    def go(where, node):
        if isinstance(node, dict):
            visit(where, node)
            for key, value in node.items():
                go(f"{where}.{key}", value)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                go(f"{where}[{i}]", item)
        else:
            visit(where, node)

    for name, doc in docs.items():
        go(f"{name}.json", doc)


# ---------------------------------------------------------------------------
# the rules
# ---------------------------------------------------------------------------

def blanks_without_todos(docs: dict[str, dict]) -> list[str]:
    """Every "____" has a `todo` at or above it saying what is missing.

    A blank with no explanation is just a gap a volunteer reads past. The
    rule is that unknown state is a display case, not an omission, so the
    two travel together. Tracked through lists as well as objects, because
    problem steps are a list of language blocks.
    """
    found: list[str] = []

    def go(where, node, covered):
        if isinstance(node, dict):
            covered = covered or "todo" in node
            for key, value in node.items():
                go(f"{where}.{key}", value, covered)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                go(f"{where}[{i}]", item, covered)
        elif isinstance(node, str) and BLANK.search(node) and not covered:
            found.append(f"{where} has a blank with no 'todo' above it")

    for name, doc in docs.items():
        go(f"{name}.json", doc, False)
    return found


def todos_missing_a_language(docs: dict[str, dict]) -> list[str]:
    """A `todo` says what is still unknown, so it is the last thing that
    should be readable in only some of the languages on the tablet."""
    missing: list[str] = []
    wanted = languages(docs)

    def visit(where, node):
        if isinstance(node, dict) and isinstance(node.get("todo"), dict):
            for lang in wanted:
                if not node["todo"].get(lang):
                    missing.append(f"{where}.todo missing {lang}")

    _walk(docs, visit)
    return missing


def bad_language_ids(docs: dict[str, dict]) -> list[str]:
    """The declared languages, checked where they are declared.

    An id ends up in a QR code as "#audio/ko" and as the key every block in
    every file is written under, so a typo here is not one bad sticker --
    it is a language the whole guide claims to be written in and never is.
    A label may be left out (the app knows the common endonyms) but an
    empty one would render as a nameless button.
    """
    problems: list[str] = []
    declared = docs.get("roles", {}).get("languages")
    if declared is not None and not declared:
        problems.append("roles.json declares an empty language list; leave "
                        "the key out to mean English alone")
    seen: set[str] = set()
    for i, item in enumerate(declared or ()):
        where = f"roles.json languages[{i}]"
        if isinstance(item, str):
            lang, label = item, None
        elif isinstance(item, dict):
            lang, label = item.get("id"), item.get("label", None)
        else:
            problems.append(f"{where} is neither a language code nor an "
                            f"{{id, label}} block")
            continue
        if not isinstance(lang, str) or not LANGUAGE_ID.fullmatch(lang.strip()):
            problems.append(f"{where} has id {lang!r}, which is not a "
                            f"language code a URL could carry")
            continue
        if "label" in (item if isinstance(item, dict) else {}) and not (
                isinstance(label, str) and label.strip()):
            problems.append(f"{where} has an empty label, so its button on "
                            f"the tablet would have no name")
        if lang.strip() in seen:
            problems.append(f"{where} declares {lang.strip()!r} twice")
        seen.add(lang.strip())
    return problems


def app_wording_missing_a_language(docs: dict[str, dict]) -> list[str]:
    """The app's own words are content, so they obey the same rule.

    ui.json carries the tab names, the badges, the status pill and the
    connection messages. Without this check a station added in a third
    language would render half in that language and half in the first one,
    and nothing would say so.
    """
    missing: list[str] = []
    wanted = languages(docs)
    for key, block in ((docs.get("ui") or {}).get("strings") or {}).items():
        if not isinstance(block, dict):
            missing.append(f"ui.strings.{key} is not a language block")
            continue
        for lang in wanted:
            if not block.get(lang):
                missing.append(f"ui.strings.{key} missing {lang}")
    return missing


def _blocks_in(docs: dict[str, dict]):
    """Every ("where", block, depth) in the guide.

    Depth is how many `steps` blocks a block sits inside, which is what the
    nesting rule below is about. Blocks hang off entries and off the items
    of a `steps` block, and nowhere else.
    """
    def go(where, blocks, depth):
        if not isinstance(blocks, list):
            return
        for i, block in enumerate(blocks):
            if not isinstance(block, dict):
                yield f"{where}[{i}]", block, depth
                continue
            yield f"{where}[{i}]", block, depth
            for j, item in enumerate(block.get("items") or []):
                if isinstance(item, dict):
                    yield from go(f"{where}[{i}].items[{j}].blocks",
                                  item.get("blocks"),
                                  depth + (1 if block.get("type") == "steps" else 0))

    def walk(where, node):
        if isinstance(node, dict):
            if isinstance(node.get("blocks"), list):
                yield from go(f"{where}.blocks", node["blocks"], 0)
            for key, value in node.items():
                if key != "blocks":
                    yield from walk(f"{where}.{key}", value)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                yield from walk(f"{where}[{i}]", item)

    for name, doc in docs.items():
        yield from walk(f"{name}.json", doc)


def unknown_block_types(docs: dict[str, dict]) -> list[str]:
    """A block the app has never heard of renders as nothing at all.

    Which is the worst way to be wrong: the editor shows it, the file
    carries it, and the tablet is simply missing a paragraph.
    """
    wrong: list[str] = []
    for where, block, _ in _blocks_in(docs):
        if not isinstance(block, dict):
            wrong.append(f"{where} is not a block")
        elif block.get("type") not in BLOCKS:
            wrong.append(f"{where} has type {block.get('type')!r}, expected "
                         f"one of {', '.join(sorted(BLOCKS))}")
    return wrong


def incomplete_blocks(docs: dict[str, dict]) -> list[str]:
    """Every block's own wording, in every declared language."""
    problems: list[str] = []
    wanted = languages(docs)
    for where, block, _ in _blocks_in(docs):
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        for field in BLOCKS.get(kind) or ():
            node = block.get(field)
            if not isinstance(node, dict):
                problems.append(f"{where} is a {kind} block with no {field}")
                continue
            for lang in wanted:
                if not node.get(lang):
                    problems.append(f"{where}.{field} missing {lang}")

        fields = BLOCK_ITEMS.get(kind)
        if fields is None:
            continue
        items = block.get("items")
        if not items:
            problems.append(f"{where} is a {kind} block with no items")
            continue
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                problems.append(f"{where}.items[{i}] is not an item")
                continue
            for field in fields:
                node = item.get(field)
                if not isinstance(node, dict):
                    problems.append(f"{where}.items[{i}] has no {field}")
                    continue
                for lang in wanted:
                    if not node.get(lang):
                        problems.append(
                            f"{where}.items[{i}].{field} missing {lang}")
    return problems


def steps_nested_too_deep(docs: dict[str, dict]) -> list[str]:
    """Collapsible steps inside collapsible steps.

    One level is the useful case -- a step with a diagram or a video in it.
    Two is a volunteer opening a card to find another card, mid-service,
    which is the opposite of what the layer is for. So the nesting stops
    here rather than in whatever renders it.
    """
    return [f"{where} puts collapsible steps inside collapsible steps, "
            f"which is one card too many to open"
            for where, block, depth in _blocks_in(docs)
            if isinstance(block, dict) and block.get("type") == "steps" and depth]


def block_items_without_ids(docs: dict[str, dict]) -> list[str]:
    """A checklist item is ticked, so it needs an address like any other.

    Scoped to the whole station rather than to the block, because that is
    how the ticks are stored: one flat set per station, keyed by id, so two
    items sharing one anywhere in the file would tick together.
    """
    problems: list[str] = []
    seen: dict[str, dict[str, str]] = {}
    for where, block, _ in _blocks_in(docs):
        if not isinstance(block, dict) or block.get("type") not in BLOCK_ITEMS:
            continue
        doc = where.split(".", 1)[0]
        for i, item in enumerate(block.get("items") or []):
            if not isinstance(item, dict):
                continue
            iid = item.get("id")
            at = f"{where}.items[{i}]"
            if not isinstance(iid, str) or not iid:
                problems.append(f"{at} has no id, so a tick on it moves when "
                                f"it does")
                continue
            if not ENTRY_ID.fullmatch(iid):
                problems.append(f"{at} has id {iid!r}, which is not the shape "
                                f"a link could carry")
                continue
            here = seen.setdefault(doc, {})
            if iid in here:
                problems.append(f"{at} and {here[iid]} both claim the id "
                                f"{iid!r}, so they would tick together")
            else:
                here[iid] = at
    return problems


def broken_media(docs: dict[str, dict], root: Path | None = None) -> list[str]:
    """A media block points at something a tablet can actually play.

    Three kinds of source, and only one of them can be checked here:
    something shipping in `docs/`, which must exist; something under
    `media/`, which lives on the booth machine and is not here to look at;
    and an https address, which is somebody else's server. What is always
    checkable is the suffix -- a name the app cannot tell an image from a
    video by is a blank space on the page.
    """
    problems: list[str] = []
    for where, block, _ in _blocks_in(docs):
        if not isinstance(block, dict) or block.get("type") != "media":
            continue
        src = block.get("src")
        if not isinstance(src, str) or not src:
            problems.append(f"{where} is a media block with no src")
            continue
        scheme = SCHEME.match(src)
        if scheme and scheme.group(1).lower() not in ("http", "https"):
            problems.append(f"{where} points at {src!r}, which is not an "
                            f"address a tablet would fetch")
            continue
        if not src.lower().endswith(MEDIA_SUFFIXES):
            problems.append(f"{where} points at {src!r}, and its name says "
                            f"nothing about what it is -- one of "
                            f"{', '.join(MEDIA_SUFFIXES)}")
            continue
        # Only a file that ships with the guide is here to be looked at.
        if root is not None and not scheme and not src.startswith("media/"):
            if not (root / src).is_file():
                problems.append(f"{where} -> {src} does not exist")
    return problems


def _identified(docs: dict[str, dict]):
    """Each (doc name, section, index, entry) that ought to carry an id."""
    for name, doc in docs.items():
        if name in ("roles", "ui", "guides"):
            continue
        for section in IDENTIFIED:
            entries = doc.get(section)
            if not isinstance(entries, list):
                continue
            for i, entry in enumerate(entries):
                if isinstance(entry, dict):
                    yield name, section, i, entry


def entries_without_ids(docs: dict[str, dict]) -> list[str]:
    """Position is not an address. An entry with no id cannot be linked to,
    and the tick a volunteer put on it lands on whatever moved into its
    place."""
    return [f"{name}.{section}[{i}] has no id, so nothing can point at it "
            f"and a tick on it moves when it does"
            for name, section, i, entry in _identified(docs)
            if not isinstance(entry.get("id"), str) or not entry["id"]]


def bad_entry_ids(docs: dict[str, dict]) -> list[str]:
    """Ids end up in links, so they are kept boring like the role ids."""
    return [f"{name}.{section}[{i}] has id {entry['id']!r}, which is not the "
            f"shape a link could carry"
            for name, section, i, entry in _identified(docs)
            if isinstance(entry.get("id"), str) and entry["id"]
            and not ENTRY_ID.fullmatch(entry["id"])]


def entry_ids_claimed_twice(docs: dict[str, dict]) -> list[str]:
    """Two entries on one id means a link reaches whichever comes first
    and the other is unreachable. Scoped per section, because that is how
    a link addresses one: station, tab, id."""
    clashes: list[str] = []
    claimed: dict[tuple[str, str], dict[str, int]] = {}
    for name, section, i, entry in _identified(docs):
        eid = entry.get("id")
        if not isinstance(eid, str) or not eid:
            continue        # entries_without_ids has this one
        seen = claimed.setdefault((name, section), {})
        if eid in seen:
            clashes.append(f"{name}.{section}: entries {seen[eid]} and {i} "
                           f"both claim the id {eid!r}")
        else:
            seen[eid] = i
    return clashes


def _link_targets(docs: dict[str, dict]):
    """Every ("where", label, target) a piece of wording links to."""
    def go(where, node):
        if isinstance(node, dict):
            for key, value in node.items():
                yield from go(f"{where}.{key}", value)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                yield from go(f"{where}[{i}]", item)
        elif isinstance(node, str):
            for label, target in LINK.findall(node):
                yield where, label, target

    for name, doc in docs.items():
        yield from go(f"{name}.json", doc)


def dead_links(docs: dict[str, dict]) -> list[str]:
    """A link either leaves the guide or lands somewhere inside it.

    A "see also" pointing at an entry that has been renamed or deleted is
    worse than no link at all: it reads as an answer and goes nowhere. So
    every internal target is resolved against the guide it sits in, and an
    external one has to use a scheme a tablet will actually open --
    `javascript:` in a church's own file is not a threat model worth
    pretending about, but it is certainly not a link.
    """
    problems: list[str] = []
    sections = {rid: set(IDENTIFIED) for rid in station_ids(docs)}

    for where, label, target in _link_targets(docs):
        scheme = SCHEME.match(target)
        if scheme:
            if scheme.group(1).lower() not in LINKABLE_SCHEMES:
                problems.append(f"{where}: {label!r} links to {target!r}, "
                                f"which is not a link a tablet would open")
            continue

        parts = target.split("/")
        if len(parts) > 3:
            problems.append(f"{where}: {label!r} links to {target!r}, which "
                            f"is deeper than station/tab/entry")
            continue
        rid = parts[0]
        if rid not in sections:
            problems.append(f"{where}: {label!r} links to the station "
                            f"{rid!r}, which does not exist")
            continue
        if len(parts) == 1:
            continue
        if parts[1] not in sections[rid]:
            problems.append(f"{where}: {label!r} links to {rid}/{parts[1]}, "
                            f"which is not a tab that station has")
            continue
        if len(parts) == 2:
            continue
        known = {e.get("id") for e in (docs.get(rid) or {}).get(parts[1]) or []
                 if isinstance(e, dict)}
        if parts[2] not in known:
            problems.append(f"{where}: {label!r} links to {target!r}, and "
                            f"nothing there has that id any more")
    return problems


def bad_role_ids(docs: dict[str, dict]) -> list[str]:
    """They end up in a QR code as "#audio/ko", so keep them boring."""
    return [f"role id {rid!r} is not url-safe" for rid in station_ids(docs)
            if not re.fullmatch(r"[a-z][a-z0-9-]*", rid)]


def roles_without_content(docs: dict[str, dict]) -> list[str]:
    """A role with no file is a volunteer at a station with a dead page."""
    return [f"no content file for role {rid}" for rid in station_ids(docs)
            if rid not in docs]


def layers_out_of_step(docs: dict[str, dict]) -> list[str]:
    """A declared layer is complete; an undeclared one is absent.

    Pinned in both directions. `misc` is questions and policies with no
    equipment behind it, so it declares none of them -- and a tab offering
    an empty checklist is worse than no tab at all. The other way round, a
    layer sitting in a file that no role declares is content nothing shows.
    """
    problems: list[str] = []
    for role in roles(docs):
        rid = role.get("id")
        data = docs.get(rid)
        if data is None:
            continue
        declared = set(role.get("layers") or [])
        for unknown in sorted(declared - set(LAYERS)):
            problems.append(f"{rid} declares an unknown layer {unknown!r}")
        for layer in LAYERS:
            if layer in declared:
                if not data.get(layer):
                    problems.append(f"{rid} declares {layer} but has none")
            elif layer in data:
                problems.append(
                    f"{rid} carries a {layer} it does not declare, "
                    f"so nothing shows it")
    return problems


def incomplete_layers(docs: dict[str, dict]) -> list[str]:
    """Every declared layer, in every declared language, all the way down."""
    problems: list[str] = []
    wanted = languages(docs)
    for role in roles(docs):
        rid = role.get("id")
        data = docs.get(rid)
        if data is None:
            continue
        for layer in role.get("layers") or []:
            fields = LAYERS.get(layer)
            if not fields:
                continue
            for i, entry in enumerate(data.get(layer) or []):
                for field in fields:
                    block = entry.get(field)
                    if not isinstance(block, dict):
                        problems.append(f"{rid}.{layer}[{i}] has no {field}")
                        continue
                    for lang in wanted:
                        if not block.get(lang):
                            problems.append(
                                f"{rid}.{layer}[{i}].{field} missing {lang}")

        for i, prob in enumerate(data.get("problems") or []
                                 if "problems" in (role.get("layers") or []) else []):
            if not prob.get("steps"):
                problems.append(f"{rid}.problems[{i}] has no steps")
            for j, step in enumerate(prob.get("steps") or []):
                for lang in wanted:
                    if not step.get(lang):
                        problems.append(
                            f"{rid}.problems[{i}].steps[{j}] missing {lang}")
    return problems


def pages_with_nothing_on_them(docs: dict[str, dict]) -> list[str]:
    """A page is its blocks. One with none is a tile that opens on nothing.

    The other four layers have fixed fields carrying their wording, so an
    empty one is already caught by `incomplete_layers`. A page's heading
    is the only field it must have, so this is the rule that keeps the
    freedom from being a way to publish a blank.
    """
    empty: list[str] = []
    for role in roles(docs):
        if "pages" not in (role.get("layers") or []):
            continue
        for i, page in enumerate((docs.get(role["id"]) or {}).get("pages") or []):
            if not isinstance(page, dict) or not page.get("blocks"):
                empty.append(f"{role['id']}.pages[{i}] has a heading and "
                             f"nothing on it")
    return empty


def missing_home_page(docs: dict[str, dict]) -> list[str]:
    """The station's front page is the landing view, so it is never empty."""
    problems: list[str] = []
    wanted = languages(docs)
    for rid in station_ids(docs):
        data = docs.get(rid)
        if data is None:
            continue
        intro = data.get("intro") or {}
        for lang in wanted:
            if not intro.get(lang):
                problems.append(f"{rid}.intro missing {lang}")
        faq = data.get("faq") or []
        if not faq:
            problems.append(f"{rid} has no questions on its front page")
        for i, item in enumerate(faq):
            for key in ("q", "a"):
                for lang in wanted:
                    if not (item.get(key) or {}).get(lang):
                        problems.append(f"{rid}.faq[{i}].{key} missing {lang}")
    return problems


def component_shaped_problem_titles(docs: dict[str, dict]) -> list[str]:
    """Titles describe what the volunteer notices, not what the gear is.

    A page called "Gate" only helps someone who already knows the word.
    The layer exists for the volunteer who does not, so each title has to
    read as a complaint.
    """
    bad: list[str] = []
    for role in roles(docs):
        if "problems" not in (role.get("layers") or []):
            continue
        for prob in (docs.get(role["id"]) or {}).get("problems") or []:
            title = (prob.get("title") or {}).get("en") or ""
            if len(title.split()) < 3:
                bad.append(f"{role['id']}: {title!r} reads like a component, "
                           f"not a symptom")
    return bad


def bad_levels(docs: dict[str, dict]) -> list[str]:
    """An unknown level renders grey and silent, so it is worth catching."""
    wrong: list[str] = []

    def visit(where, node):
        if isinstance(node, dict):
            level = node.get("level")
            if isinstance(level, str) and level not in LEVELS:
                wrong.append(f"{where} has level {level!r}, expected one of "
                             f"{', '.join(LEVELS)}")

    _walk(docs, visit)
    return wrong


def guides_missing_language(docs: dict[str, dict]) -> list[str]:
    missing: list[str] = []
    wanted = languages(docs)
    for group in ("pages", "screens"):
        for key, entry in ((docs.get("guides") or {}).get(group) or {}).items():
            for lang in wanted:
                if not (entry.get("body") or {}).get(lang):
                    missing.append(f"guides.{group}.{key} body missing {lang}")
    return missing


def _guide_groups(docs: dict[str, dict]):
    """Each ("pages"|"screens", key, entry) of the guide, if there is one."""
    for group in ("pages", "screens"):
        for key, entry in ((docs.get("guides") or {}).get(group) or {}).items():
            if isinstance(entry, dict):
                yield group, key, entry


def guides_without_a_number(docs: dict[str, dict]) -> list[str]:
    """The number is how the desk asks for a guide, so a guide without one
    can never be brought up. `bool` is excluded because it is an `int`."""
    orphans: list[str] = []
    for group, key, entry in _guide_groups(docs):
        n = entry.get("number")
        if isinstance(n, bool) or not isinstance(n, int) or n < 0:
            orphans.append(f"guides.{group}.{key} has no number the desk could "
                           f"report, so it can never come up")
    return orphans


def numbers_claimed_twice(docs: dict[str, dict]) -> list[str]:
    """Two guides on one number means one of them is dead content.

    The groups are separate namespaces -- the desk reports a channel tab and
    a screen on different addresses -- so this never compares across them.
    """
    clashes: list[str] = []
    for group in ("pages", "screens"):
        claimed: dict[int, str] = {}
        for g, key, entry in _guide_groups(docs):
            if g != group:
                continue
            n = entry.get("number")
            if isinstance(n, bool) or not isinstance(n, int):
                continue        # guides_without_a_number has this one
            if n in claimed:
                clashes.append(f"guides.{group}: {key} and {claimed[n]} both "
                               f"claim number {n}")
            else:
                claimed[n] = key
    return clashes


def channel_screen_guided_as_a_screen(docs: dict[str, dict]) -> list[str]:
    """Screen 0 is the channel strip, where the tab decides what shows.

    A `screens` entry numbered 0 is therefore invisible: the app reads the
    channel tab instead and never looks it up. Its guide belongs in `pages`.
    """
    return [f"guides.screens.{key} is numbered 0, the channel screen, where "
            f"the channel tab decides what shows -- it belongs in pages"
            for group, key, entry in _guide_groups(docs)
            if group == "screens" and entry.get("number") == 0]


def broken_diagrams(docs: dict[str, dict], root: Path | None = None) -> list[str]:
    """A diagram is optional, but a broken one is a broken image on a tablet.

    `root` is the web root a `src` is relative to. Without one only the
    bilingual alt text is checked, because there is nothing to resolve
    against -- a church's own drawing may legitimately not be here yet.
    """
    problems: list[str] = []
    wanted = languages(docs)

    def visit(where, node):
        if not isinstance(node, dict):
            return
        fig = node.get("diagram")
        if not isinstance(fig, dict) or not fig.get("src"):
            return
        for lang in wanted:
            if not (fig.get("alt") or {}).get(lang):
                problems.append(f"{where}.diagram.alt missing {lang}")
        if root is not None and not (root / fig["src"]).is_file():
            problems.append(f"{where}.diagram -> {fig['src']} does not exist")

    _walk(docs, visit)
    return problems


ALL_CHECKS = (
    blanks_without_todos,
    unknown_block_types,
    incomplete_blocks,
    steps_nested_too_deep,
    block_items_without_ids,
    broken_media,
    todos_missing_a_language,
    bad_language_ids,
    app_wording_missing_a_language,
    entries_without_ids,
    bad_entry_ids,
    entry_ids_claimed_twice,
    dead_links,
    bad_role_ids,
    roles_without_content,
    layers_out_of_step,
    incomplete_layers,
    missing_home_page,
    pages_with_nothing_on_them,
    component_shaped_problem_titles,
    bad_levels,
    guides_missing_language,
    guides_without_a_number,
    numbers_claimed_twice,
    channel_screen_guided_as_a_screen,
    broken_diagrams,
)


def check(docs: dict[str, dict], root: Path | None = None) -> list[str]:
    """Every rule, against a whole guide. Empty means it would pass CI."""
    problems: list[str] = []
    takes_root = (broken_diagrams, broken_media)
    for rule in ALL_CHECKS:
        problems.extend(rule(docs, root) if rule in takes_root else rule(docs))
    return problems
