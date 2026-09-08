"""The guide's own shape.

Every rule here is implemented in `mixerm8.validate`, because the editor
enforces the same ones live and two copies would drift. The tests stay
split up and named for their reasons: the name is the argument for why the
rule exists, and one test_everything_is_valid would throw that away.
"""

import json
import re

import pytest

from mixerm8 import server, validate


@pytest.fixture(scope="module")
def root():
    return server.webroot()


@pytest.fixture(scope="module")
def docs(root):
    return validate.load_documents(root / "data")


def test_the_webroot_carries_every_guide_file(docs):
    assert set(docs) == set(validate.DOCUMENTS)


def test_a_blank_is_never_silent(docs):
    """A "____" always has a `todo` at or above it saying what is missing.

    The reason is concrete: the flow used to instruct volunteers to load
    "the Sunday scene", which nobody had confirmed exists, and loading the
    wrong scene resets every fader mid-service.
    """
    assert validate.blanks_without_todos(docs) == []


def test_every_todo_is_written_in_every_declared_language(docs):
    """A `todo` names what nobody has established yet, so it is the last
    thing that should be readable in only some of the languages offered."""
    assert validate.todos_missing_a_language(docs) == []


# ---------------------------------------------------------------------------
# Languages. Which ones exist is content: roles.json declares them, the app
# builds its header from that list, and every rule above asks the list
# rather than assuming English and Korean. So the list itself is checked,
# and so is what happens when it changes.
# ---------------------------------------------------------------------------

def test_the_shipped_guide_declares_the_two_languages_it_is_written_in(docs):
    assert validate.languages(docs) == ("en", "ko")


def test_the_declared_languages_are_url_safe_and_named(docs):
    """A code goes in a QR sticker as "#audio/ko" and is the key every block
    in every file is written under, so a typo is not one bad sticker -- it
    is a language the whole guide claims to be in and never is."""
    assert validate.bad_language_ids(docs) == []


def test_the_apps_own_wording_is_written_in_every_declared_language(docs):
    """The tab names and the connection messages are content for one reason:
    a station added in a third language would otherwise read half in that
    language and half in English, with nothing to say so."""
    assert validate.app_wording_missing_a_language(docs) == []


def test_a_guide_in_one_language_needs_only_that_one():
    """Nothing assumes two. A church running English alone passes, and so
    does one running Korean alone with no English in the files at all."""
    korean_only = {
        "roles": {"languages": ["ko"],
                  "roles": [{"id": "misc", "layers": []}]},
        "misc": {"intro": {"ko": "안녕하세요"},
                 "faq": [{"id": "jilmun", "q": {"ko": "질문"},
                          "a": {"ko": "대답"}}]},
    }
    assert validate.languages(korean_only) == ("ko",)
    assert validate.check(korean_only) == []


def test_a_guide_that_declares_nothing_is_read_as_english():
    """The fallback is one language rather than two: a file that has said
    nothing about its languages has said nothing about Korean either."""
    assert validate.languages({}) == ("en",)
    assert validate.languages({"roles": {}}) == ("en",)


def test_adding_a_language_reports_every_gap_it_opens(docs):
    """What a media director sees the moment they add one in the editor.

    Not noise: it is the translation job, itemised, and it is why the
    editor's problems bar counts them and stops listing at forty. A
    language that reported nothing until somebody went looking would ship
    a tablet that reads half in one language and half in another.
    """
    added = {**docs, "roles": {**docs["roles"],
                               "languages": [*docs["roles"]["languages"],
                                             {"id": "es", "label": "Español"}]}}
    gaps = validate.check(added)
    assert gaps, "declaring a language nothing is written in reported nothing"
    assert all(g.endswith("missing es") for g in gaps), \
        "declaring a language broke something other than translation"
    # Every layer, the home pages, the screen guides and the app's own
    # wording -- one list, so none of them can be quietly left out.
    assert any(g.startswith("ui.strings.") for g in gaps)
    assert any(g.startswith("audio.checklist") for g in gaps)
    assert any(g.startswith("media.equipment") for g in gaps)
    assert any(g.startswith("misc.faq") for g in gaps)
    assert any(g.startswith("guides.pages") for g in gaps)


