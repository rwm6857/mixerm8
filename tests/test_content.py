"""The guide's own shape.

Every rule here is implemented in `mixerm8.validate`, because the editor
enforces the same ones live and two copies would drift. The tests stay
split up and named for their reasons: the name is the argument for why the
rule exists, and one test_everything_is_valid would throw that away.
"""

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


def test_every_todo_is_bilingual(docs):
    assert validate.todos_not_bilingual(docs) == []


def test_every_role_has_a_content_file(docs):
    assert validate.station_ids(docs) == ["audio", "media", "livestream", "misc"]
    assert validate.roles_without_content(docs) == []


def test_role_ids_survive_being_put_in_a_url(docs):
    """They end up in a QR code as "#audio/ko", so keep them boring."""
    assert validate.bad_role_ids(docs) == []


def test_a_role_declares_exactly_the_layers_its_file_carries(docs):
    assert validate.layers_out_of_step(docs) == []


def test_every_declared_layer_is_complete_in_both_languages(docs):
    assert validate.incomplete_layers(docs) == []


def test_every_station_introduces_itself_and_answers_questions(docs):
    """The station's front page is the landing view, so it is never empty."""
    assert validate.missing_home_page(docs) == []


def test_the_problem_pages_are_problem_shaped(docs):
    """Titles describe what the volunteer notices, not what the gear is."""
    assert validate.component_shaped_problem_titles(docs) == []


def test_every_level_is_one_the_app_can_colour(docs):
    assert validate.bad_levels(docs) == []


def test_every_guide_is_bilingual(docs):
    assert validate.guides_missing_language(docs) == []


def test_guides_cover_every_mapped_channel_page(docs):
    """A tab the console can report should have something to say about it."""
    assert validate.unguided_channel_pages(docs) == []


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
            for lang in validate.LANGUAGES:
                assert (item.get("where") or {}).get(lang), \
                    f"{role}.equipment[{i}].where missing {lang}"


# ---------------------------------------------------------------------------
# The editor leans on these rules instead of on a test run, so a guide that
# is actually broken has to come back broken.
# ---------------------------------------------------------------------------

def test_the_rules_catch_a_broken_draft():
    broken = {
        "roles": {"roles": [
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
