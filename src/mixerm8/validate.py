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

**An empty page is not an error.** It used to be -- a station declared a
layer and the layer had to be complete -- and that was right about the
tablet and wrong about the editor, where the only way to build a page is
to make an empty one first. The tablet keeps the guarantee anyway, because
`visible_pages()` hides a page with nothing in it. So adding a page and
filling it in over three Sundays is a normal thing to do, and a volunteer
still never meets an empty tab.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# The files that make up a guide, in the order the editor lists them.
DOCUMENTS = ("roles", "audio", "media", "livestream", "misc", "guides")

# What a page can be, and the fields each of its items must carry in both
# languages. Everything else on an item -- `todo`, `action`, `diagram`,
# `where` outside equipment -- is optional.
KINDS = {
    "checklist": ("text",),
    "problems": ("title", "symptom"),
    "flow": ("when", "title", "detail"),
    "equipment": ("title", "where", "body"),
    "cards": ("title", "body"),
    "mixer": (),        # its content is guides.json, not a list of items
}

# Pages that carry no `items` of their own.
CONTENTLESS = ("mixer",)

LEVELS = ("ok", "caution", "danger", "info")
LANGUAGES = ("en", "ko")

BLANK = re.compile(r"_{4,}")
ID = re.compile(r"[a-z][a-z0-9-]*")


# ---------------------------------------------------------------------------
# loading and shape helpers
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


def station_ids(docs: dict[str, dict]) -> list[str]:
    return [r["id"] for r in roles(docs) if "id" in r]


def pages(doc: dict) -> list[dict]:
    return doc.get("pages") or []


def has_content(page: dict) -> bool:
    """Whether this page has anything for a volunteer to read."""
    if page.get("kind") in CONTENTLESS:
        return True
    return bool(page.get("items"))


def visible_pages(doc: dict) -> list[dict]:
    """The pages that earn a tab: not hidden, and not empty.

    This is the rule that used to be enforced by refusing to let a layer be
    declared without content. Enforcing it here instead means the editor can
    hold a half-built page without the guide being "broken", while the tablet
    still never offers a tab onto nothing.
    """
    return [p for p in pages(doc) if not p.get("hidden") and has_content(p)]


def _walk(docs, visit) -> None:
    """Every node of every document, with a dotted path for the message."""
    def go(where, node):
        visit(where, node)
        if isinstance(node, dict):
            for key, value in node.items():
                go(f"{where}.{key}", value)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                go(f"{where}[{i}]", item)

    for name, doc in docs.items():
        go(f"{name}.json", doc)


def _bilingual(block, where: str, out: list[str]) -> None:
    if not isinstance(block, dict):
        out.append(f"{where} is missing")
        return
    for lang in LANGUAGES:
        if not block.get(lang):
            out.append(f"{where} missing {lang}")


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


def todos_not_bilingual(docs: dict[str, dict]) -> list[str]:
    missing: list[str] = []

    def visit(where, node):
        if isinstance(node, dict) and isinstance(node.get("todo"), dict):
            _bilingual(node["todo"], f"{where}.todo", missing)

    _walk(docs, visit)
    return missing


def bad_role_ids(docs: dict[str, dict]) -> list[str]:
    """They end up in a QR code as "#audio/ko", so keep them boring."""
    return [f"role id {rid!r} is not url-safe" for rid in station_ids(docs)
            if not ID.fullmatch(rid)]


def roles_without_content(docs: dict[str, dict]) -> list[str]:
    """A role with no file is a volunteer at a station with a dead page."""
    return [f"no content file for role {rid}" for rid in station_ids(docs)
            if rid not in docs]


def bad_pages(docs: dict[str, dict]) -> list[str]:
    """Ids, kinds, names and Next targets.

    A page is free to be empty or hidden. What it may not be is nameless,
    of a kind nothing can draw, or pointing its Next button at a page that
    does not exist -- a dead end is worse than no button at all.
    """
    problems: list[str] = []
    for rid in station_ids(docs):
        doc = docs.get(rid)
        if doc is None:
            continue
        seen: set[str] = set()
        ids = {p.get("id") for p in pages(doc)}
        for i, page in enumerate(pages(doc)):
            where = f"{rid}.pages[{i}]"
            pid = page.get("id")
            if not isinstance(pid, str) or not ID.fullmatch(pid):
                problems.append(f"{where}.id {pid!r} is not url-safe")
            elif pid in seen:
                problems.append(f"{where}.id {pid!r} is used twice in {rid}")
            else:
                seen.add(pid)

            kind = page.get("kind")
            if kind not in KINDS:
                problems.append(f"{where}.kind {kind!r} is not one of "
                                f"{', '.join(sorted(KINDS))}")
            _bilingual(page.get("label"), f"{where}.label", problems)
            for optional in ("blurb", "lede"):
                if page.get(optional) is not None:
                    _bilingual(page[optional], f"{where}.{optional}", problems)

            nxt = page.get("next")
            if nxt is not None:
                if nxt == pid:
                    problems.append(f"{where}.next points at itself")
                elif nxt not in ids:
                    problems.append(f"{where}.next points at {nxt!r}, "
                                    f"which is not a page in {rid}")
            if kind in CONTENTLESS and page.get("items"):
                problems.append(f"{where} is a {kind} page and cannot hold items")
    return problems


