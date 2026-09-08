/* MixerM8 — the guide editor.
 *
 * Three columns: everything in the guide, the thing you are editing, and the
 * real tablet app showing it. The preview is not a mock-up. It is docs/ served
 * from the same files the bridge serves, reading the unsaved draft, so what
 * you are looking at is what the volunteer will see.
 *
 * The forms are generated from SECTIONS below rather than written out, for the
 * same reason the app has no build step: the content is regular -- almost
 * everything is a block of one string per language -- and a form per field
 * would be five hundred lines that drift the first time the shape changes.
 *
 * LANGUAGES. How many columns a text field has is not fixed here either. It
 * comes from `languages` in the draft's own roles.json, which is edited in
 * this editor like anything else, so adding a language grows every form on
 * the next keystroke and the problems bar immediately lists what that
 * language is now missing. That list is the translation job, in order.
 *
 * Nothing here knows the rules a guide has to obey. The server runs
 * mixerm8.validate, which is the same module the test suite runs, so the
 * problems bar at the bottom says exactly what CI would say.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const BLANK = /_{4,}/;

/* ---------- icons ----------
 * Chrome, in the code, the same way ICONS is in app.js. A word earns its
 * place on a button that appears once and says something specific -- Save,
 * or which of the two places a save goes. It does not earn its place on the
 * nineteen add buttons in the tree, or on a Remove sitting under a field
 * whose own label already says what it is.
 *
 * Every icon-only button carries a title and an aria-label, because a
 * trashcan is only obvious to somebody who can see it. */
const ICONS = {
  plus:  '<path d="M12 5.5v13M5.5 12h13"/>',
  trash: '<path d="M3.5 6.5h17M9 6.5V4h6v2.5"/>' +
         '<path d="M5.8 6.5l.9 13a1.6 1.6 0 0 0 1.6 1.5h7.4a1.6 1.6 0 0 0 1.6-1.5l.9-13"/>' +
         '<path d="M10 10.5v7M14 10.5v7"/>',
  up:    '<path d="M5.5 14.5l6.5-6.5 6.5 6.5"/>',
  down:  '<path d="M5.5 9.5l6.5 6.5 6.5-6.5"/>',
  reload: '<path d="M20.5 12a8.5 8.5 0 1 1-2.7-6.2"/><path d="M20.5 4v5.5H15"/>',
  undo:  '<path d="M3.5 8.5h10a5.5 5.5 0 1 1 0 11H8"/><path d="M7 5 3.5 8.5 7 12"/>',
  bold:  '<path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7zM7 12h6.5a3.5 3.5 0 0 1 0 7H7z" ' +
         'stroke-width="2"/>',
  italic: '<path d="M15.5 5h-4M12.5 19h-4M14.5 5l-3 14"/>',
  linkin: '<path d="M9.5 14.5l5-5"/>' +
          '<path d="M12 7l1.8-1.8a3.9 3.9 0 0 1 5.5 5.5L17.5 12.5"/>' +
          '<path d="M12 17l-1.8 1.8a3.9 3.9 0 0 1-5.5-5.5L6.5 11.5"/>',
  grip:  '<g fill="currentColor" stroke="none">' +
         '<circle cx="9.5" cy="6" r="1.15"/><circle cx="14.5" cy="6" r="1.15"/>' +
         '<circle cx="9.5" cy="12" r="1.15"/><circle cx="14.5" cy="12" r="1.15"/>' +
         '<circle cx="9.5" cy="18" r="1.15"/><circle cx="14.5" cy="18" r="1.15"/></g>',
};

const icon = (name) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
  `aria-hidden="true">${ICONS[name] || ""}</svg>`;

/* An icon-only button. `what` is the whole label a screen reader and a
   hover tooltip get, so it reads as an instruction, not a noun. */
const iconBtn = (name, what, attrs = "", cls = "") =>
  `<button class="btn ico-btn ${cls}" type="button" title="${esc(what)}" ` +
  `aria-label="${esc(what)}" ${attrs}>${icon(name)}</button>`;

/* ---------- languages ----------
 * Read off the draft, so the forms follow an edit to the language list
 * without a reload. The label is only the column tag here: a blank one
 * falls back to the code, and the tablet has its own table of endonyms
 * for that case -- which is why this file carries no such table and
 * cannot drift from it. */

function langs() {
  const out = [];
  for (const item of state.docs.roles?.languages || []) {
    const id = String(typeof item === "string" ? item : item?.id || "").trim();
    if (!id || out.some((l) => l.id === id)) continue;
    out.push({ id, label: (typeof item === "object" && item?.label) || id.toUpperCase() });
  }
  return out.length ? out : [{ id: "en", label: "EN" }];
}

const langIds = () => langs().map((l) => l.id);

/* Is this a block of translated strings?
 *
 * Identified by shape, because the guide has no marker for one: every value
 * is a string, and at least one key is a language this guide declares.
 * That rejects { src, alt, caption } (alt and caption are objects) and
 * { theme, icon } (neither is a language), and it still recognises an
 * { en, ko } block after Korean has been removed from the list, which a
 * plain "every key is declared" test would not.
 *
 * The one shape it could mistake is a language list entry, { id, label } --
 * `id` being Indonesian. Hence the last clause: no block of wording has a
 * field called `label`, because a label is itself a block. */
function isBlock(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  if (!keys.length || "label" in node) return false;
  return keys.every((k) => typeof node[k] === "string") &&
         keys.some((k) => langIds().includes(k));
}

function blockGap(node) {
  if (typeof node === "string") return false;
  if (Array.isArray(node)) return node.some(blockGap);
  if (!node || typeof node !== "object") return false;
  if (isBlock(node)) return langIds().some((l) => !node[l]);
  return Object.values(node).some(blockGap);
}

/* ---------- what a form is made of ---------- */

/* An empty language block. Deliberately `{}` rather than a key per
 * language set to "": an empty string would be written to the file and
 * read as a translation that exists, and the form shows a column per
 * declared language whether or not the key is there yet. */
const bi = () => ({});

const BI = (key, label, extra) => ({ key, label, type: "bi", ...(extra || {}) });

const TODO = BI("todo", "What is still missing", {
  optional: true,
  hint: "An orange note above the text. Required wherever the wording has a ____ blank.",
});

const DIAGRAM = { key: "diagram", label: "Diagram", type: "diagram", optional: true };

const LEVEL = { key: "level", label: "Severity", type: "level" };

/* The number the desk reports for this screen. It is the join between what
 * the console says and which guide comes up, which is why it sits on the
 * entry rather than in a table somewhere -- see console.py. */
const NUMBER = { key: "number", label: "Number the desk reports", type: "number" };

/* An entry's address. Links point at it and a volunteer's ticks are stored
 * against it, so it is stable on purpose: renaming a heading must not
 * break a link to it, which means the id does not follow the heading.
 * Last in the form, because it is the one field that is not wording. */
const ENTRY_ID = { key: "id", label: "Id", type: "text",
                   hint: "How links reach this and how a tick remembers it. " +
                         "Change it now rather than later — anything pointing " +
                         "at the old one stops working." };

const GUIDE_FIELDS = [NUMBER, LEVEL, BI("title", "Title"), TODO,
                      BI("body", "What this screen is"),
                      BI("action", "What to do", { optional: true }), DIAGRAM];

/* ---------- blocks ----------
 *
 * An entry's fixed fields say what it always has to say. Blocks are
 * everything after that, in whatever order somebody puts them -- and this
 * table is the only place in the editor that knows the list, mirroring
 * BLOCKS in app.js and validate.py. Adding a type is an entry in each of
 * those three.
 *
 * A `steps` item's own content is blocks too, which is how a diagram or a
 * video goes inside the step it belongs to. One level deep and no more:
 * `validate.py` refuses steps inside steps, because a volunteer opening a
 * card to find another card mid-service is the opposite of the point.
 */
const MEDIA_SRC = {
  key: "src", label: "File", type: "media",
  hint: "Something in your media folder, a file that ships in docs/, or an " +
        "https address. Videos play on a tap and never on their own.",
};

const BLOCK_TYPES = {
  text: {
    label: "Text", one: "paragraph",
    fields: [BI("text", "Words")],
    blank: () => ({ type: "text", text: bi() }),
  },
  media: {
    label: "Picture or video", one: "picture or video",
    fields: [MEDIA_SRC,
             BI("alt", "What it shows", {
               hint: "Read out to somebody who cannot see it, and shown in " +
                     "its place if the file is missing.",
             }),
             BI("caption", "Caption", { optional: true })],
    blank: () => ({ type: "media", src: "", alt: bi() }),
  },
  callout: {
    label: "Callout", one: "callout",
    fields: [LEVEL, BI("title", "Heading", { optional: true }),
             BI("body", "Words"), TODO],
    blank: () => ({ type: "callout", level: "caution", title: bi(), body: bi() }),
  },
  checklist: {
    label: "Checklist", one: "checklist",
    items: {
      one: "item",
      fields: [TODO, BI("text", "Item"), ENTRY_ID],
      blank: () => ({ text: bi() }),
    },
    blank: () => ({ type: "checklist", items: [] }),
  },
  steps: {
    label: "Collapsible steps", one: "set of steps",
    items: {
      one: "step", nests: true,
      fields: [BI("when", "When", { optional: true }), BI("title", "Step"),
               TODO, ENTRY_ID],
      blank: () => ({ title: bi(), blocks: [] }),
    },
    blank: () => ({ type: "steps", items: [] }),
  },
};