def test_the_app_and_its_wording_file_name_the_same_strings(root):
    """ui.json is only useful if app.js asks for exactly what is in it.

    Moving the app's own words out of app.js bought a translatable guide
    and one new way to be wrong: `t1("tabHme")` renders an empty string,
    which on a tab is a button with no label and nothing anywhere to say
    why. So the two lists are compared, in both directions -- a string
    nothing displays is a string somebody is asked to translate for
    nothing, which on a 60-string file is worth catching.
    """
    app = (root / "app.js").read_text("utf-8")
    carried = set(validate.load_documents(root / "data")["ui"]["strings"])

    # FAILED_UI is the deliberate exception: four English sentences that
    # say the guide did not load, which is the one moment ui.json cannot
    # be trusted to be there. They are app-only by design.
    block = re.search(r"const FAILED_UI = \{(.*?)\n\};", app, re.S).group(1)
    fallback = set(re.findall(r"^\s*(\w+):", block, re.M))
    assert fallback, "FAILED_UI was not found; this test is checking nothing"

    asked = set(re.findall(r"""\b(?:t1|u)\(\s*["'](\w+)["']""", app))
    assert asked - carried - fallback == set(), \
        "app.js asks for wording that is in neither ui.json nor FAILED_UI"

    # The severity badges are reached through a level -> key table rather
    # than by name, so they are matched as bare literals instead.
    used = {key for key in carried if f'"{key}"' in app}
    assert carried - used == set(), "ui.json carries wording nothing displays"


def test_a_language_list_the_app_could_not_use_is_caught():
    for bad, expect in [
        ([{"id": "en"}, {"id": "en"}], "twice"),
        ([{"id": "e n"}], "not a language code"),
        ([{"id": "ko", "label": ""}], "no name"),
        ([{"id": "en"}, 7], "neither a language code"),
        ([], "empty language list"),
    ]:
        reported = " ".join(validate.bad_language_ids({"roles": {"languages": bad}}))
        assert expect in reported, f"{bad!r} was reported as {reported!r}"


# ---------------------------------------------------------------------------
# Addresses. Everything used to be found by its position in a list, which
# is not an address: it changes when the thing above it moves. Ids exist so
# that a link has somewhere to point and a volunteer's tick stays on the
# step they ticked.
# ---------------------------------------------------------------------------

def test_every_entry_has_an_id(docs):
    """Position is not an address.

    The concrete cost was in the app: ticks were stored as `done: [0, 2, 5]`,
    so reordering a checklist -- one drag in the editor -- moved a
    volunteer's ticks onto different steps without anything saying so.
    """
    assert validate.entries_without_ids(docs) == []


def test_ids_survive_being_put_in_a_link(docs):
    assert validate.bad_entry_ids(docs) == []


def test_no_two_entries_in_a_section_claim_one_id(docs):
    """One would take every link meant for the other, silently."""
    assert validate.entry_ids_claimed_twice(docs) == []


def test_an_id_is_not_regenerated_from_the_wording():
    """Renaming a heading must not break a link to it.

    So the id is slugged from the wording once, when the entry is made, and
    never again -- which is why it is a field in the file rather than
    something the app works out on the way past.
    """
    seen = {e["id"] for e in validate.load_documents(server.webroot() / "data")
            ["audio"]["problems"]}
    assert "a-squeal-or-a-howl" in seen


def test_every_link_in_the_guide_goes_somewhere(docs):
    """A "see also" pointing at a renamed entry reads as an answer and goes
    nowhere, which is worse than not offering one."""
    assert validate.dead_links(docs) == []


def test_the_shipped_guide_actually_uses_links_and_emphasis(docs):
    """Otherwise the two checks above are guarding a feature nothing has.

    The example is what a church copies, so it shows the conventions in
    use rather than describing them in a comment somewhere.
    """
    links = list(validate._link_targets(docs))
    assert links, "no wording links anywhere, so dead_links proves nothing"
    assert any(target.count("/") == 2 for _, _, target in links), \
        "no link reaches a particular entry"
    assert any("**" in (e.get("detail") or {}).get("en", "")
               for e in docs["audio"]["flow"]), "no emphasis in the example"


def test_a_link_a_tablet_could_not_follow_is_caught(docs):
    """Every way one can be wrong, in one place, because a dead link is
    invisible until somebody taps it mid-service."""
    broken = json.loads(json.dumps(docs))
    broken["audio"]["faq"][0]["a"]["en"] = (
        "[gone](audio/problems/no-such-entry) [no tab](audio/nonsense) "
        "[no station](nowhere/faq) [too deep](audio/faq/a/b) "
        "[a script](javascript:alert(1)) "
        "[fine](https://example.org) [also fine](media/equipment)")
    reported = " ".join(validate.dead_links(broken))
    for expect in ("nothing there has that id", "not a tab that station has",
                   "does not exist", "deeper than station/tab/entry",
                   "not a link a tablet would open"):
        assert expect in reported, f"{expect!r} was not reported"
    assert "example.org" not in reported, "an ordinary web link was rejected"
    assert "media/equipment" not in reported, "a good internal link was rejected"