def incomplete_items(docs: dict[str, dict]) -> list[str]:
    """Every item a page does carry, in both languages, all the way down."""
    problems: list[str] = []
    for rid in station_ids(docs):
        doc = docs.get(rid)
        if doc is None:
            continue
        for page in pages(doc):
            fields = KINDS.get(page.get("kind"))
            if not fields:
                continue
            where = f"{rid}.{page.get('id')}"
            for i, item in enumerate(page.get("items") or []):
                for name in fields:
                    _bilingual(item.get(name), f"{where}[{i}].{name}", problems)
                if page["kind"] != "problems":
                    continue
                if not item.get("steps"):
                    problems.append(f"{where}[{i}] has no steps")
                for j, step in enumerate(item.get("steps") or []):
                    _bilingual(step, f"{where}[{i}].steps[{j}]", problems)
    return problems


def missing_home_page(docs: dict[str, dict]) -> list[str]:
    """The station's front page is the landing view, so it is never empty.

    Home is deliberately not one of the `pages`: it cannot be reordered
    away, hidden, or deleted, because it is what a QR sticker lands on.
    """
    problems: list[str] = []
    for rid in station_ids(docs):
        doc = docs.get(rid)
        if doc is None:
            continue
        _bilingual(doc.get("intro"), f"{rid}.intro", problems)
        faq = doc.get("faq") or []
        if not faq:
            problems.append(f"{rid} has no questions on its front page")
        for i, item in enumerate(faq):
            for key in ("q", "a"):
                _bilingual(item.get(key), f"{rid}.faq[{i}].{key}", problems)
    return problems


def component_shaped_problem_titles(docs: dict[str, dict]) -> list[str]:
    """Titles describe what the volunteer notices, not what the gear is.

    A page called "Gate" only helps someone who already knows the word.
    The kind exists for the volunteer who does not, so each title has to
    read as a complaint.
    """
    bad: list[str] = []
    for rid in station_ids(docs):
        for page in pages(docs.get(rid) or {}):
            if page.get("kind") != "problems":
                continue
            for item in page.get("items") or []:
                title = (item.get("title") or {}).get("en") or ""
                if title and len(title.split()) < 3:
                    bad.append(f"{rid}: {title!r} reads like a component, "
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
    for group in ("pages", "screens"):
        for key, entry in ((docs.get("guides") or {}).get(group) or {}).items():
            _bilingual(entry.get("body"), f"guides.{group}.{key} body", missing)
    return missing


def unguided_channel_pages(docs: dict[str, dict]) -> list[str]:
    """A tab the console can report should have something to say about it."""
    from .console import CHAN_PAGES

    if "guides" not in docs:
        return []
    known = (docs["guides"].get("pages")) or {}
    return [f"no guide written for channel tab {name}"
            for name in CHAN_PAGES.values() if name not in known]


def broken_diagrams(docs: dict[str, dict], root: Path | None = None) -> list[str]:
    """A picture is optional, but a broken one is a broken image on a tablet.

    `root` is the web root a `src` is relative to. Uploaded images live
    outside it -- `img/local/` in a checkout, the override folder on the
    booth machine -- so those are checked for alt text and left alone.
    """
    problems: list[str] = []

    def visit(where, node):
        if not isinstance(node, dict):
            return
        fig = node.get("diagram")
        if not isinstance(fig, dict) or not fig.get("src"):
            return
        _bilingual(fig.get("alt"), f"{where}.diagram.alt", problems)
        src = fig["src"]
        if root is not None and not src.startswith("img/local/") \
                and not (root / src).is_file():
            problems.append(f"{where}.diagram -> {src} does not exist")

    _walk(docs, visit)
    return problems


ALL_CHECKS = (
    blanks_without_todos,
    todos_not_bilingual,
    bad_role_ids,
    roles_without_content,
    bad_pages,
    incomplete_items,
    missing_home_page,
    component_shaped_problem_titles,
    bad_levels,
    guides_missing_language,
    unguided_channel_pages,
    broken_diagrams,
)


def check(docs: dict[str, dict], root: Path | None = None) -> list[str]:
    """Every rule, against a whole guide. Empty means it would pass CI."""
    problems: list[str] = []
    for rule in ALL_CHECKS:
        problems.extend(rule(docs, root) if rule is broken_diagrams else rule(docs))
    return problems