/* Where an entry's free-form content goes. Last in the form, after the
 * fields that entry always has. */
const BLOCKS = { key: "blocks", label: "And then", type: "blocks",
                 hint: "Anything, in any order — words, a picture, a video, " +
                       "a checklist, collapsible steps." };

const SECTIONS = {
  /* The list the whole app is generated from. Adding one here grows every
   * text field in this editor and fills the problems bar with what the new
   * language is missing -- which is the translation job, written down.
   *
   * One page for all of them, and no `Writing in` on it. This is the only
   * section that is not wording somebody translates: it is the setup that
   * decides what the other sections get translated *into*, so a language
   * picker over the top of it would be asking which language to write a
   * language code in. Three codes and three names is also just a short
   * list -- a tree row and a page each was more navigation than content. */
  languages: {
    label: "Languages", kind: "doc", untranslated: true,
    hint: "One button in the tablet's header per language, in this order. " +
          "The first is what an untranslated card falls back to, so keep it " +
          "the one somebody in the booth is sure to read.",
    fields: [{ key: "languages", label: "", type: "langrows" }],
  },
  hero: {
    label: "Front cover", kind: "sub", at: "hero",
    hint: "The panel above the station picker — the first thing on the tablet.",
    fields: [{ key: "image", label: "Picture", type: "text",
               hint: "Relative to docs/, e.g. img/hero.jpg. Optional; the " +
                     "gradient behind it is the design, not a placeholder." },
             BI("title", "Title"), BI("blurb", "Opening words")],
  },
  /* The app's own furniture: tab names, badges, the status pill, the
   * connection messages. Content rather than code so that a guide in a
   * third language is not half in English -- see data/ui.json. */
  strings: {
    label: "App wording", kind: "strings", at: "strings",
    hint: "Every word the app says for itself. {n}, {ip} and {list} are " +
          "filled in by the app — keep them in the sentence.",
  },
  home: {
    label: "Front page", kind: "doc",
    fields: [BI("intro", "Introduction", {
      hint: "The first thing somebody sees when they scan the sticker.",
    }), DIAGRAM, BLOCKS],
  },
  faq: {
    label: "Questions", kind: "list", title: (e) => e.q, one: "question", identified: true,
    fields: [BI("q", "Question"), TODO, BI("a", "Answer"), DIAGRAM, BLOCKS,
             ENTRY_ID],
    blank: () => ({ q: bi(), a: bi() }),
  },
  checklist: {
    label: "Before", kind: "list", title: (e) => e.text, one: "step", identified: true,
    fields: [TODO, BI("text", "Step"), ENTRY_ID],
    blank: () => ({ text: bi() }),
  },
  problems: {
    label: "Problems", kind: "list", title: (e) => e.title, one: "problem page", identified: true,
    fields: [LEVEL,
             BI("title", "Title", {
               hint: "A symptom in the volunteer's words — \"Someone is too quiet\", " +
                     "never \"Gate\". Three words or more.",
             }),
             BI("symptom", "What they are seeing or hearing"),
             TODO,
             { key: "steps", label: "Steps", type: "bi-list" },
             DIAGRAM, BLOCKS, ENTRY_ID],
    blank: () => ({ level: "caution", title: bi(), symptom: bi(), steps: [bi()] }),
  },
  flow: {
    label: "Order", kind: "list", title: (e) => e.title, one: "step", identified: true,
    fields: [BI("when", "When", { hint: "\"45 min before\", \"During\", \"After\"." }),
             BI("title", "Step"), TODO, BI("detail", "Detail"), DIAGRAM,
             BLOCKS, ENTRY_ID],
    blank: () => ({ when: bi(), title: bi(), detail: bi() }),
  },
  equipment: {
    label: "Equipment", kind: "list", title: (e) => e.title, one: "piece of gear", identified: true,
    fields: [LEVEL, BI("title", "Name"),
             BI("where", "Where it is", {
               hint: "A blank is a fine answer — it says nobody has written it down. " +
                     "Silence is not, so this one is never empty.",
             }),
             TODO, BI("body", "What it does"),
             BI("action", "What to do about it", { optional: true }),
             DIAGRAM, BLOCKS, ENTRY_ID],
    blank: () => ({ level: "info", title: bi(), where: bi(), body: bi() }),
  },
  training: {
    label: "Training", kind: "list", one: "page", identified: true,
    at: "pages", title: (e) => e.title,
    hint: "The free-form layer: walkthroughs and background reading. " +
          "Nothing here is needed to get through a Sunday, which is why a " +
          "page insists on nothing but a heading.",
    fields: [BI("title", "Heading"),
             BI("blurb", "One line for the tile", { optional: true }),
             TODO, BLOCKS, ENTRY_ID],
    blank: () => ({ title: bi(), blocks: [] }),
  },
  pages: {
    label: "Channel tabs", kind: "map", fields: GUIDE_FIELDS, one: "tab guide",
    hint: "The number the desk reports for this tab. Record them all with " +
          "`mixerm8 --learn`, or press the tab at the desk and read the " +
          "number off the tablet.",
    blank: () => ({ level: "info", title: bi(), body: bi() }),
  },
  screens: {
    label: "Main screens", kind: "map", fields: GUIDE_FIELDS, one: "screen guide",
    hint: "The number the desk reports for this screen.",
    blank: () => ({ level: "info", title: bi(), body: bi() }),
  },
  roles: {
    label: "Stations", kind: "list", one: "station",
    title: (e) => ({ [langIds()[0]]: e.id }),
    fields: [{ key: "id", label: "Id", type: "text",
               hint: "Ends up in a QR code as #audio/ko, so lowercase and boring." },
             BI("label", "Name"), BI("where", "Where the volunteer stands"),
             { key: "theme", label: "Palette", type: "text" },
             { key: "icon", label: "Icon", type: "text" },
             { key: "console", label: "Follows the mixer", type: "bool" },
             { key: "layers", label: "Tabs this station gets", type: "layers" }],
    blank: () => ({ id: "", label: bi(), where: bi(), theme: "slate",
                    icon: "question", console: false, layers: [] }),
  },
};

// The section for the fifth layer is called `training` in this file, not
// `pages`: `pages` was already taken by the console's channel tabs, and two
// meanings of one word in a table keyed by it is a bug waiting to happen.
// Its `at` names the real key in the file.
const LAYERS = ["checklist", "problems", "flow", "equipment"];
const LEVELS = [["ok", "Safe"], ["caution", "Careful"],
                ["danger", "Do not change"], ["info", "Note"]];

/* How many problems the bar lists before it stops. Declaring a new
 * language opens a gap in every block of every file at once, which is
 * hundreds of lines of true but unreadable list. The count above it is
 * the number that matters; the rest is the same sentence again. */
const PROBLEM_CAP = 40;

/* Which language you are working in.
 *
 * One value, and the preview is the other view of it: the segment in the
 * app's own header and the one in the form are the same control, kept in
 * step in both directions. A column per language was fine at two and
 * unusable at four -- every field became a wrapping grid, and the form got
 * longer in proportion to how many languages the guide offered -- so a
 * field shows one box whether the guide is in two languages or eight.
 * Kept in localStorage because it is a working position, not part of the
 * guide. */
const state = {
  writing: null,      // language id being edited; null until the docs load
  media: { dir: "", files: [] },   // what is in the church's media folder
  gapSeen: null,      // index of the empty box the bar last jumped to
  detail: false,      // is the bar's Details panel open?
  docs: {},
  target: "repo",
  repoAvailable: false,
  dirty: [],
  problems: [],
  willWriteTo: {},
  sel: null,          // { doc, section, id }  id is an index or a map key
};

/* ---------- talking to the editor server ---------- */

