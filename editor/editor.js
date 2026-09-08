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
  /* Every file carries a `note` explaining what it is for. It used to be
   * the one piece of prose in the guide the editor could not touch, which
   * made it the one piece that went stale. */
  about: {
    label: "About this file", kind: "doc",
    fields: [BI("note", "What this file is for", {
      hint: "Read by whoever edits the guide next, not by a volunteer.",
    })],
  },
  /* The list the whole app is generated from. Adding one here grows every
   * text field in this editor and fills the problems bar with what the new
   * language is missing -- which is the translation job, written down. */
  languages: {
    label: "Languages", kind: "list", title: (e) => ({ [langIds()[0]]: e.label || e.id }),
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
    label: "Questions", kind: "list", title: (e) => e.q,
    fields: [BI("q", "Question"), TODO, BI("a", "Answer"), DIAGRAM],
    blank: () => ({ q: bi(), a: bi() }),
  },
  checklist: {
    label: "Before", kind: "list", title: (e) => e.text,
    fields: [TODO, BI("text", "Step")],
    blank: () => ({ text: bi() }),
  },
  problems: {
    label: "Problems", kind: "list", title: (e) => e.title,
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
    label: "Order", kind: "list", title: (e) => e.title,
    fields: [BI("when", "When", { hint: "\"45 min before\", \"During\", \"After\"." }),
             BI("title", "Step"), TODO, BI("detail", "Detail"), DIAGRAM],
    blank: () => ({ when: bi(), title: bi(), detail: bi() }),
  },
  equipment: {
    label: "Equipment", kind: "list", title: (e) => e.title,
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
    label: "Channel tabs", kind: "map", fields: GUIDE_FIELDS,
    hint: "The number the desk reports for this tab. Record them all with " +
          "`mixerm8 --learn`, or press the tab at the desk and read the " +
          "number off the tablet.",
    blank: () => ({ level: "info", title: bi(), body: bi() }),
  },
  screens: {
    label: "Main screens", kind: "map", fields: GUIDE_FIELDS,
    hint: "The number the desk reports for this screen.",
    blank: () => ({ level: "info", title: bi(), body: bi() }),
  },
  roles: {
    label: "Stations", kind: "list", title: (e) => ({ [langIds()[0]]: e.id }),
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

const state = {
  docs: {},
  target: "repo",
  repoAvailable: false,
  dirty: [],
  problems: [],
  git: {},
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
  state.git = s.git || {};
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

function docsInOrder() {
  const out = [];
  for (const name of ["roles", "ui", "audio", "media", "livestream", "misc", "guides"]) {
    const doc = state.docs[name];
    if (!doc) continue;
    if (name === "roles") {
      out.push({ name, label: "The guide itself",
                 sections: ["about", "languages", "hero", "roles"] });
    } else if (name === "ui") {
      out.push({ name, label: "App wording", sections: ["about", "strings"] });
    } else if (name === "guides") {
      out.push({ name, label: "Mixer screens",
                 sections: ["about", "pages", "screens"] });
    } else {
      const has = ["about", "home", "faq", ...LAYERS.filter((l) => doc[l])];
      out.push({ name, label: labelOf(name), sections: has });
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

function renderTree() {
  const sel = state.sel;
  $("tree").innerHTML = docsInOrder().map((d) => {
    const secs = d.sections.map((section) => {
      const spec = SECTIONS[section];
      const rows = entriesOf(d.name, section);
      const open = sel && sel.doc === d.name && sel.section === section;
      const single = ["doc", "sub", "strings"].includes(spec.kind);
      const items = single
        ? ""
        : rows.map(([id, entry]) =>
            `<button class="item" data-doc="${esc(d.name)}" data-section="${esc(section)}" ` +
            `data-id="${esc(id)}" aria-current="${open && String(sel.id) === String(id)}">` +
            // Two different flags, because they mean different things: a
            // "____" is a fact nobody has established, and a gap is a
            // sentence nobody has translated yet.
            (hasBlank(entry) ? `<span class="flag">•</span> ` : "") +
            (blockGap(entry) ? `<span class="flag gap">◦</span> ` : "") +
            esc(summarise(section, entry, id)) + `</button>`).join("");
      return `<button class="sec" data-doc="${esc(d.name)}" data-section="${esc(section)}">` +
             `<span>${esc(spec.label)}</span>` +
             (single ? "" : `<span class="n">${rows.length}</span>`) +
             `</button>` + (open ? `<div class="items">${items}</div>` : "");
    }).join("");
    return `<div class="doc">${esc(d.label)}</div>${secs}`;
  }).join("");

  $("tree").querySelectorAll(".sec").forEach((el) => {
    el.onclick = () => {
      const spec = SECTIONS[el.dataset.section];
      const rows = entriesOf(el.dataset.doc, el.dataset.section);
      select(el.dataset.doc, el.dataset.section,
             ["doc", "sub", "strings"].includes(spec.kind)
               ? "" : (rows[0] ? rows[0][0] : null));
    };
  });
  $("tree").querySelectorAll(".item").forEach((el) => {
    el.onclick = () => select(el.dataset.doc, el.dataset.section, el.dataset.id);
  });
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
  const entry = currentEntry();
  if (!sel || !entry) {
    box.innerHTML = `<p class="empty">Pick something on the left to edit it.</p>` + gitPanel();
    wireGit();
    return;
  }
  const spec = SECTIONS[sel.section];
  const single = ["doc", "sub", "strings"].includes(spec.kind);

  let html = `<div class="crumb">${esc(labelOf(sel.doc))} · ${esc(spec.label)}</div>`;
  html += `<h1>${esc(spec.kind === "map" ? sel.id
                    : single ? spec.label
                    : summarise(sel.section, entry, sel.id))}</h1>`;
  if (spec.hint) html += `<p class="field"><span class="hint">${esc(spec.hint)}</span></p>`;

  if (!single) html += rowBar(spec);
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
  html += gitPanel();

  box.innerHTML = html;
  box.scrollTop = 0;
  wireForm(entry, spec);
  wireGit();
}

function rowBar(spec) {
  return `<div class="rowbar">` +
    `<button class="btn tiny" data-op="add">+ Add another</button>` +
    (spec.kind === "list"
      ? `<button class="btn tiny" data-op="up">↑ Move up</button>` +
        `<button class="btn tiny" data-op="down">↓ Move down</button>` : "") +
    `<button class="btn tiny bad" data-op="delete">Delete</button></div>`;
}

function field(label, inner, hint, extra) {
  return `<div class="field ${extra || ""}"><span class="fname">${esc(label)}` +
         (hint ? ` <span class="hint">${esc(hint)}</span>` : "") + `</span>${inner}</div>`;
}

/* One column per declared language, labelled with what that language calls
 * itself. Every column is rendered whether or not the key exists yet, so
 * adding a language turns every field in the editor into a visible gap to
 * fill rather than something you have to know to go looking for. */
function textareas(path, node) {
  return `<div class="pair">` + langs().map(({ id, label }) => {
    const text = node?.[id] || "";
    return `<label class="lang-in${text ? "" : " gap"}">` +
      `<span class="tag" lang="${esc(id)}">${esc(label)}</span>` +
      `<textarea data-path="${esc(path)}.${id}" lang="${esc(id)}" ` +
      `class="${BLANK.test(text) ? "has-blank" : ""}">${esc(text)}</textarea></label>`;
  }).join("") + `</div>`;
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
      else if (op === "add") return addEntry(spec);
      else if (op === "delete") return deleteEntry(spec, list);
      else if (op === "up" && sel.id > 0) {
        list.splice(sel.id - 1, 0, list.splice(sel.id, 1)[0]);
        state.sel.id -= 1;
      } else if (op === "down" && sel.id < list.length - 1) {
        list.splice(sel.id + 1, 0, list.splice(sel.id, 1)[0]);
        state.sel.id += 1;
      }
      touched(sel.doc);
      renderTree();
      renderForm();
    };
  });
}

function addEntry(spec) {
  const sel = state.sel;
  const fresh = spec.blank();
  if (spec.kind === "map") {
    let key = "New screen";
    let n = 1;
    while (state.docs[sel.doc][sel.section][key]) key = `New screen ${++n}`;
    state.docs[sel.doc][sel.section][key] = fresh;
    state.sel.id = key;
  } else {
    const list = state.docs[sel.doc][sel.section];
    list.splice(sel.id + 1, 0, fresh);
    state.sel.id += 1;
  }
  touched(sel.doc);
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

/* ---------- git, as words rather than buttons ---------- */

function gitPanel() {
  const g = state.git;
  if (!g.available) {
    return `<div class="git"><h2>Saving</h2><p>${esc(g.why || "")}</p></div>`;
  }
  const changed = g.changed?.length
    ? `<p>Changed so far: ${g.changed.map((c) => esc(c)).join(", ")}</p>` : "<p>Nothing changed yet.</p>";
  return `<div class="git"><h2>Committing</h2>` +
    `<p>On branch <b>${esc(g.branch)}</b>. The editor writes files and stops there — ` +
    `run these yourself so you can see the branch you are on first.</p>` +
    changed +
    `<pre id="gitcmds">${esc((g.commands || []).join("\n"))}</pre>` +
    `<div class="rowbar" style="margin:10px 0 0">` +
    `<button class="btn tiny" id="copygit">Copy commands</button></div></div>`;
}

function wireGit() {
  const btn = $("copygit");
  if (!btn) return;
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText($("gitcmds").textContent);
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = "Copy commands"; }, 1500);
    } catch { /* no clipboard permission; the text is on screen anyway */ }
  };
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
  renderAll();
})();
