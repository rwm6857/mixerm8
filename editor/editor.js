/* MixerM8 — the guide editor.
 *
 * Three columns: everything in the guide, the thing you are editing, and the
 * real tablet app showing it. The preview is not a mock-up. It is docs/ served
 * from the same files the bridge serves, reading the unsaved draft, so what
 * you are looking at is what the volunteer will see.
 *
 * The forms are generated from SECTIONS below rather than written out, for the
 * same reason the app has no build step: the content is regular -- almost
 * everything is an {en, ko} pair -- and a form per field would be five hundred
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

/* ---------- what a form is made of ---------- */

const bi = () => ({ en: "", ko: "" });

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
    label: "Stations", kind: "list", title: (e) => ({ en: e.id }),
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

const LANGS = [["en", "EN"], ["ko", "한국어"], ["both", "EN+한국어"]];

const state = {
  docs: {},
  target: "repo",
  repoAvailable: false,
  dirty: [],
  problems: [],
  git: {},
  willWriteTo: {},
  sel: null,          // { doc, section, id }  id is an index or a map key
  lang: "both",
  narrow: false,
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
  for (const name of ["roles", "audio", "media", "livestream", "misc", "guides"]) {
    const doc = state.docs[name];
    if (!doc) continue;
    if (name === "roles") out.push({ name, label: "Stations", sections: ["roles"] });
    else if (name === "guides") out.push({ name, label: "Mixer screens", sections: ["pages", "screens"] });
    else {
      const has = ["home", "faq", ...LAYERS.filter((l) => doc[l])];
      out.push({ name, label: labelOf(name), sections: has });
    }
  }
  return out;
}

function labelOf(id) {
  const role = (state.docs.roles?.roles || []).find((r) => r.id === id);
  return role ? (role.label?.en || id) : id;
}

/* The first line of an entry, for the tree and nothing else. */
function summarise(section, entry, key) {
  const spec = SECTIONS[section];
  if (spec.kind === "map") return key;
  const node = spec.title ? spec.title(entry) : null;
  const text = (node?.en || "").trim();
  return text ? text.slice(0, 46) : "(empty)";
}

function entriesOf(docName, section) {
  const doc = state.docs[docName];
  const spec = SECTIONS[section];
  if (spec.kind === "doc") return [["", doc]];
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
      const items = spec.kind === "doc"
        ? ""
        : rows.map(([id, entry]) =>
            `<button class="item" data-doc="${esc(d.name)}" data-section="${esc(section)}" ` +
            `data-id="${esc(id)}" aria-current="${open && String(sel.id) === String(id)}">` +
            (hasBlank(entry) ? `<span class="flag">•</span> ` : "") +
            esc(summarise(section, entry, id)) + `</button>`).join("");
      return `<button class="sec" data-doc="${esc(d.name)}" data-section="${esc(section)}">` +
             `<span>${esc(spec.label)}</span>` +
             (spec.kind === "doc" ? "" : `<span class="n">${rows.length}</span>`) +
             `</button>` + (open ? `<div class="items">${items}</div>` : "");
    }).join("");
    return `<div class="doc">${esc(d.label)}</div>${secs}`;
  }).join("");

  $("tree").querySelectorAll(".sec").forEach((el) => {
    el.onclick = () => {
      const spec = SECTIONS[el.dataset.section];
      const rows = entriesOf(el.dataset.doc, el.dataset.section);
      select(el.dataset.doc, el.dataset.section,
             spec.kind === "doc" ? "" : (rows[0] ? rows[0][0] : null));
    };
  });
  $("tree").querySelectorAll(".item").forEach((el) => {
    el.onclick = () => select(el.dataset.doc, el.dataset.section, el.dataset.id);
  });
}

function select(doc, section, id) {
  const spec = SECTIONS[section];
  if (spec.kind === "list" && id !== null) id = Number(id);
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

  let html = `<div class="crumb">${esc(labelOf(sel.doc))} · ${esc(spec.label)}</div>`;
  html += `<h1>${esc(spec.kind === "map" ? sel.id
                    : summarise(sel.section, entry, sel.id))}</h1>`;
  if (spec.hint) html += `<p class="field"><span class="hint">${esc(spec.hint)}</span></p>`;

  if (spec.kind !== "doc") html += rowBar(spec);
  if (spec.kind === "map") {
    html += field("Key", `<input type="text" data-op="rename" value="${esc(sel.id)}">`);
  }
  html += spec.fields.map((f) => renderField(f, entry)).join("");
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

function textareas(path, node) {
  return `<div class="pair">` + ["en", "ko"].map((lang) =>
    `<label class="lang-in"><span class="tag">${lang === "en" ? "ENGLISH" : "한국어"}</span>` +
    `<textarea data-path="${esc(path)}.${lang}" ` +
    `class="${BLANK.test(node?.[lang] || "") ? "has-blank" : ""}">` +
    `${esc(node?.[lang] || "")}</textarea></label>`).join("") + `</div>`;
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
      `<input type="text" data-path="${esc(f.key)}" value="${esc(value || "")}">`, f.hint);
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
    el.oninput = () => { setAt(entry, el.dataset.path, el.value); touched(sel.doc); };
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

function previewPlan() {
  const sel = state.sel;
  if (!sel) return { hash: "", view: null };
  if (sel.doc === "roles") return { hash: "", view: null };
  if (sel.doc === "guides") return { hash: `audio/${state.lang}`, view: "now", key: sel.id };
  const view = { home: "home", faq: "home" }[sel.section] || sel.section;
  const drill = ["problems", "equipment"].includes(sel.section);
  const unfold = ["flow", "faq"].includes(sel.section);
  return {
    hash: `${sel.doc}/${state.lang}`,
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
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty.length) { e.preventDefault(); e.returnValue = ""; }
});

(async function boot() {
  absorb(await api("/api/guide"));
  renderAll();
})();