async function api(path, method, body) {
  const r = await fetch(path, {
    method: method || "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await r.json();
  if (out.error) throw new Error(out.error);
  return out;
}

function absorb(s) {
  if (s.docs) state.docs = s.docs;
  state.target = s.target;
  state.repoAvailable = s.repoAvailable;
  state.dirty = s.dirty || [];
  state.problems = s.problems || [];
  state.willWriteTo = s.willWriteTo || {};
}

/* Edits go to the server debounced, not on every keystroke: it re-runs the
 * whole rule set on every write, and the preview reload behind it is a full
 * page load. Fast enough at this rhythm, silly at thirty a second. */
let pushTimer = null;
let previewTimer = null;

function touched(docName) {
  clearTimeout(pushTimer);
  clearTimeout(previewTimer);
  pushTimer = setTimeout(async () => {
    absorb(await api("/api/doc/" + docName, "PUT", state.docs[docName]));
    renderChrome();
    renderTree();
  }, 300);
  previewTimer = setTimeout(refreshPreview, 650);
}

/* ---------- the tree ---------- */

/* The tree, as groups of (document, section) rows.
 *
 * A group is not the same thing as a file. The mixer screens live in
 * guides.json but they belong to the station with a console on it: they are
 * that volunteer's screens, and a top-level "Mixer screens" heading put
 * them as far from the sound desk as the guide could manage. So a section
 * names the document it edits, and the sound station's group draws from
 * two files. */
function docsInOrder() {
  const out = [];
  const has = (name) => Boolean(state.docs[name]);
  const row = (doc, section) => ({ doc, section });

  if (has("roles")) {
    out.push({ label: "The guide itself", rows: [
      row("roles", "languages"), row("roles", "hero"), row("roles", "roles"),
    ]});
  }
  if (has("ui")) {
    out.push({ label: "App wording", rows: [row("ui", "strings")] });
  }
  for (const role of state.docs.roles?.roles || []) {
    const doc = state.docs[role.id];
    if (!doc) continue;
    const rows = [row(role.id, "home"), row(role.id, "faq"),
                  ...LAYERS.filter((l) => doc[l]).map((l) => row(role.id, l))];
    if (doc.pages) rows.push(row(role.id, "training"));
    // The console's screens, filed under the station that has the console.
    if (role.console && has("guides")) {
      rows.push(row("guides", "pages"), row("guides", "screens"));
    }
    out.push({ label: labelOf(role.id), rows });
  }
  // A file with no role claiming it would otherwise be unreachable.
  const claimed = new Set(out.flatMap((g) => g.rows.map((r) => r.doc)));
  for (const name of ["guides"]) {
    if (has(name) && !claimed.has(name)) {
      out.push({ label: "Mixer screens",
                 rows: [row(name, "pages"), row(name, "screens")] });
    }
  }
  return out;
}

function labelOf(id) {
  const role = (state.docs.roles?.roles || []).find((r) => r.id === id);
  return role ? (role.label?.en || id) : id;
}

/* The first line of an entry, for the tree and nothing else. Read in the
 * first declared language rather than in English: a guide written only in
 * Korean would otherwise show a tree of "(empty)". */
function summarise(section, entry, key) {
  const spec = SECTIONS[section];
  if (spec.kind === "map") return key;
  const node = spec.title ? spec.title(entry) : null;
  const text = String(langIds().map((l) => node?.[l]).filter(Boolean)[0] || "").trim();
  return text ? text.slice(0, 46) : "(empty)";
}

/* The three kinds that edit one thing rather than a list of them, so they
 * get no count in the tree, no add button and no Delete. */
const SINGLE = ["doc", "sub", "strings"];
const isSingle = (section) => SINGLE.includes(SECTIONS[section].kind);

/* The key in the file that a tree section edits. Usually the section's own
 * name; `at` is for the two that differ -- roles.json's `hero`, and the
 * Training section, whose key is `pages` because the console's channel
 * tabs had already taken that word in this table. */
const keyOf = (section) => SECTIONS[section].at || section;

/* The object a form edits, for one row of the tree.
 *
 * One place, because there were two: the tree listed the whole document
 * for a `sub` section while the form narrowed it to `spec.at`, and the
 * first thing to walk the tree's own list counted roles.json twice and
 * filed half of it under Front cover.
 *
 * A `sub` or `strings` target is created on sight rather than being a
 * section that silently does nothing when the key is absent.
 */
function entryAt(docName, section, id) {
  const spec = SECTIONS[section];
  const doc = state.docs[docName];
  if (!doc) return null;
  if (spec.kind === "doc") return doc;
  if (spec.kind === "sub" || spec.kind === "strings") {
    return (doc[spec.at] = doc[spec.at] || {});
  }
  if (spec.kind === "map") return (doc[keyOf(section)] || {})[id];
  return (doc[keyOf(section)] || [])[id];
}

function entriesOf(docName, section) {
  const doc = state.docs[docName];
  const spec = SECTIONS[section];
  if (isSingle(section)) return [["", entryAt(docName, section, "")]];
  if (spec.kind === "map") return Object.entries(doc[keyOf(section)] || {});
  return (doc[keyOf(section)] || []).map((e, i) => [i, e]);
}

function hasBlank(node) {
  if (typeof node === "string") return BLANK.test(node);
  if (Array.isArray(node)) return node.some(hasBlank);
  if (node && typeof node === "object") return Object.values(node).some(hasBlank);
  return false;
}

/* ---------- the tree ----------
 * Adding an entry and moving one both happen here rather than in the form.
 * They are navigation, not editing: you decide where a step goes by looking
 * at the steps around it, and the form only ever shows one of them. */

function renderTree() {
  const sel = state.sel;
  $("tree").innerHTML = docsInOrder().map((group) => {
    const rows = group.rows.map(({ doc, section }) => {
      const spec = SECTIONS[section];
      const entries = entriesOf(doc, section);
      const open = sel && sel.doc === doc && sel.section === section;
      const single = isSingle(section);

      const head =
        `<div class="sec-row">` +
        `<button class="sec" data-doc="${esc(doc)}" data-section="${esc(section)}">` +
        `<span>${esc(spec.label)}</span>` +
        (single ? "" : `<span class="n">${entries.length}</span>`) +
        `</button>` +
        (single ? "" :
          iconBtn("plus", `Add another ${spec.one}`,
                  `data-doc="${esc(doc)}" data-section="${esc(section)}"`, "add")) +
        `</div>`;

      if (single || !open) return head;

      const items = entries.map(([id, entry]) =>
        // Draggable rather than a pair of arrows: the order of these is the
        // order a volunteer reads them in, and dragging is how you say
        // "third, after that one" in one gesture instead of three presses.
        `<button class="item" draggable="true" data-doc="${esc(doc)}" ` +
        `data-section="${esc(section)}" data-id="${esc(id)}" ` +
        `aria-current="${String(sel.id) === String(id)}">` +
        `<span class="grip">${icon("grip")}</span>` +
        // Two flags, because they mean different things: a "____" is a fact
        // nobody has established, and a gap is a sentence nobody has
        // translated yet.
        (hasBlank(entry) ? `<span class="flag">•</span>` : "") +
        (blockGap(entry) ? `<span class="flag gap">◦</span>` : "") +
        `<span class="what">${esc(summarise(section, entry, id))}</span>` +
        `</button>`).join("");
      return head + `<div class="items">${items}</div>`;
    }).join("");
    return `<div class="doc">${esc(group.label)}</div>${rows}`;
  }).join("");

  $("tree").querySelectorAll(".sec").forEach((el) => {
    el.onclick = () => {
      const { doc, section } = el.dataset;
      const entries = entriesOf(doc, section);
      select(doc, section, isSingle(section) ? "" : (entries[0] ? entries[0][0] : null));
    };
  });
  $("tree").querySelectorAll(".add").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      addEntry(el.dataset.doc, el.dataset.section);
    };
  });
  $("tree").querySelectorAll(".item").forEach((el) => {
    el.onclick = () => select(el.dataset.doc, el.dataset.section, el.dataset.id);
  });
  wireDragging();
}

/* Reordering by drag, over the rows of one section.
 *
 * Kept to one section deliberately: dragging a checklist step into the
 * problem pages would be a way to lose it, and the two are not the same
 * kind of thing. A drop marker rather than live shuffling, so nothing
 * moves until you let go and the row you grabbed stays where your eye is.
 */
let dragging = null;

function wireDragging() {
  $("tree").querySelectorAll(".item").forEach((el) => {
    el.ondragstart = (e) => {
      dragging = { ...el.dataset };
      el.classList.add("lifting");
      e.dataTransfer.effectAllowed = "move";
      // Firefox will not start a drag without something on the transfer.
      e.dataTransfer.setData("text/plain", el.dataset.id);
    };
    el.ondragend = () => {
      dragging = null;
      $("tree").querySelectorAll(".item").forEach((o) =>
        o.classList.remove("lifting", "over-before", "over-after"));
    };
    el.ondragover = (e) => {
      if (!sameSection(el)) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      el.classList.toggle("over-before", !after);
      el.classList.toggle("over-after", after);
    };
    el.ondragleave = () => el.classList.remove("over-before", "over-after");
    el.ondrop = (e) => {
      if (!sameSection(el)) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      moveEntry(dragging, el.dataset.id, after);
    };
  });
}

