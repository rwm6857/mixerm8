"""The guide's own shape.

Every rule here is implemented in `mixerm8.validate`, because the editor
enforces the same ones live and two copies would drift. The tests stay
split up and named for their reasons: the name is the argument for why the
rule exists, and one test_everything_is_valid would throw that away.
"""

import json

import pytest

from mixerm8 import server, validate


@pytest.fixture(scope="module")
def root():
    return server.webroot()


@pytest.fixture(scope="module")
def docs(root):
    return validate.load_documents(root / "data")


def _only_media(doc):
    """One station on its own, so an unrelated rule cannot answer for it."""
    return {"roles": {"roles": [{"id": "media"}]}, "media": doc}


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


def test_every_page_has_a_name_a_kind_and_a_working_next(docs):
    assert validate.bad_pages(docs) == []


def test_every_page_is_complete_in_both_languages(docs):
    assert validate.incomplete_items(docs) == []


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
# Pages. A station's tabs are its `pages`, in the order they are written and
# under whatever names they are given. The one invariant is that home is not
# among them: it is what a QR sticker lands on, so it cannot be reordered
# away, hidden or deleted.
# ---------------------------------------------------------------------------

def test_the_shipped_stations_have_the_pages_they_used_to(docs):
    assert [p["id"] for p in docs["audio"]["pages"]] == \
        ["before", "problems", "order", "mixer"]
    for role in ("media", "livestream"):
        assert [p["id"] for p in docs[role]["pages"]] == \
            ["before", "problems", "order", "equipment"]
    assert docs["misc"]["pages"] == []


def test_home_is_not_a_page_and_so_cannot_be_removed(docs):
    for rid in validate.station_ids(docs):
        assert "home" not in [p["id"] for p in validate.pages(docs[rid])]
        assert docs[rid]["intro"], f"{rid} has no front page"


def test_an_empty_page_hides_itself_instead_of_breaking_the_guide():
    """The rule that used to make adding a page impossible.

    Declaring a layer with no content was an error, which was right about
    the tablet -- a tab onto nothing is worse than no tab -- and wrong about
    the editor, where the only way to build a page is to make an empty one
    first. The guarantee now lives in visible_pages() instead, so a
    half-built page is invisible rather than invalid.
    """
    doc = {"intro": {"en": "x", "ko": "x"}, "faq": [{"q": {"en": "x", "ko": "x"},
                                                    "a": {"en": "x", "ko": "x"}}],
           "pages": [{"id": "gear", "kind": "equipment",
                      "label": {"en": "Equipment", "ko": "장비"}, "items": []}]}
    docs = {"roles": {"roles": [{"id": "audio"}]}, "audio": doc}

    assert validate.check(docs) == []                    # not an error
    assert validate.visible_pages(doc) == []             # and not a tab either

    doc["pages"][0]["items"] = [{"title": {"en": "A box", "ko": "상자"},
                                 "where": {"en": "there", "ko": "저기"},
                                 "body": {"en": "does a thing", "ko": "일을 합니다"}}]
    assert len(validate.visible_pages(doc)) == 1         # filled in, so shown


def test_a_hidden_page_keeps_its_content_but_loses_its_tab(docs):
    doc = json.loads(json.dumps(docs["media"]))
    assert len(validate.visible_pages(doc)) == 4
    doc["pages"][3]["hidden"] = True
    assert len(validate.visible_pages(doc)) == 3
    assert doc["pages"][3]["items"], "hiding must not throw the content away"
    assert validate.check(_only_media(doc)) == []


def test_a_next_button_cannot_point_at_nothing(docs):
    """A dead end is worse than no button at all."""
    doc = json.loads(json.dumps(docs["media"]))
    doc["pages"][0]["next"] = "nowhere"
    reported = " ".join(validate.bad_pages(_only_media(doc)))
    assert "points at 'nowhere'" in reported

    doc["pages"][0]["next"] = doc["pages"][0]["id"]
    assert "points at itself" in " ".join(
        validate.bad_pages(_only_media(doc)))


