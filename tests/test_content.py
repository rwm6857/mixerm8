"""The guide's own shape.

Every rule here is implemented in `mixerm8.validate`, because the editor
enforces the same ones live and two copies would drift. The tests stay
split up and named for their reasons: the name is the argument for why the
rule exists, and one test_everything_is_valid would throw that away.
"""

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
                 "faq": [{"q": {"ko": "질문"}, "a": {"ko": "대답"}}]},
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