function sameSection(el) {
  return dragging && dragging.doc === el.dataset.doc &&
         dragging.section === el.dataset.section && dragging.id !== el.dataset.id;
}

/* Move `from` to sit before or after `ontoId`.
 *
 * A list is spliced. A map is rebuilt in the new key order rather than
 * reassigned, because for the screen guides the key order *is* the order
 * the tiles appear in on the tablet -- there is no index to sort by. */
function moveEntry(from, ontoId, after) {
  const spec = SECTIONS[from.section];
  const doc = state.docs[from.doc];
  const key = keyOf(from.section);

  if (spec.kind === "map") {
    const keys = Object.keys(doc[key]);
    const rest = keys.filter((k) => k !== from.id);
    const at = rest.indexOf(ontoId) + (after ? 1 : 0);
    rest.splice(at, 0, from.id);
    const rebuilt = {};
    for (const k of rest) rebuilt[k] = doc[key][k];
    doc[key] = rebuilt;
    state.sel = { doc: from.doc, section: from.section, id: from.id };
  } else {
    const list = doc[key];
    const lifted = Number(from.id);
    const onto = Number(ontoId);
    // Where the row we dropped onto sits once the lifted one is out of the
    // list: one lower if it was below the gap that just closed.
    const settled = onto > lifted ? onto - 1 : onto;
    const at = settled + (after ? 1 : 0);
    const moved = list.splice(lifted, 1)[0];
    list.splice(at, 0, moved);
    state.sel = { doc: from.doc, section: from.section, id: at };
  }
  touched(from.doc);
  renderTree();
  renderForm();
}

function select(doc, section, id) {
  const spec = SECTIONS[section];
  if (spec.kind === "list" && id !== null && id !== "") id = Number(id);
  state.sel = { doc, section, id };
  renderTree();
  renderForm();
  refreshPreview();
}

/* ---------- the form ---------- */

function currentEntry() {
  const { doc, section, id } = state.sel || {};
  return SECTIONS[section] ? entryAt(doc, section, id) : null;
}

function renderForm() {
  const box = $("form");
  const sel = state.sel;

  // Renaming or deleting a language can leave the working one pointing at
  // something that is gone. Repaired here rather than guarded at every
  // use, so there is one place the invariant holds.
  const ids = langIds();
  if (!ids.includes(state.writing)) state.writing = ids[0];

  const entry = currentEntry();
  if (!sel || !entry) {
    box.innerHTML = `<p class="empty">Pick something on the left to edit it.</p>`;
    return;
  }
  const spec = SECTIONS[sel.section];
  const single = ["doc", "sub", "strings"].includes(spec.kind);

  let html = `<div class="crumb">${esc(labelOf(sel.doc))} · ${esc(spec.label)}</div>`;
  html += `<h1>${esc(spec.kind === "map" ? sel.id
                    : single ? spec.label
                    : summarise(sel.section, entry, sel.id))}</h1>`;
  if (spec.hint) html += `<p class="field"><span class="hint">${esc(spec.hint)}</span></p>`;

  // Not on a section that is setup rather than wording: a language picker
  // over the language list would be asking which language to write a
  // language code in.
  if (!spec.untranslated) html += langBar();
  // Adding and reordering live in the tree; only the destructive one is
  // here, where you can see the thing you are about to remove.
  if (!single) html += `<div class="rowbar">` +
    iconBtn("trash", `Delete this ${spec.one || "entry"}`,
            `data-op="delete"`, "bad") + `</div>`;
  if (spec.kind === "map") {
    html += field("Key", `<input type="text" data-op="rename" value="${esc(sel.id)}">`);
  }
  // The app's own wording has one field per string it already carries, in
  // file order. No add and no rename on purpose: the keys belong to app.js,
  // and inventing one here would write a line nothing ever reads.
  const fields = spec.kind === "strings"
    ? Object.keys(entry).map((k) => BI(k, k))
    : spec.fields;
  html += fields.map((f) => renderField(f, entry)).join("");

  box.innerHTML = html;
  box.scrollTop = 0;
  wireForm(entry, spec);
  wireLangBar();
}

function wireLangBar() {
  $("form").querySelectorAll("[data-writing]").forEach((el) => {
    el.onclick = () => setWriting(el.dataset.writing);
  });
}

/* Change the language being worked in, from either end.
 *
 * `fromPreview` says the app's own segment was the thing that was pressed,
 * so there is nothing to push back to it -- without that the two would
 * take turns telling each other, which is a loop rather than a sync. */
function setWriting(lang, fromPreview) {
  if (!lang || lang === state.writing || !langIds().includes(lang)) return;
  state.writing = lang;
  remember();
  renderForm();
  renderBar();
  if (!fromPreview) showLangInPreview(lang);
}

function remember() {
  try {
    localStorage.setItem("mixerm8.editor.writing", state.writing);
  } catch { /* private mode; the position just does not survive a reload */ }
}

/* The remembered language, if the guide still offers it. Falls back to the
 * first declared one, which is also what a guide in one language gets. */
function restoreLangs() {
  const ids = langIds();
  let saved = null;
  try { saved = localStorage.getItem("mixerm8.editor.writing"); }
  catch { /* nothing remembered */ }
  state.writing = ids.includes(saved) ? saved : ids[0];
}

/* The one control that decides what every text field below shows -- and
 * what the preview beside it shows, because they are the same value.
 *
 * Hidden when the guide is in one language, for the same reason the tablet
 * hides its own segment: there is nothing to choose. */
function langBar() {
  const all = langs();
  if (all.length < 2) return "";
  return `<div class="langbar"><span class="fname">Writing in</span>` +
    `<div class="seg">` + all.map(({ id, label }) =>
      `<button data-writing="${esc(id)}" aria-pressed="${id === state.writing}">` +
      `${esc(label)}</button>`).join("") + `</div></div>`;
}

function field(label, inner, hint, extra) {
  return `<div class="field ${extra || ""}"><span class="fname">${esc(label)}` +
         (hint ? ` <span class="hint">${esc(hint)}</span>` : "") + `</span>${inner}</div>`;
}

/* One text field, in the language being worked in.
 *
 * The tag turns amber when that language is empty here, so a form full of
 * gaps looks like one at a glance without having to read any of it. */
/* The three things a guide file may ask for inside a sentence. No sizes,
 * no colours and no fonts on purpose: a card's meaning comes from its
 * severity, and wording that could restyle itself is wording that could
 * quietly stop looking like a warning. */
const MARKS = [
  { op: "bold", icon: "bold", wrap: "**", key: "b", what: "Bold (⌘B)" },
  { op: "italic", icon: "italic", wrap: "*", key: "i", what: "Italic (⌘I)" },
  { op: "link", icon: "linkin", key: "k", what: "Link (⌘K)" },
];

function textareas(path, node) {
  const all = langs();
  const write = all.find((l) => l.id === state.writing) || all[0];
  const text = node?.[write.id] || "";
  const box = `${esc(path)}.${write.id}`;
  return `<div class="pair">` +
    `<label class="lang-in${text ? "" : " gap"}">` +
    `<span class="tag" lang="${esc(write.id)}">${esc(write.label)}</span>` +
    `<span class="marks">` + MARKS.map((m) =>
      iconBtn(m.icon, m.what, `data-mark="${m.op}" data-box="${box}"`, "mark")).join("") +
    `</span>` +
    `<textarea data-path="${box}" lang="${esc(write.id)}" ` +
    `class="${BLANK.test(text) ? "has-blank" : ""}">${esc(text)}</textarea></label>` +
    `</div>`;
}

/* ---------- inline formatting ----------
 *
 * Applied to the text in the box rather than through contenteditable, so
 * what is stored is the same handful of marks the tablet renders and
 * nothing else -- no stray spans, no pasted styling, and a diff that shows
 * the sentence somebody changed.
 */

/* Wrap or unwrap the selection. Pressing bold on something already bold
 * takes it off, which is what every editor does and what the muscle
 * memory expects. With nothing selected it inserts the pair and puts the
 * cursor between them, so you can type straight into it. */
function applyMark(el, mark) {
  const { selectionStart: from, selectionEnd: to, value } = el;
  const chosen = value.slice(from, to);

  if (mark.op === "link") {
    const target = prompt(
      "Link to a station, a tab, an entry, or a web address.\n\n" +
      "audio\naudio/problems\naudio/problems/a-squeal-or-a-howl\n" +
      "https://example.org", "");
    if (target === null) return;
    const label = chosen || "link";
    return replaceIn(el, from, to, `[${label}](${target.trim()})`,
                     chosen ? null : [from + 1, from + 1 + label.length]);
  }

  const pad = mark.wrap;
  if (chosen.startsWith(pad) && chosen.endsWith(pad) && chosen.length > pad.length * 2) {
    return replaceIn(el, from, to, chosen.slice(pad.length, -pad.length));
  }
  const wrapped = pad + chosen + pad;
  replaceIn(el, from, to, wrapped,
            chosen ? [from, from + wrapped.length]
                   : [from + pad.length, from + pad.length]);
}

