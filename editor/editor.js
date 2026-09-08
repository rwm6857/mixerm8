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

const GUIDE_FIELDS = [NUMBER, LEVEL, BI("title", "Title"), TODO,
                      BI("body", "What this screen is"),
                      BI("action", "What to do", { optional: true }), DIAGRAM];

const SECTIONS = {
  /* The list the whole app is generated from. Adding one here grows every
   * text field in this editor and fills the problems bar with what the new
   * language is missing -- which is the translation job, written down. */
  languages: {
    label: "Languages", kind: "list", one: "language",
    title: (e) => ({ [langIds()[0]]: e.label || e.id }),
    hint: "One button in the tablet's header per language, in this order. " +
          "The first one is what an untranslated card falls back to, so keep " +
          "it the one somebody in the booth is sure to read.",
    fields: [{ key: "id", label: "Code", type: "text",
               hint: "Goes in the QR code as #audio/ko and is the key every " +
                     "block in every file is written under. Use a standard " +
                     "code — en, ko, es, pt, zh-Hans." },
             { key: "label", label: "Its own name for itself", type: "text",
               dropEmpty: true,
               hint: "What the button says: 한국어, Español. Leave it empty " +
                     "and the tablet fills in the usual name for the code." }],
    // No `label` key at all, rather than an empty one. The difference is
    // real: absent means "use the name the tablet already knows for this
    // code", and empty would be a button with no name on it.
    blank: () => ({ id: "" }),
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
    }), DIAGRAM],
  },
  faq: {
    label: "Questions", kind: "list", title: (e) => e.q, one: "question",
    fields: [BI("q", "Question"), TODO, BI("a", "Answer"), DIAGRAM],
    blank: () => ({ q: bi(), a: bi() }),
  },
  checklist: {
    label: "Before", kind: "list", title: (e) => e.text, one: "step",
    fields: [TODO, BI("text", "Step")],
    blank: () => ({ text: bi() }),
  },
  problems: {
    label: "Problems", kind: "list", title: (e) => e.title, one: "problem page",
    fields: [LEVEL,
             BI("title", "Title", {
               hint: "A symptom in the volunteer's words — \"Someone is too quiet\", " +
                     "never \"Gate\". Three words or more.",
             }),
             BI("symptom", "What they are seeing or hearing"),
             TODO,
             { key: "steps", label: "Steps", type: "bi-list" },
             DIAGRAM],
    blank: () => ({ level: "caution", title: bi(), symptom: bi(), steps: [bi()] }),
  },
  flow: {
    label: "Order", kind: "list", title: (e) => e.title, one: "step",
    fields: [BI("when", "When", { hint: "\"45 min before\", \"During\", \"After\"." }),
             BI("title", "Step"), TODO, BI("detail", "Detail"), DIAGRAM],
    blank: () => ({ when: bi(), title: bi(), detail: bi() }),
  },
  equipment: {
    label: "Equipment", kind: "list", title: (e) => e.title, one: "piece of gear",
    fields: [LEVEL, BI("title", "Name"),
             BI("where", "Where it is", {
               hint: "A blank is a fine answer — it says nobody has written it down. " +
                     "Silence is not, so this one is never empty.",
             }),
             TODO, BI("body", "What it does"),
             BI("action", "What to do about it", { optional: true }), DIAGRAM],
    blank: () => ({ level: "info", title: bi(), where: bi(), body: bi() }),
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

const LAYERS = ["checklist", "problems", "flow", "equipment"];
const LEVELS = [["ok", "Safe"], ["caution", "Careful"],
                ["danger", "Do not change"], ["info", "Note"]];

/* How many problems the bar lists before it stops. Declaring a new
 * language opens a gap in every block of every file at once, which is
 * hundreds of lines of true but unreadable list. The count above it is
 * the number that matters; the rest is the same sentence again. */
const PROBLEM_CAP = 40;

/* Which language you are writing in, and which one to show beside it.
 *
 * A column per language was fine at two and unusable at four: every field
 * became a wrapping grid, and the form got longer in proportion to how
 * many languages the guide offered. This is the translator's arrangement
 * instead -- one language to type into, one to read from -- so the form is
 * the same length whether the guide is in two languages or eight. Kept in
 * localStorage because it is a working position, not part of the guide. */
const state = {
  writing: null,      // language id being edited; null until the docs load
  beside: null,       // language id shown read-only next to it, or null
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

function entriesOf(docName, section) {
  const doc = state.docs[docName];
  const spec = SECTIONS[section];
  if (spec.kind === "doc" || spec.kind === "sub" || spec.kind === "strings") {
    return [["", doc]];
  }
  if (spec.kind === "map") return Object.entries(doc[section] || {});
  return (doc[section] || []).map((e, i) => [i, e]);
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

const SINGLE = ["doc", "sub", "strings"];
const isSingle = (section) => SINGLE.includes(SECTIONS[section].kind);

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
          `<button class="add" data-doc="${esc(doc)}" data-section="${esc(section)}" ` +
          `title="Add another ${esc(spec.one)}" ` +
          `aria-label="Add another ${esc(spec.one)}">+</button>`) +
        `</div>`;

      if (single || !open) return head;

      const items = entries.map(([id, entry]) =>
        // Draggable rather than a pair of arrows: the order of these is the
        // order a volunteer reads them in, and dragging is how you say
        // "third, after that one" in one gesture instead of three presses.
        `<button class="item" draggable="true" data-doc="${esc(doc)}" ` +
        `data-section="${esc(section)}" data-id="${esc(id)}" ` +
        `aria-current="${String(sel.id) === String(id)}">` +
        `<span class="grip" aria-hidden="true">⠿</span>` +
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

  if (spec.kind === "map") {
    const keys = Object.keys(doc[from.section]);
    const rest = keys.filter((k) => k !== from.id);
    const at = rest.indexOf(ontoId) + (after ? 1 : 0);
    rest.splice(at, 0, from.id);
    const rebuilt = {};
    for (const k of rest) rebuilt[k] = doc[from.section][k];
    doc[from.section] = rebuilt;
    state.sel = { doc: from.doc, section: from.section, id: from.id };
  } else {
    const list = doc[from.section];
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
  const spec = SECTIONS[section];
  if (!spec) return null;
  if (spec.kind === "doc") return state.docs[doc];
  // A `sub` section edits one object inside the file -- roles.json's hero,
  // ui.json's strings -- so it is created on first sight rather than being
  // a section that silently does nothing.
  if (spec.kind === "sub" || spec.kind === "strings") {
    return (state.docs[doc][spec.at] = state.docs[doc][spec.at] || {});
  }
  if (spec.kind === "map") return (state.docs[doc][section] || {})[id];
  return (state.docs[doc][section] || [])[id];
}

function renderForm() {
  const box = $("form");
  const sel = state.sel;

  // Renaming or deleting a language can leave the working pair pointing at
  // one that is gone. Repaired here rather than guarded at every use, so
  // there is one place the invariant holds.
  const ids = langIds();
  if (!ids.includes(state.writing)) state.writing = ids[0];
  if (state.beside && (!ids.includes(state.beside) || state.beside === state.writing)) {
    state.beside = null;
  }

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

  html += langBar();
  // Adding and reordering live in the tree; only the destructive one is
  // here, where you can see the thing you are about to remove.
  if (!single) html += `<div class="rowbar">` +
    `<button class="btn tiny bad" data-op="delete">Delete this ` +
    `${esc(spec.one || "entry")}</button></div>`;
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

/* Writing in and Alongside. Remembered per browser rather than per entry:
 * translating is a sitting, not a field, and having to re-pick the pair on
 * every row would be worse than the columns it replaced. */
function wireLangBar() {
  $("form").querySelectorAll("[data-writing]").forEach((el) => {
    el.onclick = () => {
      state.writing = el.dataset.writing;
      if (state.beside === state.writing) state.beside = null;
      remember();
      renderForm();
    };
  });
  $("form").querySelectorAll("[data-beside]").forEach((el) => {
    el.onclick = () => {
      state.beside = el.dataset.beside || null;
      remember();
      renderForm();
    };
  });
}

function remember() {
  try {
    localStorage.setItem("mixerm8.editor.langs",
                         JSON.stringify({ writing: state.writing, beside: state.beside }));
  } catch { /* private mode; the position just does not survive a reload */ }
}

/* The remembered pair, if the guide still offers both of them. Defaults to
 * the first declared language with nothing beside it -- one column, which
 * is what a guide in one language should look like too. */
function restoreLangs() {
  const ids = langIds();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("mixerm8.editor.langs")) || {}; }
  catch { /* nothing remembered */ }
  state.writing = ids.includes(saved.writing) ? saved.writing : ids[0];
  state.beside = ids.includes(saved.beside) && saved.beside !== state.writing
    ? saved.beside : null;
}

/* The one control that decides what every text field below looks like.
 *
 * Hidden when the guide is in one language, for the same reason the tablet
 * hides its own segment: there is nothing to choose. */
function langBar() {
  const all = langs();
  if (all.length < 2) return "";
  const seg = (name, options, current) =>
    `<div class="seg">` + options.map(({ id, label }) =>
      `<button data-${name}="${esc(id)}" aria-pressed="${id === current}">` +
      `${esc(label)}</button>`).join("") + `</div>`;
  return `<div class="langbar">` +
    `<span class="fname">Writing in</span>` +
    seg("writing", all, state.writing) +
    `<span class="fname">Alongside</span>` +
    seg("beside", [{ id: "", label: "—" },
                   ...all.filter((l) => l.id !== state.writing)], state.beside || "") +
    `</div>`;
}

function field(label, inner, hint, extra) {
  return `<div class="field ${extra || ""}"><span class="fname">${esc(label)}` +
         (hint ? ` <span class="hint">${esc(hint)}</span>` : "") + `</span>${inner}</div>`;
}

/* One text field: the language you are writing in, and optionally one to
 * read from beside it.
 *
 * The reference side is a block of text rather than a second textarea, on
 * purpose. Two editable boxes that look alike is how you retype a sentence
 * into the wrong language, and the whole point of showing it is to read it.
 *
 * The tag turns amber when the language being written is empty here, so a
 * form full of gaps looks like one at a glance without having to compare
 * it against anything. */
function textareas(path, node) {
  const all = langs();
  const write = all.find((l) => l.id === state.writing) || all[0];
  const text = node?.[write.id] || "";
  const beside = state.beside && all.find((l) => l.id === state.beside);

  const editable =
    `<label class="lang-in${text ? "" : " gap"}">` +
    `<span class="tag" lang="${esc(write.id)}">${esc(write.label)}</span>` +
    `<textarea data-path="${esc(path)}.${write.id}" lang="${esc(write.id)}" ` +
    `class="${BLANK.test(text) ? "has-blank" : ""}">${esc(text)}</textarea></label>`;

  if (!beside) return `<div class="pair one">${editable}</div>`;

  const ref = node?.[beside.id] || "";
  return `<div class="pair">` + editable +
    `<div class="lang-ref"><span class="tag" lang="${esc(beside.id)}">` +
    `${esc(beside.label)}</span>` +
    `<div class="ref" lang="${esc(beside.id)}">${ref ? esc(ref)
      : `<span class="nothing">nothing written here either</span>`}</div></div>` +
    `</div>`;
}

function renderField(f, entry) {
  const value = entry[f.key];

  if (f.type === "bi") {
    if (f.optional && value === undefined) {
      return field(f.label,
        `<button class="btn tiny" data-op="addfield" data-key="${esc(f.key)}">+ Add</button>`,
        f.hint, "optional");
    }
    return field(f.label,
      textareas(f.key, value) +
      (f.optional ? `<div class="rowbar" style="margin:8px 0 0">` +
        `<button class="btn tiny bad" data-op="dropfield" data-key="${esc(f.key)}">Remove</button></div>` : ""),
      f.hint);
  }

  if (f.type === "bi-list") {
    const rows = (value || []).map((step, i) =>
      `<div class="step-row"><span class="num">${i + 1}</span>` +
      `<div>${textareas(`${f.key}.${i}`, step)}</div>` +
      `<span class="ops">` +
      `<button class="btn tiny" data-op="stepup" data-key="${esc(f.key)}" data-i="${i}">↑</button>` +
      `<button class="btn tiny" data-op="stepdown" data-key="${esc(f.key)}" data-i="${i}">↓</button>` +
      `<button class="btn tiny bad" data-op="stepdrop" data-key="${esc(f.key)}" data-i="${i}">✕</button>` +
      `</span></div>`).join("");
    return field(f.label,
      `<div class="steps">${rows}</div><div class="rowbar" style="margin:10px 0 0">` +
      `<button class="btn tiny" data-op="stepadd" data-key="${esc(f.key)}">+ Add a step</button></div>`,
      f.hint);
  }

  if (f.type === "level") {
    return field(f.label, `<select data-path="${esc(f.key)}">` + LEVELS.map(([v, l]) =>
      `<option value="${v}"${(value || "info") === v ? " selected" : ""}>${esc(l)}</option>`
    ).join("") + `</select>`, f.hint);
  }

  if (f.type === "text") {
    return field(f.label,
      `<input type="text" data-path="${esc(f.key)}" value="${esc(value || "")}"` +
      (f.dropEmpty ? ` data-drop-empty="1"` : "") + `>`, f.hint);
  }

  if (f.type === "number") {
    return field(f.label,
      `<input type="number" min="0" step="1" data-path="${esc(f.key)}" ` +
      `value="${value === undefined ? "" : esc(String(value))}">`, f.hint);
  }

  if (f.type === "bool") {
    return field(f.label,
      `<label><input type="checkbox" data-path="${esc(f.key)}"${value ? " checked" : ""}> ` +
      `<span class="hint">Gives this station the Mixer tab.</span></label>`, f.hint);
  }

  if (f.type === "layers") {
    return field(f.label, LAYERS.map((l) =>
      `<label style="margin-right:14px"><input type="checkbox" data-op="layer" ` +
      `data-key="${l}"${(value || []).includes(l) ? " checked" : ""}> ${l}</label>`).join(""),
      "A declared tab must have content, and content with no tab declared shows nowhere.");
  }

  if (f.type === "diagram") {
    if (!value) {
      return field(f.label,
        `<button class="btn tiny" data-op="addfield" data-key="diagram">+ Add</button>`,
        "Optional. A church's own drawings go in docs/img/local/, which is gitignored.",
        "optional");
    }
    return field(f.label,
      `<div class="sub">` +
      field("File", `<input type="text" data-path="diagram.src" value="${esc(value.src || "")}">`,
            "Relative to docs/, e.g. img/local/booth.svg") +
      field("Alt text", textareas("diagram.alt", value.alt)) +
      field("Caption", textareas("diagram.caption", value.caption)) +
      `<div class="rowbar" style="margin:4px 0 0">` +
      `<button class="btn tiny bad" data-op="dropfield" data-key="diagram">Remove</button></div>` +
      `</div>`);
  }
  return "";
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

  box.querySelectorAll("textarea").forEach((el) => {
    grow(el);
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
      if (el.dataset.dropEmpty && !el.value.trim()) delete entry[el.dataset.path];
      else setAt(entry, el.dataset.path, el.value);
      touched(sel.doc);
      // The tree names this row after the field being typed in, and it is
      // not the field being typed in, so it is safe to rebuild now.
      if (sel.section === "languages") renderTree();
    };
    // The language list decides how many columns every other form has, so
    // a change here is not a value but the shape of the editor. Redrawn on
    // leaving the field rather than per keystroke: rebuilding the form
    // under a cursor takes the cursor with it, and half a language code is
    // not a language anyway.
    if (sel.section === "languages") el.onchange = () => renderForm();
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
      const list = state.docs[sel.doc][sel.section];
      const key = el.dataset.key;
      const i = Number(el.dataset.i);

      if (op === "addfield") entry[key] = key === "diagram" ? { src: "", alt: bi(), caption: bi() } : bi();
      else if (op === "dropfield") delete entry[key];
      else if (op === "stepadd") (entry[key] = entry[key] || []).push(bi());
      else if (op === "stepdrop") entry[key].splice(i, 1);
      else if (op === "stepup" && i > 0) entry[key].splice(i - 1, 0, entry[key].splice(i, 1)[0]);
      else if (op === "stepdown") entry[key].splice(i + 1, 0, entry[key].splice(i, 1)[0]);
      else if (op === "delete") return deleteEntry(spec, list);
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

  if (spec.kind === "map") {
    doc[section] = doc[section] || {};
    let key = "New screen";
    let n = 1;
    while (doc[section][key]) key = `New screen ${++n}`;
    doc[section][key] = fresh;
    state.sel = { doc: docName, section, id: key };
  } else {
    const list = (doc[section] = doc[section] || []);
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
    delete state.docs[sel.doc][sel.section][sel.id];
    const left = Object.keys(state.docs[sel.doc][sel.section]);
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
  const group = state.docs[sel.doc][sel.section];
  if (!next || next === sel.id || group[next]) { renderForm(); return; }
  // Rebuilt rather than reassigned, so the screens keep the order they are read in.
  const rebuilt = {};
  for (const [k, v] of Object.entries(group)) rebuilt[k === sel.id ? next : k] = v;
  state.docs[sel.doc][sel.section] = rebuilt;
  state.sel.id = next;
  touched(sel.doc);
  renderTree();
  renderForm();
}

/* ---------- the preview ---------- */

/* Where to point the preview for whatever is selected.
 *
 * The hash names a station and no language. That is deliberate: the app in
 * the frame has a language segment in its own header, so putting one out
 * here as well was the same control twice with nothing to keep the two
 * agreeing. Leaving the language out of the hash means the frame keeps
 * whichever one you last pressed inside it, across reloads. */
function previewPlan() {
  const sel = state.sel;
  if (!sel) return { hash: "", view: null };
  // roles.json is the picker and the cover, and ui.json is every view at
  // once, so both are best looked at from the front page.
  if (sel.doc === "roles" || sel.doc === "ui") return { hash: "", view: null };
  if (sel.doc === "guides") return { hash: "audio", view: "now", key: sel.id };
  const view = { home: "home", about: "home", faq: "home" }[sel.section] || sel.section;
  const drill = ["problems", "equipment"].includes(sel.section);
  const unfold = ["flow", "faq"].includes(sel.section);
  return {
    hash: sel.doc,
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
  frame.onload = () => driveWhenReady(plan, Date.now() + 3000);
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

  const bad = state.problems.length;
  const box = $("problems");
  box.classList.toggle("bad", bad > 0);
  const shown = state.problems.slice(0, PROBLEM_CAP);
  const rest = bad - shown.length;
  box.innerHTML = (bad
    ? `<b>${bad} thing${bad > 1 ? "s" : ""} the rules would reject:</b><ul>` +
      shown.map((p) => `<li>${esc(p)}</li>`).join("") +
      (rest ? `<li class="more">…and ${rest} more of the same kind.</li>` : "") +
      `</ul>`
    : `<b>Everything here passes the same checks the test suite runs.</b>`)
    + progressPanel();
}

/* How much of each language is actually written.
 *
 * Declaring a language takes a minute and translating one takes weeks, so
 * the gap between the two is the thing worth showing. Counted over the
 * blocks in the draft rather than over the problems list, because the two
 * answer different questions: the list says what to fix next, this says
 * how far there is to go. */
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
           `<b>${done}%</b> — ${filled[id]} of ${total[id]}</span>`;
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

$("refresh").onclick = refreshPreview;

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); $("save").click(); }
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty.length) { e.preventDefault(); e.returnValue = ""; }
});

(async function boot() {
  absorb(await api("/api/guide"));
  restoreLangs();
  renderAll();
})();
