/* MixerM8 — the guide editor.
 *
 * Three columns: everything in the guide, the thing you are editing, and the
 * real tablet app showing it. The preview is not a mock-up. It is docs/ served
 * from the same files the bridge serves, reading the unsaved draft, so what
 * you are looking at is what the volunteer will see.
 *
 * PAGES. A station's tabs are its `pages`, in the order they are written and
 * under whatever names they are given. You can add one, rename it, drag it
 * along the row, hide it, point a Next button at it, or throw it away. The
 * one thing you cannot do is remove the front page, because that is what a QR
 * sticker lands on. A page with nothing in it hides its own tab, which is why
 * adding a page and filling it in over three Sundays is a normal thing to do
 * rather than a broken guide.
 *
 * The forms are generated from KIND_FIELDS rather than written out, for the
 * same reason the app has no build step: the content is regular -- almost
 * everything is an {en, ko} pair -- and a form per field would be a thousand
 * lines that drift the first time the shape changes.
 *
 * Nothing here knows the rules a guide has to obey. The server runs
 * mixerm8.validate, which is the same module the test suite runs, so the
 * problems bar at the bottom says exactly what CI would say.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const BLANK = /_{4,}/;
const one = (node) => (node && (node.en || node.ko)) || "";

/* ---------- what a form is made of ---------- */

const bi = () => ({ en: "", ko: "" });
const BI = (key, label, extra) => ({ key, label, type: "bi", ...(extra || {}) });

const TODO = BI("todo", "What is still missing", {
  optional: true,
  hint: "An orange note above the text. Required wherever the wording has a ____ blank.",
});
const DIAGRAM = { key: "diagram", label: "Picture", type: "diagram", optional: true };
const LEVEL = { key: "level", label: "Severity", type: "level" };
const STEPS = { key: "steps", label: "Steps", type: "bi-list" };

/* The kinds of page there are, and what one item of each looks like. */
const KIND_FIELDS = {
  checklist: [TODO, BI("text", "Step")],
  problems: [LEVEL,
             BI("title", "Title", {
               hint: "A symptom in the volunteer's words — \"Someone is too quiet\", " +
                     "never \"Gate\". Three words or more.",
             }),
             BI("symptom", "What they are seeing or hearing"), TODO, STEPS, DIAGRAM],
  flow: [BI("when", "When", { hint: "\"45 min before\", \"During\", \"After\"." }),
         BI("title", "Step"), TODO, BI("detail", "Detail"), DIAGRAM],
  equipment: [LEVEL, BI("title", "Name"),
              BI("where", "Where it is", {
                hint: "A blank is a fine answer — it says nobody has written it down. " +
                      "Silence is not, so this one is never empty.",
              }),
              TODO, BI("body", "What it does"),
              BI("action", "What to do about it", { optional: true }), DIAGRAM],
  cards: [LEVEL, BI("title", "Title"), TODO, BI("body", "Body"),
          BI("action", "What to do", { optional: true }), DIAGRAM],
  mixer: [],
};

const KIND_BLANK = {
  checklist: () => ({ text: bi() }),
  problems: () => ({ level: "caution", title: bi(), symptom: bi(), steps: [bi()] }),
  flow: () => ({ when: bi(), title: bi(), detail: bi() }),
  equipment: () => ({ level: "info", title: bi(), where: bi(), body: bi() }),
  cards: () => ({ level: "info", title: bi(), body: bi() }),
  mixer: () => null,
};

const KINDS = [
  ["checklist", "Checklist — tick-off steps"],
  ["problems", "Problems — symptom, then what to do"],
  ["flow", "Running order — a timeline"],
  ["equipment", "Equipment — one card per box"],
  ["cards", "Cards — anything else"],
  ["mixer", "Mixer — the console screens (sound desk only)"],
];

const PAGE_FIELDS = [
  { key: "id", label: "Id", type: "text",
    hint: "Used by Next buttons. Lowercase, no spaces." },
  { key: "kind", label: "Kind", type: "kind" },
  BI("label", "Tab name", { hint: "What it says along the top bar." }),
  BI("blurb", "Description on the front page", { optional: true,
     hint: "The line under the name on the station's front page." }),
  BI("lede", "Line under the tab", { optional: true }),
  { key: "next", label: "The Next button goes to", type: "next" },
  { key: "hidden", label: "Hidden", type: "bool",
    hint: "Keeps everything in it, but takes the tab away." },
];

const HOME_FIELDS = [
  BI("home.label", "Name of the front page tab", { optional: true }),
  BI("home.blurb", "Its own description", { optional: true }),
  BI("intro", "Introduction", {
    hint: "The first thing somebody sees when they scan the sticker.",
  }),
  DIAGRAM,
];