/* One edit, then let the box's own oninput carry it into the draft --
 * there is only one path from a keystroke to the file and this uses it. */
function replaceIn(el, from, to, text, select) {
  el.value = el.value.slice(0, from) + text + el.value.slice(to);
  const [a, b] = select || [from + text.length, from + text.length];
  el.setSelectionRange(a, b);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

function renderField(f, entry, prefix) {
  const value = entry[f.key];
  // "symptom" on an entry; "blocks.2.items.0.blocks.1.text" on a block
  // inside a step. One field spec, any depth.
  const at = prefix ? `${prefix}.${f.key}` : f.key;

  if (f.type === "bi") {
    if (f.optional && value === undefined) {
      return field(f.label,
        iconBtn("plus", `Add: ${f.label}`,
                `data-op="addfield" data-key="${esc(f.key)}" data-in="${esc(prefix || "")}"`),
        f.hint, "optional");
    }
    return field(f.label,
      textareas(at, value) +
      (f.optional ? `<div class="rowbar" style="margin:8px 0 0">` +
        iconBtn("trash", `Remove: ${f.label}`,
                `data-op="dropfield" data-key="${esc(f.key)}" ` +
                `data-in="${esc(prefix || "")}"`, "bad") + `</div>` : ""),
      f.hint);
  }

  if (f.type === "bi-list") {
    const rows = (value || []).map((step, i) =>
      `<div class="step-row"><span class="num">${i + 1}</span>` +
      `<div>${textareas(`${at}.${i}`, step)}</div>` +
      `<span class="ops">` +
      iconBtn("up", `Move step ${i + 1} earlier`,
              `data-op="stepup" data-key="${esc(f.key)}" data-i="${i}"`) +
      iconBtn("down", `Move step ${i + 1} later`,
              `data-op="stepdown" data-key="${esc(f.key)}" data-i="${i}"`) +
      iconBtn("trash", `Delete step ${i + 1}`,
              `data-op="stepdrop" data-key="${esc(f.key)}" data-i="${i}"`, "bad") +
      `</span></div>`).join("");
    return field(f.label,
      `<div class="steps">${rows}</div><div class="rowbar" style="margin:10px 0 0">` +
      iconBtn("plus", "Add a step", `data-op="stepadd" data-key="${esc(f.key)}"`) +
      `</div>`,
      f.hint);
  }

  if (f.type === "level") {
    return field(f.label, `<select data-path="${esc(at)}">` + LEVELS.map(([v, l]) =>
      `<option value="${v}"${(value || "info") === v ? " selected" : ""}>${esc(l)}</option>`
    ).join("") + `</select>`, f.hint);
  }

  if (f.type === "text") {
    return field(f.label,
      `<input type="text" data-path="${esc(at)}" value="${esc(value || "")}"` +
      (f.dropEmpty ? ` data-drop-empty="1"` : "") + `>`, f.hint);
  }

  if (f.type === "number") {
    return field(f.label,
      `<input type="number" min="0" step="1" data-path="${esc(at)}" ` +
      `value="${value === undefined ? "" : esc(String(value))}">`, f.hint);
  }

  if (f.type === "bool") {
    return field(f.label,
      `<label><input type="checkbox" data-path="${esc(at)}"${value ? " checked" : ""}> ` +
      `<span class="hint">Gives this station the Mixer tab.</span></label>`, f.hint);
  }

  if (f.type === "layers") {
    return field(f.label, LAYERS.map((l) =>
      `<label style="margin-right:14px"><input type="checkbox" data-op="layer" ` +
      `data-key="${l}"${(value || []).includes(l) ? " checked" : ""}> ${l}</label>`).join(""),
      "A declared tab must have content, and content with no tab declared shows nowhere.");
  }

  if (f.type === "langrows") {
    const list = value || [];
    const rows = list.map((lang, i) =>
      `<div class="langrow">` +
      `<span class="num">${i + 1}</span>` +
      `<label><span class="fname">Code</span>` +
      `<input type="text" data-path="${esc(at)}.${i}.id" ` +
      `value="${esc(lang.id || "")}" placeholder="ko"></label>` +
      `<label><span class="fname">Its own name for itself</span>` +
      `<input type="text" data-path="${esc(at)}.${i}.label" data-drop-empty="1" ` +
      `value="${esc(lang.label || "")}" placeholder="한국어"></label>` +
      blockOps(at, i) + `</div>`).join("");

    return field(f.label,
      `<div class="langrows">${rows}</div>` +
      `<div class="rowbar" style="margin:10px 0 0">` +
      iconBtn("plus", "Add another language",
              `data-op="rowadd" data-arr="${esc(at)}"`) + `</div>` +
      `<p class="field"><span class="hint">A code goes in the QR sticker as ` +
      `<code>#audio/ko</code> and is the key every block in every file is ` +
      `written under, so use a standard one — en, ko, es, pt, zh-Hans. ` +
      `Leave the name empty and the tablet fills in the usual one for that ` +
      `code. Removing a language leaves its wording in the files, out of ` +
      `sight rather than deleted.</span></p>`,
      f.hint);
  }

  if (f.type === "blocks") {
    return field(f.label, blockList(at, value || [], 0), f.hint);
  }

  if (f.type === "media") {
    const files = state.media.files || [];
    return field(f.label,
      `<input type="text" data-path="${esc(at)}" list="mediafiles" ` +
      `value="${esc(value || "")}" placeholder="media/booth.jpg">` +
      `<div class="rowbar" style="margin:8px 0 0">` +
      `<button class="btn" data-op="pickmedia">Choose a file…</button>` +
      `<span class="hint">${files.length} in ` +
      `<code>${esc(state.media.dir || "")}</code></span></div>`,
      f.hint);
  }

  if (f.type === "diagram") {
    if (!value) {
      return field(f.label,
        iconBtn("plus", "Add a diagram",
                `data-op="addfield" data-key="diagram" data-in="${esc(prefix || "")}"`),
        "Optional. A church's own drawings go in docs/img/local/, which is gitignored.",
        "optional");
    }
    return field(f.label,
      `<div class="sub">` +
      field("File", `<input type="text" data-path="${esc(at)}.src" ` +
            `value="${esc(value.src || "")}">`,
            "Relative to docs/, e.g. img/local/booth.svg") +
      field("Alt text", textareas(`${at}.alt`, value.alt)) +
      field("Caption", textareas(`${at}.caption`, value.caption)) +
      `<div class="rowbar" style="margin:4px 0 0">` +
      iconBtn("trash", "Remove this diagram",
              `data-op="dropfield" data-key="diagram" data-in="${esc(prefix || "")}"`, "bad") +
      `</div></div>`);
  }
  return "";
}

/* ---------- a church's own pictures and video ----------
 *
 * The bridge serves one flat folder on the booth machine, read-only and
 * by extension -- see `media_dir()` in server.py for why that is narrower
 * than it sounds. This is the editor's end: list what is there, and take
 * a file so nobody has to find the folder in a file manager.
 */
async function loadMedia() {
  try { state.media = await api("/api/media"); }
  catch { state.media = { dir: "", files: [] } }
  const list = $("mediafiles");
  if (list) {
    list.innerHTML = (state.media.files || [])
      .map((f) => `<option value="media/${esc(f.name)}">`).join("");
  }
}

/* Choose one of the files already there, or add one. A plain file input
 * rather than a drag target: this is a media director on a booth PC once
 * a year, and a control they have used before beats a nicer one they
 * have not. */
function pickMedia(button) {
  const box = button.closest(".field").querySelector("input[type=text]");
  const files = state.media.files || [];
  const names = files.map((f) => `media/${f.name}`);

  const picked = prompt(
    (names.length
      ? `In ${state.media.dir}:\n\n${names.join("\n")}\n\n`
      : `Nothing in ${state.media.dir} yet.\n\n`) +
    "Type one of those, a file that ships in docs/ (img/x32-layout.svg), " +
    "or an https address.\n\nLeave this empty to add a file instead.",
    box.value);
  if (picked === null) return;
  if (picked.trim()) {
    box.value = picked.trim();
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  $("upload").click();
}

async function uploadMedia(file) {
  if (!file) return;
  try {
    const out = await fetch("/api/media/" + encodeURIComponent(file.name), {
      method: "POST", body: file,
    }).then((r) => r.json());
    if (out.error) throw new Error(out.error);
    state.media = out;
    await loadMedia();
    alert(`Added ${file.name}. Choose it on the block you want it on.`);
  } catch (err) {
    alert(`Could not add ${file.name}: ${err.message}`);
  }
}

/* ---------- the block editor ----------
 *
 * A list of blocks, each opened out as its own small form. Rendered from
 * BLOCK_TYPES rather than written out, for the same reason the rest of
 * this file is: the shapes are regular, and a form per type would drift
 * from app.js the first time one of them changed.
 *
 * `path` is the dotted route from the entry to the array being rendered --
 * "blocks", or "blocks.2.items.0.blocks" for a picture inside a step. Every
 * control carries it, so one handler does the splicing at any depth.
 */
function blockList(path, list, depth) {
  const rows = list.map((block, i) => {
    const spec = BLOCK_TYPES[block?.type];
    const here = `${path}.${i}`;
    if (!spec) {
      return `<div class="block bad"><div class="block-head">` +
        `<b>Unknown block: ${esc(String(block?.type))}</b>` +
        blockOps(path, i) + `</div>` +
        `<p class="hint">Nothing renders this, so a tablet would show a gap ` +
        `here. Delete it, or add the type to the app.</p></div>`;
    }
    return `<div class="block"><div class="block-head">` +
      `<b>${esc(spec.label)}</b>${blockOps(path, i)}</div>` +
      // `checklist` and `steps` carry no fields of their own -- their
      // wording is on their items -- so this has to be an empty string
      // rather than an undefined that concatenates as the word.
      (spec.fields || []).map((f) => renderField(f, block, here)).join("") +
      (spec.items ? itemList(spec, `${here}.items`, block.items || [], depth) : "") +
      `</div>`;
  }).join("");

  return `<div class="blocks">${rows}` +
    `<div class="addblock">` + Object.entries(BLOCK_TYPES).map(([kind, spec]) =>
      // Steps inside steps is refused by the rules, so it is not offered.
      (kind === "steps" && depth > 0) ? "" :
      `<button class="btn" data-op="blockadd" data-arr="${esc(path)}" ` +
      `data-kind="${kind}">+ ${esc(spec.label)}</button>`).join("") +
    `</div></div>`;
}

function blockOps(path, i) {
  return `<span class="ops">` +
    iconBtn("up", "Move this up", `data-op="arrup" data-arr="${esc(path)}" data-i="${i}"`) +
    iconBtn("down", "Move this down", `data-op="arrdown" data-arr="${esc(path)}" data-i="${i}"`) +
    iconBtn("trash", "Delete this", `data-op="arrdrop" data-arr="${esc(path)}" data-i="${i}"`, "bad") +
    `</span>`;
}

/* The items of a checklist or a set of steps. A step's own content is
 * blocks again, one level deeper, which is how a diagram ends up inside
 * the step it explains. */
function itemList(spec, path, items, depth) {
  const rows = items.map((item, i) => {
    const here = `${path}.${i}`;
    return `<div class="item-row"><div class="block-head">` +
      `<span class="num">${i + 1}</span>${blockOps(path, i)}</div>` +
      spec.items.fields.map((f) => renderField(f, item, here)).join("") +
      (spec.items.nests
        ? field("Inside this step", blockList(`${here}.blocks`, item.blocks || [], depth + 1))
        : "") + `</div>`;
  }).join("");
  return field(spec.items.one === "step" ? "Steps" : "Items",
    `<div class="items-in">${rows}</div><div class="rowbar" style="margin:8px 0 0">` +
    iconBtn("plus", `Add another ${spec.items.one}`,
            `data-op="itemadd" data-arr="${esc(path)}"`) + `</div>`);
}

/* An id no other tickable item in this station file is using.
 *
 * Scoped to the whole file rather than to the block, because that is how
 * the ticks are stored: one flat set per station, keyed by id. Two items
 * sharing one anywhere in the file would tick together. */
function freshItemId(docName) {
  const taken = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string") taken.add(node.id);
    Object.values(node).forEach(walk);
  };
  walk(state.docs[docName]);
  let n = taken.size + 1;
  while (taken.has(`item-${n}`)) n += 1;
  return `item-${n}`;
}

/* Walk a dotted path from the entry. `blocks.2.items.0.blocks` reads
 * through arrays as well as objects, because a numeric key on a JS array
 * is just an index. */
function atPath(entry, path) {
  if (!path) return entry;
  return path.split(".").reduce((node, key) => (node == null ? node : node[key]), entry);
}

/* The array at a path, created if this is the first thing to go in it. */
function arrayAt(entry, path) {
  const parts = path.split(".");
  const parent = atPath(entry, parts.slice(0, -1).join("."));
  const last = parts.at(-1);
  if (!Array.isArray(parent[last])) parent[last] = [];
  return parent[last];
}

/* ---------- form wiring ---------- */

function setAt(entry, path, value) {
  const parts = path.split(".");
  let node = entry;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === undefined) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function grow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}

