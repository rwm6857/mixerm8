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
DOCUMENTS = ("roles", "audio", "media", "livestream", "misc", "guides")

# The optional layers a station can declare in roles.json, and the fields
# each entry of one must carry in both languages. Everything else on an
# entry -- `where`, `action`, `diagram`, `todo` -- is optional.
LAYERS = {
    "checklist": ("text",),
    "problems": ("title", "symptom"),
    "flow": ("when", "title", "detail"),
    "equipment": ("title", "where", "body"),
}

LEVELS = ("ok", "caution", "danger", "info")
LANGUAGES = ("en", "ko")

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


def todos_not_bilingual(docs: dict[str, dict]) -> list[str]:
    missing: list[str] = []

    def visit(where, node):
        if isinstance(node, dict) and isinstance(node.get("todo"), dict):
            for lang in LANGUAGES:
                if not node["todo"].get(lang):
                    missing.append(f"{where}.todo missing {lang}")

    _walk(docs, visit)
    return missing


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
    """Every declared layer, in both languages, all the way down."""
    problems: list[str] = []
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
                    for lang in LANGUAGES:
                        if not block.get(lang):
                            problems.append(
                                f"{rid}.{layer}[{i}].{field} missing {lang}")

        for i, prob in enumerate(data.get("problems") or []
                                 if "problems" in (role.get("layers") or []) else []):
            if not prob.get("steps"):
                problems.append(f"{rid}.problems[{i}] has no steps")
            for j, step in enumerate(prob.get("steps") or []):
                for lang in LANGUAGES:
                    if not step.get(lang):
                        problems.append(
                            f"{rid}.problems[{i}].steps[{j}] missing {lang}")
    return problems


def missing_home_page(docs: dict[str, dict]) -> list[str]:
    """The station's front page is the landing view, so it is never empty."""
    problems: list[str] = []
    for rid in station_ids(docs):
        data = docs.get(rid)
        if data is None:
            continue
        intro = data.get("intro") or {}
        for lang in LANGUAGES:
            if not intro.get(lang):
                problems.append(f"{rid}.intro missing {lang}")
        faq = data.get("faq") or []
        if not faq:
            problems.append(f"{rid} has no questions on its front page")
        for i, item in enumerate(faq):
            for key in ("q", "a"):
                for lang in LANGUAGES:
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
    for group in ("pages", "screens"):
        for key, entry in ((docs.get("guides") or {}).get(group) or {}).items():
            for lang in LANGUAGES:
                if not (entry.get("body") or {}).get(lang):
                    missing.append(f"guides.{group}.{key} body missing {lang}")
    return missing


def unguided_channel_pages(docs: dict[str, dict]) -> list[str]:
    """A tab the console can report should have something to say about it."""
    from .console import CHAN_PAGES

    if "guides" not in docs:
        return []
    pages = (docs["guides"].get("pages")) or {}
    return [f"no guide written for channel tab {name}"
            for name in CHAN_PAGES.values() if name not in pages]


def broken_diagrams(docs: dict[str, dict], root: Path | None = None) -> list[str]:
    """A diagram is optional, but a broken one is a broken image on a tablet.

    `root` is the web root a `src` is relative to. Without one only the
    bilingual alt text is checked, because there is nothing to resolve
    against -- a church's own drawing may legitimately not be here yet.
    """
    problems: list[str] = []

    def visit(where, node):
        if not isinstance(node, dict):
            return
        fig = node.get("diagram")
        if not isinstance(fig, dict) or not fig.get("src"):
            return
        for lang in LANGUAGES:
            if not (fig.get("alt") or {}).get(lang):
                problems.append(f"{where}.diagram.alt missing {lang}")
        if root is not None and not (root / fig["src"]).is_file():
            problems.append(f"{where}.diagram -> {fig['src']} does not exist")

    _walk(docs, visit)
    return problems


ALL_CHECKS = (
    blanks_without_todos,
    todos_not_bilingual,
    bad_role_ids,
    roles_without_content,
    layers_out_of_step,
    incomplete_layers,
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