# ---------------------------------------------------------------------------
# Blocks. An entry's fixed fields say what it always has to say; blocks are
# everything after that, in whatever order somebody put them. Additive on
# purpose -- a file with no `blocks` is a file that has not changed -- so
# these rules are about what a block must be, not about replacing anything.
# ---------------------------------------------------------------------------

def test_the_shipped_guide_uses_every_block_type(docs):
    """Otherwise the rules below guard shapes nothing has.

    The example is what a church copies, so it shows a page assembled out
    of all of them -- including a diagram inside a collapsible step, which
    is the case the nesting exists for.
    """
    kinds = {b.get("type") for _, b, _ in validate._blocks_in(docs)
             if isinstance(b, dict)}
    assert kinds == set(validate.BLOCKS), \
        f"never rendered by the example: {set(validate.BLOCKS) - kinds}"
    assert any(depth and b.get("type") == "media"
               for _, b, depth in validate._blocks_in(docs)
               if isinstance(b, dict)), "no media inside a step"


def test_every_block_is_one_the_app_renders(docs):
    """A type app.js has never heard of renders as nothing at all, which is
    the worst way to be wrong: the file carries it, the editor shows it,
    and the tablet is simply missing a paragraph."""
    assert validate.unknown_block_types(docs) == []


def test_every_block_is_complete_in_every_declared_language(docs):
    assert validate.incomplete_blocks(docs) == []


def test_collapsible_steps_do_not_nest(docs):
    """One level is a step with a diagram in it. Two is a volunteer opening
    a card to find another card, mid-service."""
    assert validate.steps_nested_too_deep(docs) == []


def test_every_tickable_item_has_an_id_unique_to_its_station(docs):
    """The ticks are one flat set per station, keyed by id, so two items
    sharing one anywhere in the file would tick together."""
    assert validate.block_items_without_ids(docs) == []


def test_every_media_block_says_what_it_is(docs, root):
    assert validate.broken_media(docs, root) == []


def test_a_media_block_can_point_at_the_booth_machine(docs):
    """A church's own video lives outside the repo and is not here to check.

    Which is the point: `media/...` is served off the booth machine by the
    bridge, so the rules cannot resolve it and must not pretend to. What
    they can still insist on is a name that says whether it is a picture or
    a video, because the app decides which tag to write from the suffix.
    """
    assert any(b.get("src", "").startswith("media/")
               for _, b, _ in validate._blocks_in(docs)
               if isinstance(b, dict) and b.get("type") == "media"), \
        "the example never shows a church supplying its own media"


def test_the_ways_a_block_can_be_wrong_are_caught():
    broken = {
        "roles": {"languages": ["en"],
                  "roles": [{"id": "misc", "layers": ["pages"]}]},
        "misc": {
            "intro": {"en": "x"},
            "faq": [{"id": "q", "q": {"en": "x"}, "a": {"en": "x"}}],
            "pages": [{"id": "p", "title": {"en": "A page"}, "blocks": [
                {"type": "interpretive-dance"},
                {"type": "text"},
                {"type": "media", "src": "notes.txt"},
                {"type": "media"},
                {"type": "checklist", "items": [{"text": {"en": "x"}}]},
                {"type": "steps", "items": [
                    {"id": "s", "title": {"en": "x"}, "blocks": [
                        {"type": "steps", "items": [
                            {"id": "s2", "title": {"en": "x"}}]},
                    ]},
                ]},
            ]}],
        },
    }
    reported = " ".join(validate.check(broken))
    for expect in ("interpretive-dance", "text block with no text",
                   "says nothing about what it is", "media block with no src",
                   "has no id, so a tick on it moves",
                   "one card too many to open"):
        assert expect in reported, f"{expect!r} was not reported"


def test_a_page_is_its_blocks():
    """A heading is the only field a page must have, so this is the rule
    that keeps the freedom from being a way to publish a blank."""
    empty = {
        "roles": {"languages": ["en"],
                  "roles": [{"id": "misc", "layers": ["pages"]}]},
        "misc": {"intro": {"en": "x"},
                 "faq": [{"id": "q", "q": {"en": "x"}, "a": {"en": "x"}}],
                 "pages": [{"id": "p", "title": {"en": "A heading"}}]},
    }
    assert "has a heading and nothing on it" in " ".join(
        validate.pages_with_nothing_on_them(empty))


def test_every_role_has_a_content_file(docs):
    assert validate.station_ids(docs) == ["audio", "media", "livestream", "misc"]
    assert validate.roles_without_content(docs) == []


def test_role_ids_survive_being_put_in_a_url(docs):
    """They end up in a QR code as "#audio/ko", so keep them boring."""
    assert validate.bad_role_ids(docs) == []