function wireForm(entry, spec) {
  const box = $("form");
  const sel = state.sel;

  // The toolbar over each box, and the same three on the keyboard. Bound
  // to the box rather than the window so a shortcut only ever formats the
  // thing the cursor is in.
  box.querySelectorAll("[data-mark]").forEach((el) => {
    el.onclick = () => {
      const target = box.querySelector(`textarea[data-path="${CSS.escape(el.dataset.box)}"]`);
      if (target) applyMark(target, MARKS.find((m) => m.op === el.dataset.mark));
    };
  });

  box.querySelectorAll("textarea").forEach((el) => {
    grow(el);
    el.onkeydown = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const mark = MARKS.find((m) => m.key === e.key.toLowerCase());
      if (!mark) return;
      e.preventDefault();
      applyMark(el, mark);
    };
    el.oninput = () => {
      grow(el);
      setAt(entry, el.dataset.path, el.value);
      el.classList.toggle("has-blank", BLANK.test(el.value));
      el.closest(".lang-in").classList.toggle("gap", !el.value);
      touched(sel.doc);
    };
  });

  box.querySelectorAll("input[type=number]").forEach((el) => {
    // Blank means "not recorded yet", which is an absent key. A null would
    // land in the saved file and read as a number nobody can press.
    el.oninput = () => {
      const raw = el.value.trim();
      if (raw === "") delete entry[el.dataset.path];
      else setAt(entry, el.dataset.path, Number(raw));
      touched(sel.doc);
    };
  });

  box.querySelectorAll("input[type=text], select").forEach((el) => {
    if (el.dataset.op === "rename") {
      el.onchange = () => renameKey(el.value.trim());
      return;
    }
    el.oninput = () => {
      // Same rule as the number field: empty means "not given", which is an
      // absent key, not a key holding "". A "" would be written to the file
      // and read back as an answer somebody had supplied.
      if (el.dataset.dropEmpty && !el.value.trim()) {
        // Empty means "not given", which is an absent key rather than a
        // key holding "" -- a "" would be written to the file and read
        // back as an answer somebody had supplied.
        const parts = el.dataset.path.split(".");
        delete atPath(entry, parts.slice(0, -1).join("."))[parts.at(-1)];
      } else {
        setAt(entry, el.dataset.path, el.value);
      }
      touched(sel.doc);
    };
  });

  box.querySelectorAll("input[type=checkbox]").forEach((el) => {
    el.onchange = () => {
      if (el.dataset.op === "layer") {
        const set = new Set(entry.layers || []);
        el.checked ? set.add(el.dataset.key) : set.delete(el.dataset.key);
        entry.layers = LAYERS.filter((l) => set.has(l));
      } else {
        setAt(entry, el.dataset.path, el.checked);
      }
      touched(sel.doc);
      renderForm();
    };
  });

  box.querySelectorAll("[data-op]").forEach((el) => {
    const op = el.dataset.op;
    if (["rename", "layer"].includes(op)) return;
    el.onclick = () => {
      const list = state.docs[sel.doc][keyOf(sel.section)];
      const key = el.dataset.key;
      const i = Number(el.dataset.i);

      // An optional field may sit on the entry or on a block inside it.
      const on = el.dataset.in ? atPath(entry, el.dataset.in) : entry;
      const arr = el.dataset.arr;

      if (op === "addfield") on[key] = key === "diagram" ? { src: "", alt: bi(), caption: bi() } : bi();
      else if (op === "dropfield") delete on[key];
      else if (op === "stepadd") (entry[key] = entry[key] || []).push(bi());
      else if (op === "stepdrop") entry[key].splice(i, 1);
      else if (op === "stepup" && i > 0) entry[key].splice(i - 1, 0, entry[key].splice(i, 1)[0]);
      else if (op === "stepdown") entry[key].splice(i + 1, 0, entry[key].splice(i, 1)[0]);
      else if (op === "delete") return deleteEntry(spec, list);

      // Blocks and their items, at any depth, through the path each
      // control carries. One handler rather than one per nesting level.
      else if (op === "blockadd") {
        arrayAt(entry, arr).push(BLOCK_TYPES[el.dataset.kind].blank());
      } else if (op === "itemadd") {
        const parts = arr.split(".");
        const block = atPath(entry, parts.slice(0, -1).join("."));
        const fresh = BLOCK_TYPES[block.type].items.blank();
        fresh.id = freshItemId(sel.doc);
        arrayAt(entry, arr).push(fresh);
      } else if (op === "arrup" && i > 0) {
        const a = atPath(entry, arr);
        a.splice(i - 1, 0, a.splice(i, 1)[0]);
      } else if (op === "arrdown") {
        const a = atPath(entry, arr);
        if (i < a.length - 1) a.splice(i + 1, 0, a.splice(i, 1)[0]);
      } else if (op === "rowadd") {
        // No `label` key at all, rather than an empty one. The difference
        // is real: absent means "use the name the tablet already knows for
        // this code", and empty would be a button with no name on it.
        arrayAt(entry, arr).push({ id: "" });
      } else if (op === "arrdrop") {
        atPath(entry, arr).splice(i, 1);
      } else if (op === "pickmedia") {
        return pickMedia(el);
      }
      touched(sel.doc);
      renderTree();
      renderForm();
    };
  });
}