const FAQ_FIELDS = [BI("q", "Question"), TODO, BI("a", "Answer"), DIAGRAM];

const GUIDE_FIELDS = [LEVEL, BI("title", "Title"), TODO,
                      BI("body", "What this screen is"),
                      BI("action", "What to do", { optional: true }), DIAGRAM];

const ROLE_FIELDS = [
  { key: "id", label: "Id", type: "text",
    hint: "Ends up in a QR code as #audio/ko, so lowercase and boring." },
  BI("label", "Name"), BI("where", "Where the volunteer stands"),
  { key: "theme", label: "Palette", type: "text" },
  { key: "icon", label: "Icon", type: "text" },
  { key: "console", label: "Has a mixing desk", type: "bool" },
];

const LEVELS = [["ok", "Safe"], ["caution", "Careful"],
                ["danger", "Do not change"], ["info", "Note"]];
const LANGS = [["en", "EN"], ["ko", "한국어"], ["both", "EN+한국어"]];
const STATIONS = ["audio", "media", "livestream", "misc"];

const state = {
  docs: {},
  target: "repo",
  repoAvailable: false,
  dirty: [],
  problems: [],
  git: {},
  images: [],
  imageDir: "",
  willWriteTo: {},
  sel: null,          // { doc, section, id }
  lang: "both",
  narrow: false,
  filter: "",
};

/* ---------- talking to the editor server ---------- */