def test_two_pages_of_the_same_kind_are_allowed(docs):
    """Nothing about a checklist says there may only be one of them."""
    doc = json.loads(json.dumps(docs["media"]))
    second = json.loads(json.dumps(doc["pages"][0]))
    second["id"] = "after"
    second["label"] = {"en": "After", "ko": "예배 후"}
    doc["pages"].append(second)
    assert validate.check(_only_media(doc)) == []
    assert len(validate.visible_pages(doc)) == 5


def test_two_pages_may_not_share_an_id(docs):
    doc = json.loads(json.dumps(docs["media"]))
    doc["pages"].append(json.loads(json.dumps(doc["pages"][0])))
    assert "is used twice" in " ".join(
        validate.bad_pages(_only_media(doc)))


# ---------------------------------------------------------------------------
# Equipment. The stations without a console needed somewhere to say what the
# gear in front of the volunteer actually is. Audio does not carry one: its
# Mixer page already does that job.
# ---------------------------------------------------------------------------

def _page(docs, role, pid):
    return next(p for p in docs[role]["pages"] if p["id"] == pid)


def test_the_console_free_working_stations_have_an_equipment_page(docs):
    for role in ("media", "livestream"):
        assert _page(docs, role, "equipment")["items"]


def test_audio_has_a_mixer_page_rather_than_an_equipment_one(docs):
    kinds = [p["kind"] for p in docs["audio"]["pages"]]
    assert "mixer" in kinds and "equipment" not in kinds


def test_every_piece_of_equipment_says_where_it_is(docs):
    """"Where is it" is the first thing a new volunteer asks about a box.

    A blank is a fine answer -- it says nobody has written it down, which
    is true -- but silence is not, so `where` is a required field of the
    kind rather than an optional one.
    """
    assert "where" in validate.KINDS["equipment"]
    for role in ("media", "livestream"):
        for i, item in enumerate(_page(docs, role, "equipment")["items"]):
            for lang in validate.LANGUAGES:
                assert (item.get("where") or {}).get(lang), \
                    f"{role}.equipment[{i}].where missing {lang}"


# ---------------------------------------------------------------------------
# The editor leans on these rules instead of on a test run, so a guide that
# is actually broken has to come back broken.
# ---------------------------------------------------------------------------

def test_the_rules_catch_a_broken_draft():
    broken = {
        "roles": {"roles": [{"id": "Slides"}, {"id": "media"}]},
        "media": {
            "intro": {"en": "hi"},
            "faq": [],
            "pages": [
                {"id": "Before", "kind": "checklist", "label": {"en": "Before"},
                 "items": [{"text": {"en": "open ____"}}]},
                {"id": "problems", "kind": "wishes", "next": "nowhere",
                 "label": {"en": "Problems", "ko": "문제 해결"},
                 "items": [{"title": {"en": "Gate"}, "symptom": {"en": "x"},
                            "steps": [{"en": "x", "ko": "x"}], "level": "urgent"}]},
            ],
        },
    }
    reported = " ".join(validate.check(broken))
    assert "not url-safe" in reported                    # role id, and page id
    assert "blank with no 'todo'" in reported            # unexplained ____
    assert "kind 'wishes'" in reported                   # nothing can draw it
    assert "points at 'nowhere'" in reported             # dead-end Next button
    assert "label missing ko" in reported                # half-translated
    assert "level 'urgent'" in reported                  # unknown severity
    assert "media.intro missing ko" in reported
    assert "no questions on its front page" in reported


def test_a_problem_title_is_still_checked_inside_a_page():
    docs = {
        "roles": {"roles": [{"id": "media"}]},
        "media": {"intro": {"en": "x", "ko": "x"},
                  "faq": [{"q": {"en": "x", "ko": "x"}, "a": {"en": "x", "ko": "x"}}],
                  "pages": [{"id": "problems", "kind": "problems",
                             "label": {"en": "Problems", "ko": "문제"},
                             "items": [{"title": {"en": "Gate", "ko": "게이트"},
                                        "symptom": {"en": "x", "ko": "x"},
                                        "steps": [{"en": "x", "ko": "x"}]}]}]},
    }
    assert "component, not a symptom" in \
        " ".join(validate.component_shaped_problem_titles(docs))