/* Add an entry to a section, and select it.
 *
 * Called from the tree's + rather than from the form, so it takes the
 * section rather than reading the selection: you can add to a section you
 * are not currently looking at. A new row goes after the selected one when
 * that is in the same section, and at the end otherwise. */
function addEntry(docName, section) {
  const spec = SECTIONS[section];
  const doc = state.docs[docName];
  const fresh = spec.blank();
  const sel = state.sel;
  const here = sel && sel.doc === docName && sel.section === section;

  const at_key = keyOf(section);
  if (spec.kind === "map") {
    doc[at_key] = doc[at_key] || {};
    let key = "New screen";
    let n = 1;
    while (doc[at_key][key]) key = `New screen ${++n}`;
    doc[at_key][key] = fresh;
    state.sel = { doc: docName, section, id: key };
  } else {
    const list = (doc[at_key] = doc[at_key] || []);
    // Given its address at birth rather than on the first save, so it is
    // never briefly a thing nothing can point at.
    if (spec.identified) {
      const taken = new Set(list.map((e) => e.id));
      let n = list.length + 1;
      while (taken.has(`item-${n}`)) n += 1;
      fresh.id = `item-${n}`;
    }
    const at = here && typeof sel.id === "number" ? sel.id + 1 : list.length;
    list.splice(at, 0, fresh);
    state.sel = { doc: docName, section, id: at };
  }
  touched(docName);
  renderTree();
  renderForm();
}

function deleteEntry(spec, list) {
  const sel = state.sel;
  const what = spec.kind === "map" ? sel.id : summarise(sel.section, currentEntry(), sel.id);
  if (!confirm(`Delete "${what}"? This only changes the draft — nothing is written until you save.`)) return;
  if (spec.kind === "map") {
    delete state.docs[sel.doc][keyOf(sel.section)][sel.id];
    const left = Object.keys(state.docs[sel.doc][keyOf(sel.section)]);
    state.sel.id = left[0] ?? null;
  } else {
    list.splice(sel.id, 1);
    state.sel.id = Math.min(sel.id, list.length - 1);
    if (list.length === 0) state.sel.id = null;
  }
  touched(sel.doc);
  renderTree();
  renderForm();
}

function renameKey(next) {
  const sel = state.sel;
  const group = state.docs[sel.doc][keyOf(sel.section)];
  if (!next || next === sel.id || group[next]) { renderForm(); return; }
  // Rebuilt rather than reassigned, so the screens keep the order they are read in.
  const rebuilt = {};
  for (const [k, v] of Object.entries(group)) rebuilt[k === sel.id ? next : k] = v;
  state.docs[sel.doc][keyOf(sel.section)] = rebuilt;
  state.sel.id = next;
  touched(sel.doc);
  renderTree();
  renderForm();
}

/* ---------- the preview ---------- */

/* Where to point the preview for whatever is selected.
 *
 * The hash carries the language, so a reload lands in the one being worked
 * in. There is no separate control for it out here -- the app's own
 * segment in the frame is the second view of `state.writing`, and
 * `showLangInPreview` / `watchPreviewLang` keep the two in step rather
 * than letting them disagree. */
function previewPlan() {
  const sel = state.sel;
  if (!sel) return { hash: "", view: null };
  // roles.json is the picker and the cover, and ui.json is every view at
  // once, so both are best looked at from the front page. A bare "#ko"
  // would read as a station id, so the picker's hash stays empty and the
  // app's remembered language covers it.
  if (sel.doc === "roles" || sel.doc === "ui") return { hash: "", view: null };
  const lang = state.writing ? `/${state.writing}` : "";
  if (sel.doc === "guides") return { hash: `audio${lang}`, view: "now", key: sel.id };
  const view = { home: "home", faq: "home", training: "pages" }[sel.section]
               || sel.section;
  const drill = ["problems", "equipment", "training"].includes(sel.section);
  const unfold = ["flow", "faq"].includes(sel.section);
  return {
    hash: `${sel.doc}${lang}`,
    view,
    index: typeof sel.id === "number" ? sel.id : null,
    drill, unfold,
    container: sel.section === "faq" ? "home-faq" : "flow",
  };
}

function refreshPreview() {
  const plan = previewPlan();
  const frame = $("frame");
  // A query string rather than only a hash: the point of reloading is to
  // re-fetch the draft, and changing a hash alone never does.
  frame.src = `preview/index.html?t=${Date.now()}#${plan.hash}`;
  frame.onload = () => {
    watchPreviewLang();
    driveWhenReady(plan, Date.now() + 3000);
  };
}

/* ---------- the preview's language is this editor's language ----------
 *
 * Two views of one value rather than two controls. The app in the frame
 * already has a segment in its header -- it is the guide, not a mock-up of
 * it, so of course it does -- and a volunteer's tablet is where that
 * control belongs. Adding a second one out here that could disagree with
 * it was the mistake; making the two ends of one value is not. */

/* Press the segment inside the frame. Clicking rather than reloading, so
 * switching language is instant and does not throw away where you had
 * scrolled to. Returns false when the frame has not finished loading, in
 * which case the hash will carry the language anyway. */
function showLangInPreview(lang) {
  let doc;
  try { doc = $("frame").contentDocument; } catch { return false; }
  const btn = doc?.querySelector(`#langs .seg[data-id="${CSS.escape(lang)}"]`);
  if (!btn) return false;
  if (btn.getAttribute("aria-pressed") !== "true") btn.click();
  return true;
}

/* And the other direction. A click on the app's own segment is caught on
 * the way down, because pressing it in the preview is the same act as
 * pressing it in the form. `hashchange` as well, for a language that
 * arrives by the URL -- the app only writes the hash when it is showing a
 * station, so neither signal covers every case on its own. */