def test_a_role_declares_exactly_the_layers_its_file_carries(docs):
    assert validate.layers_out_of_step(docs) == []


def test_every_declared_layer_is_complete_in_every_declared_language(docs):
    assert validate.incomplete_layers(docs) == []


def test_every_station_introduces_itself_and_answers_questions(docs):
    """The station's front page is the landing view, so it is never empty."""
    assert validate.missing_home_page(docs) == []


def test_the_problem_pages_are_problem_shaped(docs):
    """Titles describe what the volunteer notices, not what the gear is."""
    assert validate.component_shaped_problem_titles(docs) == []


def test_every_level_is_one_the_app_can_colour(docs):
    assert validate.bad_levels(docs) == []


def test_every_guide_is_written_in_every_declared_language(docs):
    assert validate.guides_missing_language(docs) == []


def test_every_screen_guide_carries_the_number_the_desk_reports(docs):
    """The number is the join. Python no longer holds a table of them, so a
    guide without one is a page the desk can never bring up."""
    assert validate.guides_without_a_number(docs) == []


def test_no_two_guides_claim_the_same_number(docs):
    """One would silently win and the other would be dead content."""
    assert validate.numbers_claimed_twice(docs) == []


def test_the_channel_screen_has_no_guide_of_its_own(docs):
    """On screen 0 the channel tab decides what shows, so a screens entry
    numbered 0 could never appear."""
    assert validate.channel_screen_guided_as_a_screen(docs) == []


def test_every_diagram_points_at_a_file_that_ships(docs, root):
    """A diagram is optional, but a broken one is a broken image on a tablet."""
    assert validate.broken_diagrams(docs, root) == []


def test_a_shipped_guide_reports_nothing(docs, root):
    """What the editor's own check runs. Shipping red would be odd."""
    assert validate.check(docs, root) == []


# ---------------------------------------------------------------------------
# Equipment. The stations without a console needed somewhere to say what the
# gear in front of the volunteer actually is. Audio already had one, in the
# shape of the Mixer tab, which is why it declares no equipment layer.
# ---------------------------------------------------------------------------

def test_the_console_free_working_stations_have_an_equipment_page(docs):
    for role in ("media", "livestream"):
        assert docs[role].get("equipment"), f"{role} lists no equipment"


def test_audio_has_no_equipment_layer(docs):
    """Its Mixer tab is the equipment page, and six tabs is two too many."""
    for role in validate.roles(docs):
        if role["id"] == "audio":
            assert "equipment" not in role["layers"]
    assert "equipment" not in docs["audio"]


def test_every_piece_of_equipment_says_where_it_is(docs):
    """"Where is it" is the first thing a new volunteer asks about a box.

    A blank is a fine answer -- it says nobody has written it down, which
    is true -- but silence is not, so `where` is a required field of the
    layer rather than an optional one.
    """
    assert "where" in validate.LAYERS["equipment"]
    for role in ("media", "livestream"):
        for i, item in enumerate(docs[role]["equipment"]):
            for lang in validate.languages(docs):
                assert (item.get("where") or {}).get(lang), \
                    f"{role}.equipment[{i}].where missing {lang}"


# ---------------------------------------------------------------------------
# The editor leans on these rules instead of on a test run, so a guide that
# is actually broken has to come back broken.
# ---------------------------------------------------------------------------

def test_the_rules_catch_a_broken_draft():
    broken = {
        # Declared, because half-translated is only a failure against a
        # language the guide claims to be written in. A draft that declares
        # English alone is not missing Korean; it just does not offer it.
        "roles": {"languages": ["en", "ko"],
                  "roles": [
                      {"id": "Slides", "layers": []},
                      {"id": "media", "layers": ["checklist", "problems", "flow"]},
                  ]},
        "media": {
            "intro": {"en": "hi"},
            "faq": [],
            "checklist": [{"text": {"en": "open ____"}}],
            "problems": [{"title": {"en": "Gate"}, "symptom": {"en": "x"},
                          "steps": [{"en": "x", "ko": "x"}], "level": "urgent"}],
            "flow": [],
            "equipment": [{"title": {"en": "A box", "ko": "상자"}}],
        },
    }
    reported = " ".join(validate.check(broken))
    assert "not url-safe" in reported                    # role id
    assert "blank with no 'todo'" in reported            # unexplained ____
    assert "component, not a symptom" in reported        # problem title
    assert "declares flow but has none" in reported      # empty declared layer
    assert "does not declare" in reported                # undeclared equipment
    assert "level 'urgent'" in reported                  # unknown severity
    assert "media.intro missing ko" in reported          # half-translated
    assert "no questions on its front page" in reported  # empty home page