async function api(path, method, body, raw) {
  const r = await fetch(path, {
    method: method || "GET",
    headers: raw ? undefined : (body ? { "Content-Type": "application/json" } : undefined),
    body: raw ? body : (body ? JSON.stringify(body) : undefined),
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
  state.images = s.images || [];
  state.imageDir = s.imageDir || "";
  state.willWriteTo = s.willWriteTo || {};
}

function toast(text, bad) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast" + (bad ? " bad" : "") + " show";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = "toast"; }, 2600);
}

/* Edits go to the server debounced, not on every keystroke: it re-runs the
 * whole rule set on every write, and the preview reload behind it is a full
 * page load. Fast enough at this rhythm, silly at thirty a second. */
let pushTimer = null;
let previewTimer = null;

/* Anything that throws the draft away has to cancel the write that is still
 * on its way, or a keystroke from a second ago lands after the discard and
 * quietly puts the change back. */
function cancelPendingWrite() {
  clearTimeout(pushTimer);
  clearTimeout(previewTimer);
}

function touched(docName) {
  cancelPendingWrite();
  pushTimer = setTimeout(async () => {
    try {
      absorb(await api("/api/doc/" + docName, "PUT", state.docs[docName]));
      renderChrome();
      renderTree();
    } catch (e) { toast(e.message, true); }
  }, 300);
  previewTimer = setTimeout(refreshPreview, 650);
}

/* ---------- the shape of the tree ---------- */

function pagesOf(docName) {
  return state.docs[docName]?.pages || [];
}

function sectionsOf(docName) {
  if (docName === "roles") {
    return [{ key: "roles", label: "Stations", kind: "list",
              fields: ROLE_FIELDS, blank: () => ({ id: "", label: bi(), where: bi(),
                theme: "slate", icon: "question", console: false }),
              title: (e) => ({ en: e.id }) }];
  }
  if (docName === "guides") {
    return [
      { key: "pages", label: "Channel tabs", kind: "map", fields: GUIDE_FIELDS,
        hint: "The key has to match the name console.py reports for that tab.",
        blank: () => ({ level: "info", title: bi(), body: bi() }) },
      { key: "screens", label: "Main screens", kind: "map", fields: GUIDE_FIELDS,
        hint: "The key has to match the name in SCREENS in console.py.",
        blank: () => ({ level: "info", title: bi(), body: bi() }) },
    ];
  }
  return [
    { key: "intro", label: "Front page", kind: "doc", fields: HOME_FIELDS },
    { key: "faq", label: "Questions", kind: "list", fields: FAQ_FIELDS,
      blank: () => ({ q: bi(), a: bi() }), title: (e) => e.q },
    ...pagesOf(docName).map((pg) => ({
      key: "p:" + pg.id, label: one(pg.label) || pg.id, kind: "page", page: pg,
      fields: KIND_FIELDS[pg.kind] || [], blank: KIND_BLANK[pg.kind],
      title: (e) => e.title || e.text || e.q,
    })),
  ];
}

function sectionOf(sel) {
  return sel && sectionsOf(sel.doc).find((x) => x.key === sel.section);
}

function labelOf(id) {
  const role = (state.docs.roles?.roles || []).find((r) => r.id === id);
  return role ? one(role.label) || id : id;
}

function entriesOf(sec, docName) {
  const doc = state.docs[docName];
  if (sec.kind === "doc") return [["", doc]];
  if (sec.kind === "map") return Object.entries(doc[sec.key] || {});
  if (sec.kind === "page") return (sec.page.items || []).map((e, i) => [i, e]);
  return (doc[sec.key] || []).map((e, i) => [i, e]);
}

function hasBlank(node) {
  if (typeof node === "string") return BLANK.test(node);
  if (Array.isArray(node)) return node.some(hasBlank);
  if (node && typeof node === "object") return Object.values(node).some(hasBlank);
  return false;
}

function summarise(sec, entry, key) {
  if (sec.kind === "map") return key;
  const text = one(sec.title ? sec.title(entry) : null).trim();
  return text ? text.slice(0, 46) : "(empty)";
}

/* ---------- the tree ---------- */

function matches(text) {
  return !state.filter || text.toLowerCase().includes(state.filter);
}

function renderTree() {
  const sel = state.sel;
  const docs = ["roles", ...STATIONS, "guides"].filter((n) => state.docs[n]);

  $("tree").innerHTML = docs.map((name) => {
    const heading = name === "roles" ? "Stations list"
      : name === "guides" ? "Mixer screens" : labelOf(name);
    const dirty = state.dirty.includes(name) ? `<span class="dot" title="unsaved"></span>` : "";

    const body = sectionsOf(name).map((sec) => {
      const open = sel && sel.doc === name && sel.section === sec.key;
      const rows = entriesOf(sec, name);
      const kept = rows.filter(([, e]) => matches(JSON.stringify(e)) || matches(sec.label));
      if (state.filter && !kept.length && !matches(sec.label)) return "";

      const items = sec.kind === "doc" ? "" : (open ? rows : kept).map(([id, entry]) =>
        `<button class="item" data-doc="${esc(name)}" data-section="${esc(sec.key)}" ` +
        `data-id="${esc(id)}" aria-current="${open && String(sel.id) === String(id)}">` +
        (hasBlank(entry) ? `<span class="flag">•</span> ` : "") +
        esc(summarise(sec, entry, id)) + `</button>`).join("");

      const pg = sec.page;
      const badge = pg
        ? `<span class="kind">${esc(pg.kind)}</span>` +
          (pg.hidden ? `<span class="tag">hidden</span>` : "") +
          (!(pg.items || []).length && pg.kind !== "mixer"
            ? `<span class="tag warn">empty</span>` : "")
        : "";

      return `<button class="sec${pg ? " ispage" : ""}" data-doc="${esc(name)}" ` +
             `data-section="${esc(sec.key)}"${open ? ' aria-expanded="true"' : ""}>` +
             `<span class="secname">${esc(sec.label)}</span>${badge}` +
             (sec.kind === "doc" || sec.kind === "page" && pg.kind === "mixer"
               ? "" : `<span class="n">${rows.length}</span>`) +
             `</button>` +
             (open && sec.kind === "page"
               ? `<button class="item settings" data-doc="${esc(name)}" ` +
                 `data-section="${esc(sec.key)}" data-id="" ` +
                 `aria-current="${sel.id === null || sel.id === ""}">` +
                 `⚙ Page settings</button>` : "") +
             (open || state.filter ? `<div class="items">${items}</div>` : "");
    }).join("");

    const addPage = STATIONS.includes(name)
      ? `<button class="addpage" data-doc="${esc(name)}">+ Add a page</button>` : "";
    return `<div class="doc">${esc(heading)}${dirty}</div>${body}${addPage}`;
  }).join("");

  $("tree").querySelectorAll(".sec").forEach((el) => {
    el.onclick = () => {
      const sec = sectionsOf(el.dataset.doc).find((x) => x.key === el.dataset.section);
      const rows = entriesOf(sec, el.dataset.doc);
      select(el.dataset.doc, el.dataset.section,
             sec.kind === "doc" ? "" : sec.kind === "page" ? null
               : (rows[0] ? rows[0][0] : null));
    };
  });
  $("tree").querySelectorAll(".item").forEach((el) => {
    el.onclick = () => select(el.dataset.doc, el.dataset.section,
                              el.dataset.id === "" ? null : el.dataset.id);
  });
  $("tree").querySelectorAll(".addpage").forEach((el) => {
    el.onclick = () => addPage(el.dataset.doc);
  });
}

function select(doc, section, id) {
  const sec = sectionsOf(doc).find((x) => x.key === section);
  if (sec && (sec.kind === "list" || sec.kind === "page") && id !== null && id !== "") {
    id = Number(id);
  }
  state.sel = { doc, section, id };
  renderTree();
  renderForm();
  refreshPreview();
}

/* ---------- adding and managing pages ---------- */

function uniqueId(docName, wanted) {
  const taken = new Set(pagesOf(docName).map((p) => p.id));
  let id = wanted;
  let n = 1;
  while (taken.has(id)) id = `${wanted}-${++n}`;
  return id;
}

function addPage(docName) {
  const doc = state.docs[docName];
  doc.pages = doc.pages || [];
  const page = {
    id: uniqueId(docName, "new-page"),
    kind: "cards",
    label: { en: "New page", ko: "새 페이지" },
    // No blurb or lede: they are optional, and seeding them empty would make
    // a page that is invalid the moment it is born. Adding a page has to be
    // a thing you can do without immediately being told off for it.
    items: [],
  };
  doc.pages.push(page);
  touched(docName);
  select(docName, "p:" + page.id, null);
  toast("Page added. It stays out of the tab bar until it has something in it.");
}

function movePage(docName, id, by) {
  const list = pagesOf(docName);
  const i = list.findIndex((p) => p.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  list.splice(j, 0, list.splice(i, 1)[0]);
  touched(docName);
  renderTree();
  renderForm();
}

function deletePage(docName, id) {
  const list = pagesOf(docName);
  const page = list.find((p) => p.id === id);
  const n = (page.items || []).length;
  if (!confirm(`Delete the "${one(page.label)}" page` +
      (n ? ` and the ${n} thing${n > 1 ? "s" : ""} in it` : "") +
      `? Nothing is written until you save.`)) return;
  list.splice(list.indexOf(page), 1);
  // A Next button pointing at a page that is gone is a dead end, so clear it.
  list.forEach((p) => { if (p.next === id) delete p.next; });
  touched(docName);
  state.sel = null;
  renderTree();
  renderForm();
}

function renamePageId(docName, page, next) {
  const clean = next.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!clean || clean === page.id) return;
  const was = page.id;
  page.id = uniqueId(docName, clean);
  pagesOf(docName).forEach((p) => { if (p.next === was) p.next = page.id; });
  state.sel = { doc: docName, section: "p:" + page.id, id: null };
  touched(docName);
}

/* ---------- the form ---------- */

function currentEntry() {
  const sel = state.sel;
  const sec = sectionOf(sel);
  if (!sec) return null;
  if (sec.kind === "doc") return state.docs[sel.doc];
  if (sec.kind === "page") return sel.id === null ? sec.page : (sec.page.items || [])[sel.id];
  if (sec.kind === "map") return (state.docs[sel.doc][sec.key] || {})[sel.id];
  return (state.docs[sel.doc][sec.key] || [])[sel.id];
}

function renderForm() {
  const box = $("form");
  const sel = state.sel;
  const sec = sectionOf(sel);
  const entry = currentEntry();

  if (!sel || !sec || !entry) {
    box.innerHTML = `<div class="welcome"><h1>Pick something on the left</h1>` +
      `<p>Or add a page. A page with nothing in it stays out of the tab bar ` +
      `until it is worth reading, so it is safe to make one now and write it later.</p>` +
      `</div>` + gitPanel();
    wireGit();
    return;
  }

  const settings = sec.kind === "page" && sel.id === null;
  const fields = settings ? PAGE_FIELDS : sec.fields;

  let html = `<div class="crumb">${esc(labelOf(sel.doc))} · ${esc(sec.label)}` +
             (settings ? " · settings" : "") + `</div>`;
  html += `<h1>${esc(settings ? one(sec.page.label) || sec.page.id
                   : sec.kind === "map" ? sel.id
                   : sec.kind === "doc" ? sec.label
                   : summarise(sec, entry, sel.id))}</h1>`;
  if (sec.hint) html += `<p class="hintline">${esc(sec.hint)}</p>`;

  if (settings) html += pageBar(sec.page, sel.doc);
  else if (sec.kind !== "doc") html += rowBar(sec);

  if (sec.kind === "map") {
    html += field("Key", `<input type="text" data-op="rename" value="${esc(sel.id)}">`);
  }
  html += fields.map((f) => renderField(f, entry, sec)).join("");
  html += gitPanel();

  box.innerHTML = html;
  box.scrollTop = 0;
  wireForm(entry, sec);
  wireGit();
}

function pageBar(page, docName) {
  const list = pagesOf(docName);
  const i = list.indexOf(page);
  // The first item has to be addable from here. Everywhere else you add one
  // next to an existing item, and a page that has none would otherwise be a
  // page you could create and then never fill -- which is the whole bug this
  // page model exists to fix.
  const canHold = page.kind !== "mixer";
  return `<div class="rowbar">` +
    (canHold ? `<button class="btn tiny primary" data-op="additem">+ Add ` +
      `${esc(page.items?.length ? "another" : "the first one")}</button>` : "") +
    `<button class="btn tiny" data-op="pageup"${i <= 0 ? " disabled" : ""}>↑ Earlier</button>` +
    `<button class="btn tiny" data-op="pagedown"${i >= list.length - 1 ? " disabled" : ""}>↓ Later</button>` +
    `<button class="btn tiny" data-op="pagehide">${page.hidden ? "Show" : "Hide"}</button>` +
    `<button class="btn tiny bad" data-op="pagedelete">Delete this page</button></div>`;
}

function rowBar(sec) {
  return `<div class="rowbar">` +
    `<button class="btn tiny" data-op="add">+ Add another</button>` +
    (sec.kind !== "map"
      ? `<button class="btn tiny" data-op="up">↑ Move up</button>` +
        `<button class="btn tiny" data-op="down">↓ Move down</button>` : "") +
    `<button class="btn tiny bad" data-op="delete">Delete</button></div>`;
}

function field(label, inner, hint, extra) {
  return `<div class="field ${extra || ""}"><span class="fname">${esc(label)}` +
         (hint ? ` <span class="hint">${esc(hint)}</span>` : "") + `</span>${inner}</div>`;
}

/* B / I / U above every pair. The markers go into the wording itself, which
 * is why they are deliberately not underscores -- four or more of those
 * already mean an unfilled blank. */
function textareas(path, node) {
  return `<div class="pair">` + ["en", "ko"].map((lang) =>
    `<div class="lang-in"><div class="langhead"><span class="tag">` +
    `${lang === "en" ? "ENGLISH" : "한국어"}</span>` +
    `<span class="marks">` +
    `<button class="mark" data-wrap="**" data-for="${esc(path)}.${lang}" title="Bold"><b>B</b></button>` +
    `<button class="mark" data-wrap="*" data-for="${esc(path)}.${lang}" title="Italic"><i>I</i></button>` +
    `<button class="mark" data-wrap="++" data-for="${esc(path)}.${lang}" title="Underline"><u>U</u></button>` +
    `<button class="mark" data-wrap="____" data-for="${esc(path)}.${lang}" title="Unfilled blank">____</button>` +
    `</span></div>` +
    `<textarea data-path="${esc(path)}.${lang}" ` +
    `class="${BLANK.test(node?.[lang] || "") ? "has-blank" : ""}">` +
    `${esc(node?.[lang] || "")}</textarea></div>`).join("") + `</div>`;
}

function renderField(f, entry, sec) {
  const value = f.key.includes(".") ? deepGet(entry, f.key) : entry[f.key];

  if (f.type === "bi") {
    if (f.optional && value === undefined) {
      return field(f.label,
        `<button class="btn tiny" data-op="addfield" data-key="${esc(f.key)}">+ Add</button>`,
        f.hint, "optional");
    }
    return field(f.label,
      textareas(f.key, value) +
      (f.optional ? `<div class="rowbar tight">` +
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
      `<div class="steps">${rows}</div><div class="rowbar tight">` +
      `<button class="btn tiny" data-op="stepadd" data-key="${esc(f.key)}">+ Add a step</button></div>`,
      f.hint);
  }

  if (f.type === "level") {
    return field(f.label, `<select data-path="${esc(f.key)}">` + LEVELS.map(([v, l]) =>
      `<option value="${v}"${(value || "info") === v ? " selected" : ""}>${esc(l)}</option>`
    ).join("") + `</select>`, f.hint);
  }

  if (f.type === "kind") {
    return field(f.label, `<select data-op="kind">` + KINDS.map(([v, l]) =>
      `<option value="${v}"${value === v ? " selected" : ""}>${esc(l)}</option>`
    ).join("") + `</select>`,
    "Changing this changes what the page is made of. Anything already in it stays " +
    "in the file, so switching back brings it straight back.");
  }

  if (f.type === "next") {
    const others = pagesOf(state.sel.doc).filter((p) => p.id !== entry.id);
    return field(f.label, `<select data-path="next">` +
      `<option value=""${!value ? " selected" : ""}>— no Next button —</option>` +
      others.map((p) =>
        `<option value="${esc(p.id)}"${value === p.id ? " selected" : ""}>` +
        `${esc(one(p.label) || p.id)}</option>`).join("") + `</select>`,
      "A button at the foot of the page, so a first-timer can just keep going.");
  }

  if (f.type === "text") {
    const op = f.key === "id" && sec?.kind === "page" ? ' data-op="pageid"' : "";
    return field(f.label,
      `<input type="text" data-path="${esc(f.key)}"${op} value="${esc(value || "")}">`, f.hint);
  }

  if (f.type === "bool") {
    return field(f.label,
      `<label class="check"><input type="checkbox" data-path="${esc(f.key)}"` +
      `${value ? " checked" : ""}> <span>${esc(f.hint || "")}</span></label>`);
  }

  if (f.type === "diagram") {
    if (!value) {
      return field(f.label,
        `<button class="btn tiny" data-op="addfield" data-key="diagram">+ Add a picture</button>`,
        "Optional, and the wording beside it always has to stand alone — the file " +
        "may simply not be there.", "optional");
    }
    return field(f.label,
      `<div class="sub">` +
      field("File", imagePicker(value.src || "")) +
      field("Alt text", textareas("diagram.alt", value.alt),
            "Read aloud by a screen reader, and shown if the picture will not load.") +
      field("Caption", textareas("diagram.caption", value.caption)) +
      `<div class="rowbar tight">` +
      `<button class="btn tiny bad" data-op="dropfield" data-key="diagram">Remove</button></div>` +
      `</div>`);
  }
  return "";
}

function imagePicker(src) {
  const known = state.images.includes(src) || !src;
  return `<div class="imgrow">` +
    `<select data-op="pickimg">` +
    `<option value=""${!src ? " selected" : ""}>— none —</option>` +
    state.images.map((i) =>
      `<option value="${esc(i)}"${i === src ? " selected" : ""}>${esc(i)}</option>`).join("") +
    (known ? "" : `<option value="${esc(src)}" selected>${esc(src)} (shipped)</option>`) +
    `</select>` +
    `<label class="btn tiny upload">Upload…<input type="file" data-op="upload" ` +
    `accept=".svg,.png,.jpg,.jpeg,.webp,.gif" hidden></label>` +
    `</div>` +
    (src ? `<div class="thumb"><img src="preview/${esc(src)}" alt=""></div>` : "");
}

/* ---------- form wiring ---------- */

function deepGet(obj, path) {
  return path.split(".").reduce((n, k) => (n == null ? n : n[k]), obj);
}

function setAt(entry, path, value) {
  const parts = path.split(".");
  let node = entry;
  for (const part of parts.slice(0, -1)) {
    if (node[part] === undefined) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function dropAt(entry, path) {
  const parts = path.split(".");
  const parent = parts.slice(0, -1).reduce((n, k) => (n == null ? n : n[k]), entry);
  if (parent) delete parent[parts.at(-1)];
}

function grow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}

function wrap(el, marker) {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const chosen = value.slice(a, b);
  const next = marker === "____"
    ? value.slice(0, a) + "____" + value.slice(b)
    : value.slice(0, a) + marker + (chosen || "text") + marker + value.slice(b);
  el.value = next;
  el.focus();
  const at = marker === "____" ? a + 4 : a + marker.length;
  el.setSelectionRange(at, at + (marker === "____" ? 0 : (chosen || "text").length));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function wireForm(entry, sec) {
  const box = $("form");
  const sel = state.sel;
  const settings = sec.kind === "page" && sel.id === null;
  const docName = sel.doc;

  box.querySelectorAll("textarea").forEach((el) => {
    grow(el);
    el.oninput = () => {
      grow(el);
      setAt(entry, el.dataset.path, el.value);
      el.classList.toggle("has-blank", BLANK.test(el.value));
      touched(docName);
      if (settings) renderTree();
    };
    el.onkeydown = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const marker = { b: "**", i: "*", u: "++" }[e.key.toLowerCase()];
      if (marker) { e.preventDefault(); wrap(el, marker); }
    };
  });

  box.querySelectorAll(".mark").forEach((el) => {
    el.onclick = () => {
      const ta = box.querySelector(`textarea[data-path="${CSS.escape(el.dataset.for)}"]`);
      if (ta) wrap(ta, el.dataset.wrap);
    };
  });

  box.querySelectorAll('input[type="text"], select').forEach((el) => {
    if (el.dataset.op === "rename") { el.onchange = () => renameKey(el.value.trim()); return; }
    if (el.dataset.op === "pageid") {
      el.onchange = () => { renamePageId(docName, entry, el.value); renderTree(); renderForm(); };
      return;
    }
    if (el.dataset.op === "kind") {
      el.onchange = () => {
        entry.kind = el.value;
        if (entry.kind === "mixer") delete entry.items;
        else entry.items = entry.items || [];
        touched(docName); renderTree(); renderForm();
      };
      return;
    }
    if (el.dataset.op === "pickimg") {
      el.onchange = () => {
        setAt(entry, "diagram.src", el.value);
        touched(docName); renderForm();
      };
      return;
    }
    const handler = () => {
      if (el.dataset.path === "next" && !el.value) dropAt(entry, "next");
      else setAt(entry, el.dataset.path, el.value);
      touched(docName);
      if (settings) renderTree();
    };
    el.tagName === "SELECT" ? (el.onchange = handler) : (el.oninput = handler);
  });

  box.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.onchange = () => {
      setAt(entry, el.dataset.path, el.checked);
      touched(docName); renderTree(); renderForm();
    };
  });

  box.querySelectorAll('input[type="file"]').forEach((el) => {
    el.onchange = async () => {
      const file = el.files[0];
      if (!file) return;
      try {
        const out = await api("/api/image/" + encodeURIComponent(file.name),
                              "POST", file, true);
        absorb(out);
        setAt(entry, "diagram.src", out.src);
        touched(docName);
        renderForm();
        toast(`Added ${out.src}`);
      } catch (e) { toast(e.message, true); }
    };
  });

  box.querySelectorAll("[data-op]").forEach((el) => {
    const op = el.dataset.op;
    if (["rename", "pageid", "kind", "pickimg", "upload"].includes(op)) return;
    el.onclick = () => {
      const key = el.dataset.key;
      const i = Number(el.dataset.i);

      if (op === "pageup") return movePage(docName, entry.id, -1);
      if (op === "pagedown") return movePage(docName, entry.id, 1);
      if (op === "pagehide") {
        entry.hidden = !entry.hidden;
        touched(docName); renderTree(); renderForm(); return;
      }
      if (op === "pagedelete") return deletePage(docName, entry.id);
      if (op === "additem") {
        entry.items = entry.items || [];
        entry.items.push(KIND_BLANK[entry.kind]());
        state.sel = { doc: docName, section: sec.key, id: entry.items.length - 1 };
        touched(docName); renderTree(); renderForm(); refreshPreview();
        return;
      }
      if (op === "add") return addEntry(sec);
      if (op === "delete") return deleteEntry(sec);

      if (op === "addfield") {
        setAt(entry, key, key === "diagram"
          ? { src: "", alt: bi(), caption: bi() } : bi());
      } else if (op === "dropfield") dropAt(entry, key);
      else if (op === "stepadd") (entry[key] = entry[key] || []).push(bi());
      else if (op === "stepdrop") entry[key].splice(i, 1);
      else if (op === "stepup" && i > 0) entry[key].splice(i - 1, 0, entry[key].splice(i, 1)[0]);
      else if (op === "stepdown") entry[key].splice(i + 1, 0, entry[key].splice(i, 1)[0]);
      else if (op === "up" && sel.id > 0) {
        const list = listFor(sec);
        list.splice(sel.id - 1, 0, list.splice(sel.id, 1)[0]);
        state.sel.id -= 1;
      } else if (op === "down") {
        const list = listFor(sec);
        if (sel.id >= list.length - 1) return;
        list.splice(sel.id + 1, 0, list.splice(sel.id, 1)[0]);
        state.sel.id += 1;
      }
      touched(docName);
      renderTree();
      renderForm();
    };
  });
}

function listFor(sec) {
  return sec.kind === "page" ? sec.page.items : state.docs[state.sel.doc][sec.key];
}

function addEntry(sec) {
  const sel = state.sel;
  const fresh = sec.blank();
  if (sec.kind === "map") {
    const group = state.docs[sel.doc][sec.key];
    let key = "New screen";
    let n = 1;
    while (group[key]) key = `New screen ${++n}`;
    group[key] = fresh;
    state.sel.id = key;
  } else {
    const list = listFor(sec);
    const at = typeof sel.id === "number" ? sel.id + 1 : list.length;
    list.splice(at, 0, fresh);
    state.sel.id = at;
  }
  touched(sel.doc);
  renderTree();
  renderForm();
}

function deleteEntry(sec) {
  const sel = state.sel;
  const what = sec.kind === "map" ? sel.id : summarise(sec, currentEntry(), sel.id);
  if (!confirm(`Delete "${what}"? Nothing is written until you save.`)) return;
  if (sec.kind === "map") {
    delete state.docs[sel.doc][sec.key][sel.id];
    state.sel.id = Object.keys(state.docs[sel.doc][sec.key])[0] ?? null;
  } else {
    const list = listFor(sec);
    list.splice(sel.id, 1);
    state.sel.id = list.length ? Math.min(sel.id, list.length - 1) : null;
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
    return `<div class="git"><h2>Saving</h2><p>${esc(g.why || "")}</p>` +
           `<p>Pictures go to <code>${esc(state.imageDir)}</code>.</p></div>`;
  }
  const changed = g.changed?.length
    ? `<p>Changed so far: ${g.changed.map((c) => esc(c)).join(", ")}</p>`
    : "<p>Nothing changed yet.</p>";
  return `<div class="git"><h2>Committing</h2>` +
    `<p>On branch <b>${esc(g.branch)}</b>. The editor writes files and stops there — ` +
    `run these yourself so you can see the branch you are on first.</p>` + changed +
    `<pre id="gitcmds">${esc((g.commands || []).join("\n"))}</pre>` +
    `<div class="rowbar tight"><button class="btn tiny" id="copygit">Copy commands</button></div>` +
    `<p class="muted">Uploaded pictures go to <code>${esc(state.imageDir)}</code>, ` +
    `which git ignores — a photo of your own booth is as much yours as the wording is.</p>` +
    `</div>`;
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

function previewPlan() {
  const sel = state.sel;
  const sec = sectionOf(sel);
  if (!sel || !sec) return { hash: "" };
  if (sel.doc === "roles") return { hash: "" };
  if (sel.doc === "guides") {
    return { hash: `audio/${state.lang}`, page: "mixer", key: sel.id };
  }
  if (sec.kind === "page") {
    const pg = sec.page;
    return {
      hash: `${sel.doc}/${state.lang}`,
      page: pg.id,
      index: typeof sel.id === "number" ? sel.id : null,
      drill: ["problems", "equipment"].includes(pg.kind),
      unfold: pg.kind === "flow" ? "flow" : null,
    };
  }
  return {
    hash: `${sel.doc}/${state.lang}`, page: "home",
    index: sec.key === "faq" && typeof sel.id === "number" ? sel.id : null,
    unfold: sec.key === "faq" ? "home-faq" : null,
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

  const ready = plan.page
    ? doc.querySelector(`.tab[data-page="${CSS.escape(plan.page)}"], .navcard`)
    : doc.querySelector(".station");
  if (!ready) {
    if (Date.now() < deadline) setTimeout(() => driveWhenReady(plan, deadline), 60);
    return;
  }
  if (!plan.page) return;

  // A hidden or empty page has no tab, which is the whole point -- so say so
  // in the preview rather than silently showing the front page instead.
  const tab = doc.querySelector(`.tab[data-page="${CSS.escape(plan.page)}"]`);
  $("nopreview").hidden = Boolean(tab) || plan.page === "home";
  if (tab) tab.click();

  setTimeout(() => {
    if (plan.key) doc.querySelector(`#screens .tile[data-key="${CSS.escape(plan.key)}"]`)?.click();
    else if (plan.drill && plan.index !== null) {
      doc.querySelectorAll(`.view:not([hidden]) .tile`)[plan.index]?.click();
    } else if (plan.unfold && plan.index !== null) {
      const card = doc.querySelectorAll(`#${plan.unfold} details`)[plan.index];
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
      cancelPendingWrite();
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
  box.innerHTML = bad
    ? `<b>${bad} thing${bad > 1 ? "s" : ""} the rules would reject:</b><ul>` +
      state.problems.map((p) => `<li>${esc(p)}</li>`).join("") + `</ul>`
    : `<b>Everything here passes the same checks the test suite runs.</b>`;
}

function renderAll() {
  renderChrome();
  renderTree();
  renderForm();
  refreshPreview();
}

/* ---------- wiring ---------- */

$("save").onclick = async () => {
  try {
    const out = await api("/api/save", "POST", {});
    absorb(out);
    toast(out.written.length
      ? `Saved ${out.written.length} file${out.written.length > 1 ? "s" : ""}.`
      : "Nothing to save.");
    renderChrome(); renderTree(); renderForm();
  } catch (e) { toast(e.message, true); }
};

$("revert").onclick = async () => {
  if (!confirm("Throw away every unsaved change and reload from disk?")) return;
  cancelPendingWrite();
  absorb(await api("/api/revert", "POST", {}));
  state.docs = (await api("/api/guide")).docs;
  renderAll();
};

$("refresh").onclick = refreshPreview;

$("filter").oninput = (e) => {
  state.filter = e.target.value.trim().toLowerCase();
  renderTree();
};

$("lang").innerHTML = LANGS.map(([id, label]) =>
  `<button data-l="${id}" aria-pressed="${id === state.lang}">${esc(label)}</button>`).join("");
$("lang").querySelectorAll("button").forEach((el) => {
  el.onclick = () => {
    state.lang = el.dataset.l;
    $("lang").querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.l === state.lang)));
    refreshPreview();
  };
});

$("device").innerHTML = [["wide", "Tablet"], ["narrow", "Phone"]].map(([id, label]) =>
  `<button data-d="${id}" aria-pressed="${(id === "narrow") === state.narrow}">${esc(label)}</button>`).join("");
$("device").querySelectorAll("button").forEach((el) => {
  el.onclick = () => {
    state.narrow = el.dataset.d === "narrow";
    $("frame").classList.toggle("narrow", state.narrow);
    $("device").querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String((b.dataset.d === "narrow") === state.narrow)));
  };
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); $("save").click(); }
  if (e.key === "/" && document.activeElement === document.body) {
    e.preventDefault(); $("filter").focus();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty.length) { e.preventDefault(); e.returnValue = ""; }
});

(async function boot() {
  absorb(await api("/api/guide"));
  renderAll();
})();