function watchPreviewLang() {
  let win;
  try { win = $("frame").contentWindow; } catch { return; }
  if (!win) return;

  win.document.addEventListener("click", (e) => {
    const seg = e.target.closest?.("#langs .seg");
    if (seg) setWriting(seg.dataset.id, true);
  }, true);

  win.addEventListener("hashchange", () => {
    setWriting(win.location.hash.replace(/^#/, "").split("/")[1], true);
  });
}

/* The app boots by fetching its own content, so nothing exists to click for
 * a moment. Poll rather than guess a delay -- and give up quietly, because a
 * preview that cannot find the tab is not worth an error message. */
function driveWhenReady(plan, deadline) {
  let doc;
  try { doc = $("frame").contentDocument; } catch { return; }
  if (!doc) return;

  const ready = plan.view
    ? doc.querySelector(`.tab[data-view="${plan.view}"], .navcard[data-view="${plan.view}"]`)
    : doc.querySelector(".station");
  if (!ready) {
    if (Date.now() < deadline) setTimeout(() => driveWhenReady(plan, deadline), 60);
    return;
  }
  if (!plan.view) return;

  const tab = doc.querySelector(`.tab[data-view="${plan.view}"]`);
  if (tab) tab.click();
  else doc.querySelector(`.navcard[data-view="${plan.view}"]`)?.click();

  setTimeout(() => {
    if (plan.key) doc.querySelector(`#screens .tile[data-key="${CSS.escape(plan.key)}"]`)?.click();
    else if (plan.drill && plan.index !== null) {
      doc.querySelectorAll(`#${plan.view} .tile`)[plan.index]?.click();
    } else if (plan.unfold && plan.index !== null) {
      const card = doc.querySelectorAll(`#${plan.container} details`)[plan.index];
      if (card) { card.open = true; card.scrollIntoView({ block: "center" }); }
    }
  }, 30);
}

/* ---------- chrome ---------- */

function renderChrome() {
  $("target").innerHTML = [
    ["repo", "The example (repo)", !state.repoAvailable],
    ["local", "This church", false],
  ].map(([id, label, off]) =>
    `<button data-t="${id}" aria-pressed="${state.target === id}"${off ? " disabled" : ""}>` +
    `${esc(label)}</button>`).join("");
  $("target").querySelectorAll("button").forEach((el) => {
    el.onclick = async () => {
      if (state.dirty.length &&
          !confirm("Unsaved changes will be dropped when the target changes. Continue?")) return;
      absorb(await api("/api/target", "POST", { target: el.dataset.t }));
      state.docs = (await api("/api/guide")).docs;
      state.sel = null;
      restoreLangs();
      renderAll();
    };
  });

  const sample = Object.values(state.willWriteTo)[0] || "";
  $("dest").textContent = sample ? "→ " + sample.replace(/[^/\\]+$/, "*.json") : "";

  $("dirty").textContent = state.dirty.length
    ? `${state.dirty.length} file${state.dirty.length > 1 ? "s" : ""} unsaved` : "";
  $("save").disabled = state.dirty.length === 0;

  renderBar();
}

/* ---------- the bar along the bottom ----------
 *
 * This used to print the rule messages as a bulleted list with a per-
 * language progress block under it. Both were true and neither was for
 * the person reading them: `audio.json.problems[3].todo missing es` is a
 * dotted path, and a media director wanting to finish a translation needs
 * somewhere to click, not a diagnostic.
 *
 * So the bar is one line that names the next thing to do and takes you
 * there. The rule messages are still exactly what CI would say -- they are
 * behind Details, for whoever wants them. */

function renderBar() {
  const box = $("problems");
  const gaps = findGaps();
  const rules = state.problems.length;
  box.classList.toggle("bad", rules > 0 || gaps.length > 0);

  // Which gap the last click took us to. Back to "the first" whenever the
  // list shrinks under us, which is what finishing one does.
  if (state.gapSeen !== null && state.gapSeen >= gaps.length) state.gapSeen = null;

  let line;
  if (gaps.length) {
    const at = state.gapSeen;
    line = `<button class="barline" id="gogap">` + (at === null
      ? `${gaps.length} thing${gaps.length > 1 ? "s" : ""} still need writing` +
        ` — <u>click to go to the first</u>`
      : `${at + 1} of ${gaps.length} · ${esc(gaps[at].where)}` +
        ` — <u>click for the next</u>`) + `</button>`;
  } else if (rules) {
    // Nothing with a box to fill, but the rules still object -- a role
    // declaring a layer it has not got, two guides on one number.
    line = `<span class="barline">${rules} thing${rules > 1 ? "s" : ""} ` +
           `the rules would reject</span>`;
  } else {
    line = `<span class="barline ok">Nothing missing — this passes the same ` +
           `checks the test suite runs</span>`;
  }

  // Details holds the two things worth having but not worth reading first:
  // the rule messages verbatim, and how much of each language is written.
  // Offered whenever it would have something in it.
  const worth = rules > 0 || langIds().length > 1;
  box.innerHTML = line +
    (worth ? `<button class="details" id="showdetail" aria-expanded="${state.detail}">` +
             `Details</button>` : "") +
    (worth && state.detail ? detailPanel() : "");

  const go = $("gogap");
  if (go) go.onclick = () => {
    const next = state.gapSeen === null ? 0 : (state.gapSeen + 1) % gaps.length;
    state.gapSeen = next;
    goToGap(gaps[next]);
  };
  const toggle = $("showdetail");
  if (toggle) toggle.onclick = () => { state.detail = !state.detail; renderBar(); };
}

/* Every box that is still empty, in the order the tree lists them.
 *
 * Computed from the draft rather than parsed back out of the rule
 * messages. The messages are sentences meant to be read; turning one into
 * a place to click would mean a second parser for a format that exists to
 * be human. This walk already had to happen for the flags in the tree. */
function findGaps() {
  const ids = langIds();
  const out = [];

  const collect = (node, prefix, add) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => collect(v, `${prefix}${prefix ? "." : ""}${i}`, add));
      return;
    }
    if (isBlock(node)) {
      for (const lang of ids) if (!node[lang]) add(prefix, lang);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      collect(v, `${prefix}${prefix ? "." : ""}${k}`, add);
    }
  };

  for (const group of docsInOrder()) {
    for (const { doc, section } of group.rows) {
      const spec = SECTIONS[section];
      const where = `${group.label} · ${spec.label}`;
      for (const [id, entry] of entriesOf(doc, section)) {
        // A `doc` section edits the whole file, so only the fields its own
        // form shows are its business -- everything else in that file
        // belongs to one of the other rows and would be counted twice.
        const scope = spec.kind === "doc"
          ? Object.fromEntries(spec.fields.map((f) => [f.key, entry[f.key]]))
          : entry;
        collect(scope, "", (path, lang) =>
          out.push({ doc, section, id, path, lang, where }));
      }
    }
  }
  return out;
}

/* Select the entry, then put the cursor in the empty box itself. Landing
 * on the right form is most of the job; landing in the box means the next
 * thing you do is type.
 *
 * Switching the language first, because a form shows one language at a
 * time: a gap in Korean has no box on screen while you are writing in
 * English, so there would be nothing to put the cursor in. The preview
 * moves with it, being the other view of the same value.
 *
 * Synchronous throughout. `select()` renders the form before it returns,
 * so there is nothing to wait for -- and the requestAnimationFrame this
 * used to wait in never fires at all while the window is in the
 * background, which left the bar a click behind itself. */
function goToGap(gap) {
  if (state.writing !== gap.lang) {
    state.writing = gap.lang;
    remember();
    showLangInPreview(gap.lang);
  }
  select(gap.doc, gap.section, gap.id);

  const path = `${gap.path}.${gap.lang}`.replace(/["\\]/g, "\\$&");
  const el = $("form").querySelector(`[data-path="${path}"]`);
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.focus();
  }
  renderBar();
}

function detailPanel() {
  const shown = state.problems.slice(0, PROBLEM_CAP);
  const rest = state.problems.length - shown.length;
  return `<div class="detail">` + progressPanel() +
    (shown.length
      ? `<h2>Exactly what the rules would say</h2><ul>` +
        shown.map((p) => `<li>${esc(p)}</li>`).join("") +
        (rest ? `<li class="more">…and ${rest} more of the same kind.</li>` : "") +
        `</ul>`
      : "") +
    `</div>`;
}

/* How much of each language is written, for the Details panel.
 *
 * Declaring a language takes a minute and translating one takes weeks, so
 * the gap between the two is worth showing -- but as a figure somebody
 * goes looking for, not as the first thing in the bar. The line above it
 * says what to do next; this says how far there is left to go.
 *
 * Counted over the language blocks in the draft, the same walk the tree
 * flags and the bar's own gap list use. */
function progressPanel() {
  const ids = langIds();
  if (ids.length < 2) return "";
  const total = {}, filled = {};
  ids.forEach((l) => { total[l] = 0; filled[l] = 0; });

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (isBlock(node)) {
      ids.forEach((l) => { total[l] += 1; if (node[l]) filled[l] += 1; });
      return;
    }
    Object.values(node).forEach(walk);
  };
  Object.values(state.docs).forEach(walk);

  return `<div class="progress">` + langs().map(({ id, label }) => {
    const done = total[id] ? Math.round((filled[id] / total[id]) * 100) : 100;
    return `<span class="${done === 100 ? "full" : ""}">${esc(label)} ` +
           `<b>${done}%</b> — ${filled[id]} of ${total[id]} written</span>`;
  }).join("") + `</div>`;
}

function renderAll() {
  renderChrome();
  renderTree();
  renderForm();
  refreshPreview();
}

/* ---------- wiring ---------- */

$("save").onclick = async () => {
  const out = await api("/api/save", "POST", {});
  absorb(out);
  renderChrome();
  renderTree();
  renderForm();
};

$("revert").onclick = async () => {
  if (!confirm("Throw away every unsaved change and reload from disk?")) return;
  absorb(await api("/api/revert", "POST", {}));
  state.docs = (await api("/api/guide")).docs;
  restoreLangs();
  renderAll();
};

// The two buttons in the shell get their glyphs from the same table as the
// ones the forms build, rather than a second copy pasted into the HTML.
$("revert").innerHTML = icon("undo");
$("refresh").innerHTML = icon("reload");
$("refresh").onclick = refreshPreview;

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); $("save").click(); }
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty.length) { e.preventDefault(); e.returnValue = ""; }
});

$("upload").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  uploadMedia(file);
};

(async function boot() {
  absorb(await api("/api/guide"));
  restoreLangs();
  await loadMedia();
  renderAll();
})();
