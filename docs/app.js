/* MixerM8 — the Sunday guide.
 *
 * One page, four stations, as many languages as the guide declares, and no
 * build step.
 *
 * ROUTING. A QR code at each station points at a hash:
 *
 *     #audio          the sound desk, in the reader's last language
 *     #audio/ko       the sound desk, in Korean
 *     #livestream/en  the streaming computer, in English
 *     (bare URL)      the station picker, which is the tablet's home screen
 *
 * So the sticker on the wall decides the station and the language. A
 * volunteer who reads Korean scans a different code from the one next to
 * it and never touches a setting.
 *
 * LANGUAGES. Which ones exist is content, not code: roles.json declares
 * them in `languages` and everything here is generated from that list, so
 * adding one is an edit in `mixerm8 --edit` rather than a release. The
 * app's own words -- tab names, badges, the connection messages -- are
 * content too, in data/ui.json, because a station added in a third
 * language would otherwise read half in that language and half in English.
 *
 * SHAPE. Picker -> station home -> a tab. The station home is the landing
 * view: it orients someone who has never been in the booth, and it is
 * entirely static, so it renders the same whether or not a bridge answered.
 * The Mixer tab is never the landing view, for the same reason.
 *
 * MODES. The same files serve two purposes and detect which they are in:
 *   bridge    - served by the Windows bridge on the LAN; the sound station
 *               additionally follows whatever screen the mixer is showing
 *   reference - served by GitHub Pages; everything except the live follow
 * All URLs are relative, so this works at "/" and at "/mixerm8/" alike.
 *
 * CONTENT. Nothing a volunteer reads is in this file. It comes from
 * data/*.json, and a church's own wording comes from a gitignored
 * data/*.local.json which is preferred when it exists. See loadData().
 */

/* What a language calls itself, for the segment button. Chrome rather than
 * content, like ICONS below: roles.json need only name a code, and a code
 * this table has never heard of falls back to its own uppercase -- readable,
 * if plain, and overridable by giving the entry an explicit `label`. */
const LANGUAGE_NAMES = {
  ar: "العربية", de: "Deutsch", en: "EN", es: "Español", fa: "فارسی",
  fr: "Français", hi: "हिन्दी", id: "Bahasa", it: "Italiano", ja: "日本語",
  ko: "한국어", nl: "Nederlands", pl: "Polski", pt: "Português",
  ru: "Русский", sw: "Kiswahili", tl: "Tagalog", tr: "Türkçe",
  uk: "Українська", vi: "Tiếng Việt", "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

/* roles.json may name a language either way round: "es" on its own, or
 * { "id": "es", "label": "Español" } when the endonym above is wrong or
 * absent. Both end up here as {id, label}. An empty or missing list means
 * English alone, which is the one thing every copy of this file can read. */
function normLangs(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const id = (typeof item === "string" ? item : item?.id || "").trim();
    if (!id || out.some((l) => l.id === id)) continue;
    const label = (typeof item === "object" && item?.label) || LANGUAGE_NAMES[id] || id.toUpperCase();
    out.push({ id, label });
  }
  return out.length ? out : [{ id: "en", label: "EN" }];
}

/* Station icons. These are chrome rather than content, so they live here and
 * roles.json only names one. They inherit the station's accent through
 * currentColor. A role naming an icon that is not here is caught by the
 * test suite, not discovered by a volunteer looking at an empty square. */
const ICONS = {
  fader:    '<path d="M6 3v18M12 3v18M18 3v18"/><path d="M3.4 15.5h5.2M9.4 8.5h5.2M15.4 12.5h5.2" stroke-width="3"/>',
  screen:   '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 17.5v3"/>',
  camera:   '<rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="M15.5 10.6l6-3.6v10l-6-3.6z"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.8 2.8 0 1 1 3.6 3.4c-.6.2-.9.7-.9 1.3v.5"/><path d="M12 17.7h.01" stroke-width="2.5"/>',
};

const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  (ICONS[name] || "") + `</svg>`;

/* The app's own words used to be a dictionary here. They are content now,
 * in data/ui.json, for one reason: a station added in a third language
 * would otherwise read half in that language and half in English, and the
 * one thing this file must never do is make a volunteer guess.
 *
 * FALLBACK. English alone, and only the sentences that say the guide did
 * not load -- which is the one moment ui.json cannot be trusted to be
 * there. Everything else comes from the file. */
const FAILED_UI = {
  failTitle: { en: "The guide did not load" },
  failBody:  { en: "{what} could not be fetched, so there is nothing to show." },
  failDo:    { en: "Reload the page. If it keeps happening, tell whoever set this up." },
  failState: { en: "No content" },
};

const state = {
  roles: null,
  role: null,        // the role object from roles.json
  data: null,        // that role's home text, questions, and layers
  guides: null,      // console screen guides, sound station only
  ui: FAILED_UI,     // the app's own words, from data/ui.json
  langs: normLangs(null),   // {id, label} per language roles.json declares
  cache: {},         // role id -> loaded content
  local: false,      // is any loaded file this church's own copy?
  bridge: false,
  snap: null,
  connecting: false, // a Connect press, held long enough to be seen
  follow: true,
  view: "pick",
  problem: null,     // index of an open problem
  gear: null,        // index of an open equipment page
  page: null,        // index of an open training page
  pinned: null,      // a console guide opened by hand
  flowOpen: false,   // has the reader asked for every step at once?
  jump: null,        // { section, id } a link is on its way to
  reveal: null,      // id of a collapsed card to open and scroll to
  ticks: new Set(),
  lang: "en",        // the id of the language on screen, not an index
};

/* ---------- tiny persistence, best-effort ---------- */
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem("mixerm8." + k); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem("mixerm8." + k, JSON.stringify(v)); } catch { /* private mode */ }
  },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- wording, as the tablet shows it ----------
 *
 * Escaped first, always. Everything below runs on the escaped string, so
 * no amount of markup in a guide file can put a tag on the page that is
 * not one of the handful written here.
 *
 * A run of four or more underscores is a blank nobody has filled in yet.
 * It is shown as a gap rather than guessed at: a volunteer who reads
 * "select ____" asks someone, where one who reads an invented scene name
 * loads the wrong scene in the middle of a service. */
const BLANK = /_{4,}/g;

/* `**bold**`, `*italic*` and `[label](target)`. Asterisks rather than
 * underscores for the emphasis, because four underscores already mean
 * something here and the two conventions would collide in the one place
 * it matters least to be ambiguous. */
const EMPHASIS = [[/\*\*([^*]+)\*\*/g, "<b>$1</b>"], [/\*([^*]+)\*/g, "<i>$1</i>"]];
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const OPENABLE = ["http", "https", "mailto"];

const emphasise = (html) =>
  EMPHASIS.reduce((acc, [re, tag]) => acc.replace(re, tag), html);

/* One link, or null for a target a tablet would not open -- in which case
 * the caller leaves the original text alone, so a mistake reads as the
 * words somebody typed rather than vanishing.
 *
 * An internal link carries its target in a data attribute and no href.
 * That is deliberate: the hash addresses a station and a language and
 * nothing deeper, because it is what a QR sticker says. A "see also"
 * inside the guide is navigation, not an address, so it does not need to
 * be one. */
function link(label, target) {
  const scheme = SCHEME.exec(target);
  if (scheme) {
    if (!OPENABLE.includes(scheme[1].toLowerCase())) return null;
    return `<a class="out" href="${target}" target="_blank" rel="noopener">` +
           `${emphasise(label)}</a>`;
  }
  return `<a class="jump" role="button" tabindex="0" data-to="${target}">` +
         `${emphasise(label)}</a>`;
}

function fill(s) {
  let html = esc(s).replace(BLANK, '<span class="blank">____</span>');

  // Links are lifted out before the emphasis pass and put back after, so
  // an asterisk inside a URL cannot turn half of it italic.
  const held = [];
  html = html.replace(LINK, (whole, label, target) => {
    const anchor = link(label, target);
    if (!anchor) return whole;
    held.push(anchor);
    return `\u0000${held.length - 1}\u0000`;
  });
  return emphasise(html).replace(/\u0000(\d+)\u0000/g, (m, i) => held[Number(i)]);
}

/* Which language to read a block in, and what to read instead when it is
 * not written yet: the one on screen first, then the rest in declared
 * order. A gap is a content bug -- `validate.py` fails a declared language
 * that is missing anywhere -- so this chain is a safety net rather than a
 * feature. It exists because a card in the wrong language is still a card
 * somebody can act on, and an empty one is not. */
const langs = () => [state.lang, ...state.langs.map((l) => l.id).filter((id) => id !== state.lang)];

/* One language of a block, as plain text. */
const one = (node) => (node ? langs().map((l) => node[l]).filter(Boolean)[0] || "" : "");

/* Fill {n}-style placeholders. The app supplies the numbers; the wording
 * around them is somebody's to translate, so it stays in ui.json. */
const fmt = (text, vars) =>
  String(text).replace(/\{(\w+)\}/g, (m, k) => (k in (vars || {}) ? String(vars[k]) : m));

/* One of the app's own words, from data/ui.json. */
const t1 = (key, vars) => (vars ? fmt(one(state.ui[key]), vars) : one(state.ui[key]));

/* A ui.json string as a block, for the places that hand a whole {title,
 * body} pair to card(). Keyed on the language on screen rather than on
 * "en", so a guide that never declares English still resolves. */
const u = (key, vars) => ({ [state.lang]: t1(key, vars) });

/* A block as one escaped-and-filled HTML line. There used to be a second
 * line here for the EN+KO reading, which is gone: two languages stacked in
 * every card pushed the thing somebody needed off the bottom of a tablet,
 * and the segment in the header was always one tap away anyway. */
function lines(node, cls = "") {
  if (!node) return "";
  const text = one(node);
  return text ? `<div class="${cls}">${fill(text)}</div>` : "";
}

function todo(entry) {
  if (!entry?.todo) return "";
  const body = lines(entry.todo);
  return body ? `<div class="todo" role="note">${body}</div>` : "";
}

/* ---------- diagrams ----------
 * A picture is optional decoration around wording that has to stand alone:
 * every diagram sits next to text that says the same thing, because the
 * file may simply not be there. A church's own diagrams go in
 * docs/img/local/, which is gitignored for the same reason the wording is.
 * wireDiagrams() hides a figure whose image did not load rather than
 * leaving a broken-image icon on a tablet in a dark booth. */
function diagram(node) {
  if (!node?.src) return "";
  const caption = lines(node.caption, "cap");
  return `<figure class="diagram">` +
         `<img src="${esc(node.src)}" alt="${esc(one(node.alt))}" loading="lazy">` +
         (caption ? `<figcaption>${caption}</figcaption>` : "") +
         `</figure>`;
}

function wireDiagrams(root) {
  (root || document).querySelectorAll("figure.diagram img, figure.diagram video").forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = "1";
    // A church's own media lives on the booth machine, so on the Pages
    // copy it simply is not there. Hiding the figure is right either way:
    // the wording beside it already says the same thing, and a broken
    // player on a tablet in a dark booth says nothing at all.
    el.onerror = () => { el.closest("figure").hidden = true; };
    if (el.tagName === "IMG" && el.complete && el.naturalWidth === 0) {
      el.closest("figure").hidden = true;
    }
  });
}

/* ---------- blocks ----------
 *
 * An entry's fixed fields say what that entry always has to say -- a
 * problem page has a symptom, a piece of equipment has a `where`. `blocks`
 * is everything else, in whatever order somebody put it: a paragraph, a
 * video, a checklist of what was in the video, a set of collapsible steps
 * with a diagram inside one of them.
 *
 * One renderer per type and nothing else knows the list, so adding a type
 * is one entry here and one form in the editor. A type this file has never
 * heard of renders as nothing, which is why `validate.py` refuses one --
 * a silently missing paragraph is the worst way for a guide to be wrong.
 */
const BLOCKS = {
  text: (b) => lines(b.text, "body"),

  media: (b) => media(b),

  /* Borrows the severity colours and the card shape, so "do not change
     this" looks the same here as it does on the console guides. */
  callout: (b) => card({ level: b.level || "info", badge: b.badge !== false,
                         title: b.title, body: b.body, todo: b.todo }),

  /* Tickable, and the ticks live in the same per-station set as the
     Before tab's -- which is why validate.py insists every item id is
     unique across the whole station file. */
  checklist: (b) =>
    `<ol class="checklist blocklist">` + (b.items || []).map((item) => {
      const on = state.ticks.has(item.id);
      return `<li class="${on ? "ticked" : ""}">` +
             `<label><input type="checkbox" data-id="${esc(item.id)}"${on ? " checked" : ""}>` +
             `<span class="box" aria-hidden="true"></span>` +
             `<span class="item">${todo(item)}${lines(item.text, "text")}</span>` +
             `</label></li>`;
    }).join("") + `</ol>`,

  /* Collapsible, one level deep. A step's own content is blocks too, so a
     diagram or a video goes inside the step it belongs to rather than
     above the whole list. */
  steps: (b) =>
    `<ol class="flow">` + (b.items || []).map((item) =>
      `<li${item.todo ? ' class="unfilled"' : ""}>` +
      step({ summary: item.title, aside: one(item.when),
             body: blocks(item.blocks), entry: item }) +
      `</li>`).join("") + `</ol>`,
};

function blocks(list) {
  if (!Array.isArray(list)) return "";
  return list.map((b) => (BLOCKS[b?.type] ? BLOCKS[b.type](b) : "")).join("");
}

/* A picture or a video, from one of three places: something shipping in
 * docs/, something under media/ that the bridge serves off the booth
 * machine, or somebody else's https address. All three are just a URL by
 * the time they get here.
 *
 * A video is never autoplayed and never loops. Somebody is watching this
 * on a tablet in a booth with the service about to start; it plays when
 * they ask it to. */
const VIDEO = /\.(mp4|webm|m4v)(\?|#|$)/i;

function media(node) {
  if (!node?.src) return "";
  const caption = lines(node.caption, "cap");
  const body = VIDEO.test(node.src)
    ? `<video src="${esc(node.src)}" controls preload="metadata" ` +
      `playsinline></video>`
    : `<img src="${esc(node.src)}" alt="${esc(one(node.alt))}" loading="lazy">`;
  return `<figure class="diagram media">` + body +
         (caption ? `<figcaption>${caption}</figcaption>` : "") + `</figure>`;
}

/* ---------- cards (console screen guides) ---------- */

function card(entry, extraClass = "") {
  if (!entry) return "";
  const level = entry.level || "info";
  const badge = t1({ ok: "badgeOk", caution: "badgeCaution",
                     danger: "badgeDanger", info: "badgeInfo" }[level]);

  let html = `<div class="card ${extraClass}" data-level="${level}">`;
  // "Safe" / "Careful" / "Do not change" are about touching the desk. The
  // status cards below borrow the severity colour, which has to keep
  // meaning the same thing everywhere, but a card about the bridge being
  // down is not telling anyone not to change something -- so it opts out
  // of the word and keeps the colour.
  if (entry.badge !== false) html += `<span class="badge">${esc(badge)}</span>`;
  html += `<h2>${esc(one(entry.title))}</h2>`;
  html += todo(entry);
  html += lines(entry.body, "body");
  html += diagram(entry.diagram);
  if (entry.action) html += `<div class="action">${lines(entry.action)}</div>`;
  return html + `</div>`;
}

/* A card whose words are ui.json keys rather than guide content. Same
 * shape, same severity colours; the only difference is where the sentence
 * came from. `vars` fills the {n} in "Tab {n} - not mapped yet". */
function uiCard(level, keys, vars) {
  return card({ level, title: u(keys[0], vars), body: u(keys[1], vars),
                action: keys[2] ? u(keys[2], vars) : null });
}

/* ---------- station picker ---------- */

function renderHero() {
  const hero = state.roles?.hero;
  if (!hero) { $("hero").hidden = true; return; }
  $("hero").hidden = false;
  // The image is optional and may never be supplied; the gradient behind it
  // is the design, not a placeholder waiting to be replaced.
  $("hero").innerHTML =
    (hero.image ? `<figure class="diagram hero-img"><img src="${esc(hero.image)}" alt=""></figure>` : "") +
    `<div class="hero-text"><h1>${esc(one(hero.title))}</h1>` +
    lines(hero.blurb, "blurb") + `</div>`;
  wireDiagrams($("hero"));
}

function renderPick() {
  renderHero();
  $("pick-lede").textContent = t1("pick");
  $("pick").innerHTML = (state.roles?.roles || []).map((r) =>
    `<a class="station" href="#${esc(r.id)}/${esc(state.lang)}" ` +
    `data-theme="${esc(r.theme || "")}" data-role="${esc(r.id)}">` +
    `<span class="station-icon" aria-hidden="true">${icon(r.icon)}</span>` +
    `<span class="station-text">` +
    `<b>${esc(one(r.label) || r.id)}</b>` +
    `<span>${esc(one(r.where))}</span>` +
    `</span></a>`
  ).join("");
}

/* ---------- a station's own front page ---------- */

function renderHome() {
  const d = state.data;
  const r = state.role;

  $("home-intro").innerHTML =
    `<div class="home-head">${icon(r.icon)}` +
    `<div><b>${esc(one(r.label) || r.id)}</b>` +
    `<span>${esc(one(r.where))}</span></div></div>` +
    lines(d.intro, "intro") +
    diagram(d.diagram) +
    blocks(d.blocks);

  // The nav repeats the tab bar in a form that explains itself. Someone who
  // has never been in the booth does not know what "Order" means until they
  // have opened it once; here it says so before they tap.
  const nav = tabsFor(r).filter((tb) => tb.view !== "home");
  $("home-nav").innerHTML = nav.map((tb) =>
    `<button class="navcard" data-view="${tb.view}">` +
    `<b>${esc(t1(tb.key))}</b><span>${esc(t1(tb.nav))}</span></button>`
  ).join("");
  $("home-nav").querySelectorAll(".navcard").forEach((el) => {
    el.onclick = () => setView(el.dataset.view);
  });

  const faq = d.faq || [];
  $("home-faq").innerHTML = faq.length
    ? `<h2 class="section">${esc(t1("faqHead"))}</h2>` +
      faq.map((item) => step({
        summary: item.q,
        body: lines(item.a, "answer") + blocks(item.blocks),
        entry: item,
        cls: "qa",
      })).join("")
    : "";

  wireDiagrams($("view-home"));
  wireTicks($("view-home"));
  revealCard($("view-home"));
}

/* One collapsible card, used by the questions and by the running order.
 * A card carrying an unfilled blank opens by default: hiding a "____"
 * behind a closed summary would make the gap silent, which is the one
 * thing the blanks convention exists to prevent. */
function step({ summary, aside, body, entry, cls = "", open = false }) {
  const start = open || Boolean(entry?.todo);
  return `<details class="step ${cls}"${start ? " open" : ""}` +
         (entry?.id ? ` data-id="${esc(entry.id)}"` : "") + `>` +
         `<summary>` +
         (aside ? `<span class="when">${esc(aside)}</span>` : "") +
         `<span class="step-title">${esc(one(summary))}</span>` +
         `</summary>` +
         `<div class="step-body">${todo(entry)}${body}${diagram(entry?.diagram)}</div>` +
         `</details>`;
}

/* ---------- before the service ---------- */

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadTicks(roleId) {
  // Ticks from last Sunday are worse than no ticks at all, so they expire.
  //
  // Keyed by each step's own id rather than by its position in the list.
  // Position used to be the key, which meant reordering the checklist --
  // one drag in the editor -- silently moved a volunteer's ticks onto
  // different steps. An id from an older install is a number, matches
  // nothing, and reads as unticked, which is the right answer anyway.
  const saved = store.get("ticks." + roleId, null);
  if (!saved || saved.date !== todayStamp()) return new Set();
  return new Set(saved.done);
}

function saveTicks() {
  store.set("ticks." + state.role.id, { date: todayStamp(), done: [...state.ticks] });
}

/* Every tickable box, wherever it came from: the Before tab's own list or
 * a checklist block sitting halfway down a page. One set per station,
 * keyed by the item's id, which is why validate.py insists those ids are
 * unique across the whole station file. */
function wireTicks(root) {
  (root || document).querySelectorAll(".checklist input[type=checkbox]").forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = "1";
    el.onchange = () => {
      const id = el.dataset.id;
      if (el.checked) state.ticks.add(id); else state.ticks.delete(id);
      saveTicks();
      el.closest("li").classList.toggle("ticked", el.checked);
    };
  });
}

function renderChecklist() {
  $("checklist-lede").textContent = t1("ledeCheck");
  $("reset").textContent = t1("reset");
  const items = state.data.checklist || [];

  $("checklist").innerHTML = items.map((item) => {
    const on = state.ticks.has(item.id);
    return `<li class="${on ? "ticked" : ""}">` +
           `<label><input type="checkbox" data-id="${esc(item.id)}"${on ? " checked" : ""}>` +
           `<span class="box" aria-hidden="true"></span>` +
           `<span class="item">${todo(item)}${lines(item.text, "text")}</span></label></li>`;
  }).join("");

  wireTicks($("view-checklist"));
}

/* ---------- something is wrong ---------- */

function renderProblems() {
  $("problems-lede").textContent = t1("ledeProblem");
  const list = state.data.problems || [];

  if (state.problem !== null && list[state.problem]) {
    const p = list[state.problem];
    $("problems").innerHTML = "";
    // Emergency steps are never collapsed. Somebody is reading this while a
    // microphone squeals; a card they have to open first is a card in the way.
    $("problem-detail").innerHTML =
      `<button class="chip" id="pback">${esc(t1("back"))}</button>` +
      `<div class="card" data-level="${p.level || "info"}">` +
      `<h2>${esc(one(p.title))}</h2>` +
      lines(p.symptom, "symptom") +
      todo(p) +
      `<ol class="steps">` +
      (p.steps || []).map((s) => `<li>${lines(s)}</li>`).join("") +
      `</ol>` + diagram(p.diagram) + blocks(p.blocks) + `</div>`;
    $("pback").onclick = () => { state.problem = null; renderProblems(); };
    wireDiagrams($("view-problems"));
    wireTicks($("view-problems"));
    return;
  }

  $("problem-detail").innerHTML = "";
  $("problems").innerHTML = list.map((p, i) =>
    `<button class="tile" data-i="${i}" data-level="${p.level || "info"}">` +
    `<b>${esc(one(p.title))}</b>` +
    `<span>${esc(one(p.symptom).slice(0, 70))}</span></button>`
  ).join("");

  $("problems").querySelectorAll(".tile").forEach((el) => {
    el.onclick = () => {
      state.problem = Number(el.dataset.i);
      renderProblems();
      window.scrollTo(0, 0);
    };
  });
}

/* ---------- running order ---------- */

function renderFlow() {
  $("flow-lede").textContent = t1("ledeFlow");
  $("expand").textContent = t1(state.flowOpen ? "closeAll" : "openAll");
  $("flow").innerHTML = (state.data.flow || []).map((s) =>
    `<li${s.todo ? ' class="unfilled"' : ""}>` +
    step({ summary: s.title, aside: one(s.when),
           body: lines(s.detail, "detail") + blocks(s.blocks),
           entry: s, open: state.flowOpen }) +
    `</li>`
  ).join("");
  wireDiagrams($("view-flow"));
  wireTicks($("view-flow"));
  revealCard($("view-flow"));
}

/* ---------- the gear at this station ----------
 * Same two-step shape as the problem pages: a grid of what is here, then
 * one page about the box you tapped. Audio declares no equipment layer --
 * its Mixer tab already is the sound desk's equipment page, and the boxes
 * behind the desk are not something a volunteer touches. */

function renderEquipment() {
  $("equipment-lede").textContent = t1("ledeEquip");
  const list = state.data.equipment || [];

  if (state.gear !== null && list[state.gear]) {
    const item = list[state.gear];
    $("equipment").innerHTML = "";
    // Not a <details>: there is one card on screen and nothing to collapse
    // it against, and "where is it" is the reason the page was opened.
    $("equipment-detail").innerHTML =
      `<button class="chip" id="gback">${esc(t1("back"))}</button>` +
      `<div class="card" data-level="${item.level || "info"}">` +
      `<h2>${esc(one(item.title))}</h2>` +
      lines(item.where, "spec") +
      todo(item) +
      lines(item.body, "body") +
      diagram(item.diagram) +
      (item.action ? `<div class="action">${lines(item.action)}</div>` : "") +
      blocks(item.blocks) +
      `</div>`;
    $("gback").onclick = () => { state.gear = null; renderEquipment(); };
    wireDiagrams($("view-equipment"));
    wireTicks($("view-equipment"));
    return;
  }

  $("equipment-detail").innerHTML = "";
  $("equipment").innerHTML = list.map((item, i) =>
    `<button class="tile" data-i="${i}" data-level="${item.level || "info"}">` +
    `<b>${esc(one(item.title))}</b>` +
    `<span>${fill(one(item.where).slice(0, 70))}</span></button>`
  ).join("");

  $("equipment").querySelectorAll(".tile").forEach((el) => {
    el.onclick = () => {
      state.gear = Number(el.dataset.i);
      renderEquipment();
      window.scrollTo(0, 0);
    };
  });
}

/* ---------- training and reference ----------
 * The free-form layer. Same two-step shape as the problem pages and the
 * equipment: a list of what is here, then the one you tapped -- except a
 * page's body is entirely blocks, so what is on it is whoever wrote it's
 * business rather than this file's. */

function renderPages() {
  $("pages-lede").textContent = t1("ledePages");
  const list = state.data.pages || [];

  if (state.page !== null && list[state.page]) {
    const page = list[state.page];
    $("pages").innerHTML = "";
    $("pages-detail").innerHTML =
      `<button class="chip" id="wback">${esc(t1("back"))}</button>` +
      `<article class="page">` +
      `<h2>${esc(one(page.title))}</h2>` +
      todo(page) +
      blocks(page.blocks) +
      `</article>`;
    $("wback").onclick = () => { state.page = null; renderPages(); };
    wireDiagrams($("view-pages"));
    wireTicks($("view-pages"));
    return;
  }

  $("pages-detail").innerHTML = "";
  $("pages").innerHTML = list.map((page, i) =>
    `<button class="tile" data-i="${i}" data-level="${page.level || "info"}">` +
    `<b>${esc(one(page.title))}</b>` +
    (page.blurb ? `<span>${esc(one(page.blurb))}</span>` : "") +
    `</button>`
  ).join("");

  $("pages").querySelectorAll(".tile").forEach((el) => {
    el.onclick = () => {
      state.page = Number(el.dataset.i);
      renderPages();
      window.scrollTo(0, 0);
    };
  });
}

/* ---------- the mixer (sound station only) ---------- */

/* The desk reports a number; the guide says which screen that number is.
 *
 * The mapping used to be a dict in console.py, which meant correcting a wrong
 * number needed a new release. It lives on the guide entry now, so it can be
 * fixed in the editor or in a *.local.json, and a scan of sixteen entries is
 * cheaper than a reverse index that could go stale when the editor's preview
 * reloads a draft under us. */
function guideFor(group, n) {
  if (n === null || n === undefined || !state.guides) return null;
  return Object.values(state.guides[group] || {}).find((e) => e.number === n) || null;
}

function renderNow() {
  const box = $("now");
  const where = $("where");
  const s = state.snap;
  const g = state.guides;

  $("follow").checked = state.follow;
  document.querySelector(".follow-row").hidden = !state.bridge;

  // The full screen index sits below, and is useful with or without a bridge.
  if (g) {
    const tile = (key, entry) =>
      `<button class="tile" data-key="${esc(key)}" data-level="${entry.level || "info"}">` +
      `<b>${esc(one(entry.title) || key)}</b></button>`;
    $("screens").innerHTML =
      `<div class="group-head">${esc(t1("ledeMixer"))}</div>` +
      Object.entries(g.pages).map(([k, v]) => tile(k, v)).join("") +
      Object.entries(g.screens).map(([k, v]) => tile(k, v)).join("");
    $("screens").querySelectorAll(".tile").forEach((el) => {
      el.onclick = () => { state.pinned = el.dataset.key; renderNow(); window.scrollTo(0, 0); };
    });
  }

  if (state.pinned) {
    const entry = g.pages[state.pinned] || g.screens[state.pinned];
    where.textContent = "";
    box.innerHTML = card(entry) + `<button class="chip" id="unpin">${esc(t1("back"))}</button>`;
    $("unpin").onclick = () => { state.pinned = null; renderNow(); };
    wireDiagrams($("view-now"));
    return;
  }

  // Without the guide there is nothing to follow the desk with. Say so,
  // rather than throwing on the first lookup and blanking the whole tab.
  if (!g) {
    where.textContent = "";
    box.innerHTML = uiCard("danger", ["guidesTitle", "guidesBody", "guidesDo"]);
    return;
  }

  if (!state.bridge) {
    where.textContent = "";
    box.innerHTML = card({ level: "info", badge: false,
                           title: u("refTitle"), body: u("refBody") });
    return;
  }

  if (!state.follow) {
    where.textContent = "";
    box.innerHTML = uiCard("info", ["offTitle", "offBody"]);
    return;
  }

  // The bridge is up but the desk is not answering. Two different problems
  // wearing one message would send somebody to check a cable that is fine,
  // so they are told apart: a known address that has gone quiet is a desk
  // to switch on, and no address at all is a desk that has never been found.
  if (!s || !s.ok) {
    where.textContent = "";
    box.innerHTML = (s && s.ip
      ? card({ level: "danger", badge: false, title: u("quietTitle"),
               body: u("quietBody"), action: u("quietDo") })
      : card({ level: "caution", badge: false,
               title: u("huntTitle"), body: u("huntBody") }))
      + `<button class="chip wide" id="connect" type="button"` +
        (state.connecting ? " disabled" : "") + `>` +
        esc(t1(state.connecting ? "connecting" : "connect")) + `</button>`;
    // Never disabled by the bridge's own "still searching" flag: that one
    // stays true for as long as nothing answers, and a button that is grey
    // every time you need it is not a button.
    $("connect").onclick = reconnect;
    return;
  }

  // One lookup, used for both the breadcrumb and the card below it. On the
  // channel screen the breadcrumb names the *tab*, because the tab is what
  // changed when the volunteer pressed a button -- and it comes from the
  // guide's own title, so a Korean reader gets a Korean word.
  const n = s.on_channel ? s.page : s.screen;
  const entry = guideFor(s.on_channel ? "pages" : "screens", n);
  const label = entry ? one(entry.title)
                      : (n === null ? ""
                         : t1(s.on_channel ? "crumbTab" : "crumbScreen", { n }));

  let loc = label;
  if (s.on_channel && s.channel) {
    loc += (loc ? " · " : "") + t1("crumbChannel", { n: s.channel }) +
           (s.name ? " — " + s.name : "");
  }
  where.textContent = loc;

  if (entry) {
    box.innerHTML = card(entry);
  } else if (n === null) {
    box.innerHTML = uiCard("info", ["waitTitle", "waitBody"]);
  } else if (s.on_channel) {
    // How a wrong or missing number gets found: the desk names it, somebody
    // writes it down, and the guide it belongs to gets that number.
    box.innerHTML = uiCard("info",
      ["tabUnmappedTitle", "tabUnmappedBody", "tabUnmappedDo"], { n });
  } else {
    box.innerHTML = uiCard("info",
      ["screenUnmappedTitle", "screenUnmappedBody", "screenUnmappedDo"], { n });
  }
  wireDiagrams($("view-now"));
}

/* ---------- chrome ---------- */

function setStatus(kind, label) {
  $("status").dataset.state = kind;
  $("status-text").textContent = label;
}

/* True once the guide could not be loaded at all. It stops the ordinary
 * chrome from writing over the one card that says so. */
let broken = false;

/* Which tabs a station has is declared per role in roles.json, because
 * `misc` is questions and policies with no equipment behind it, and a tab
 * bar offering an empty checklist is worse than no tab. */
function tabsFor(role) {
  const tabs = [{ view: "home", key: "tabHome", nav: "tabHome" }];
  const layers = role.layers || [];
  if (layers.includes("checklist")) tabs.push({ view: "checklist", key: "tabCheck", nav: "navCheck" });
  if (layers.includes("problems")) tabs.push({ view: "problems", key: "tabProblem", nav: "navProblem" });
  if (layers.includes("flow")) tabs.push({ view: "flow", key: "tabFlow", nav: "navFlow" });
  if (layers.includes("equipment")) tabs.push({ view: "equipment", key: "tabEquip", nav: "navEquip" });
  if (layers.includes("pages")) tabs.push({ view: "pages", key: "tabPages", nav: "navPages" });
  // The mixer tab exists for the sound station whether or not a bridge is
  // answering: the screen guides are worth reading on a Tuesday too, and a
  // dead bridge must never take a tab away mid-service.
  if (role.console) tabs.push({ view: "now", key: "tabMixer", nav: "navMixer" });
  return tabs;
}

function renderTabs() {
  const tabs = tabsFor(state.role);
  const nav = $("tabs");
  // One tab is not a choice, so misc gets no tab bar and the extra height
  // goes to the questions instead.
  nav.hidden = tabs.length < 2;
  nav.style.gridTemplateColumns = `repeat(${tabs.length}, 1fr)`;
  nav.dataset.count = String(tabs.length);
  nav.innerHTML = tabs.map((tb) =>
    `<button class="tab" data-view="${tb.view}" role="tab" ` +
    `aria-selected="${state.view === tb.view}">${esc(t1(tb.key))}</button>`
  ).join("");
  nav.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => setView(el.dataset.view);
  });
}

/* One segment per declared language, in the order roles.json lists them.
 * Hidden when there is only one, for the same reason `misc` gets no tab
 * bar: a group of one is not a choice, and the space is worth more to the
 * station name beside it. */
function renderLangs() {
  const box = $("langs");
  box.hidden = state.langs.length < 2;
  box.innerHTML = state.langs.map((l) =>
    `<button class="seg" data-id="${esc(l.id)}" type="button" lang="${esc(l.id)}" ` +
    `aria-pressed="${l.id === state.lang}">${esc(l.label)}</button>`
  ).join("");
  box.querySelectorAll(".seg").forEach((el) => {
    el.onclick = () => setLang(el.dataset.id);
  });
}

function setLang(id) {
  state.lang = id;
  store.set("lang", id);
  // Keep the URL shareable: whatever you are reading, the link carries it.
  if (state.role) location.hash = `${state.role.id}/${id}`;
  else render();
}

const VIEWS = ["pick", "home", "checklist", "problems", "flow", "equipment",
               "pages", "now"];

function setView(view) {
  state.view = view;
  if (view !== "problems") state.problem = null;
  if (view !== "equipment") state.gear = null;
  if (view !== "pages") state.page = null;
  if (view !== "now") state.pinned = null;
  VIEWS.forEach((v) => { $("view-" + v).hidden = v !== view; });
  $("tabs").querySelectorAll(".tab").forEach((el) => {
    el.setAttribute("aria-selected", String(el.dataset.view === view));
  });
  render();
  window.scrollTo(0, 0);
}

function setFoot() {
  const bits = [];
  const seen = state.snap?.seen ?? [];
  if (state.bridge && seen.length) {
    bits.push(t1("footSeen", { list: seen.join(", ") }));
  }
  bits.push(t1(state.local ? "footLocal" : "footExample"));
  if (state.bridge && state.snap?.ip) bits.push(t1("footMixer", { ip: state.snap.ip }));
  bits.push(t1(state.bridge ? "footBridge" : "footReference"));
  $("foot").textContent = bits.join(" · ");
}

function render() {
  if (broken) return;
  document.documentElement.lang = state.lang;
  renderLangs();
  showStatus();
  // Two labels sit in index.html rather than in a rendered block, so they
  // are the only ones that need writing over by hand.
  $("follow-label").textContent = t1("followLabel");
  $("reset").textContent = t1("reset");

  if (state.view === "pick" || !state.role) {
    // The picker belongs to no station, so it wears the neutral palette.
    delete document.documentElement.dataset.theme;
    $("back").hidden = true;
    $("tabs").hidden = true;
    $("brand-text").textContent = "MixerM8";
    renderPick();
  } else {
    document.documentElement.dataset.theme = state.role.theme || "";
    $("back").hidden = false;
    $("brand-text").textContent = one(state.role.label) || state.role.id;
    renderTabs();
    if (state.view === "home") renderHome();
    if (state.view === "checklist") renderChecklist();
    if (state.view === "problems") renderProblems();
    if (state.view === "flow") renderFlow();
    if (state.view === "equipment") renderEquipment();
    if (state.view === "pages") renderPages();
    if (state.view === "now") renderNow();
  }
  setFoot();
}

/* ---------- following a link inside the guide ----------
 *
 * A link says "audio/problems/a-squeal-or-a-howl": a station, optionally a
 * tab, optionally one entry. Crossing to another station goes through the
 * hash, because that is what makes route() load the other station's file --
 * but only ever as `#station/language`, so the two-segment rule the QR
 * stickers rest on still holds. Which entry to open travels in
 * `state.jump` instead, and is applied once the content is there.
 */
function goTo(target) {
  const [rid, section, id] = String(target || "").split("/");
  const role = (state.roles?.roles || []).find((r) => r.id === rid);
  if (!role) return;

  state.jump = section ? { section, id } : null;
  if (state.role?.id !== rid) {
    location.hash = `${rid}/${state.lang}`;
    return;                     // route() runs on the hashchange, then jumps
  }
  applyJump();
}

function applyJump() {
  const jump = state.jump;
  state.jump = null;
  if (!jump || !state.role) return;

  // The questions live on the station's front page rather than in a tab of
  // their own, so a link to one lands on Home with that card open.
  const view = jump.section === "faq" ? "home" : jump.section;
  if (!tabsFor(state.role).some((tb) => tb.view === view)) return;

  const list = (state.data || {})[jump.section] || [];
  const at = jump.id ? list.findIndex((e) => e.id === jump.id) : -1;
  state.problem = view === "problems" && at >= 0 ? at : null;
  state.gear = view === "equipment" && at >= 0 ? at : null;
  state.page = view === "pages" && at >= 0 ? at : null;
  // The running order and the questions are <details> cards, so the one
  // being linked to is opened where it sits rather than replacing the page.
  state.reveal = at >= 0 && ["flow", "faq"].includes(jump.section) ? jump.id : null;
  setView(view);
}

/* Open the card a link arrived at and put it on screen. Cleared as it
 * fires, so scrolling away and coming back does not drag you here again. */
function revealCard(root) {
  if (!state.reveal) return;
  const card = (root || document).querySelector(`details[data-id="${CSS.escape(state.reveal)}"]`);
  state.reveal = null;
  if (!card) return;
  card.open = true;
  card.scrollIntoView({ block: "center" });
}

/* ---------- content loading ---------- */

async function loadData(name) {
  /* Prefer this church's own copy, fall back to the shipped example.
   *
   * The .local.json is gitignored, so it is absent on GitHub Pages and the
   * first fetch simply 404s there. The bridge maps it to an override folder
   * on the media computer, so a media director can edit the wording without
   * touching git at all. */
  for (const file of [`data/${name}.local.json`, `data/${name}.json`]) {
    try {
      const r = await fetch(file, { cache: "no-cache" });
      if (!r.ok) continue;
      return { data: await r.json(), local: file.includes(".local.") };
    } catch { /* try the next one */ }
  }
  throw new Error(`could not load data/${name}.json`);
}

/* The one path that cannot trust data/ui.json, because a failure to load
 * it is one of the things this says. So it reads FAILED_UI instead --
 * English, and four sentences long. */
function failed(what) {
  $("hero").hidden = true;
  state.ui = { ...FAILED_UI, ...state.ui };
  $("pick").innerHTML = uiCard("danger", ["failTitle", "failBody", "failDo"], { what });
  setStatus("offline", t1("failState"));
  broken = true;
}

async function ensureRole(role) {
  if (state.cache[role.id]) return state.cache[role.id];
  const got = await loadData(role.id);
  state.cache[role.id] = got.data;
  if (got.local) state.local = true;
  if (role.console && !state.guides) {
    try {
      const g = await loadData("guides");
      state.guides = g.data;
      if (g.local) state.local = true;
    } catch { state.guides = null; }
  }
  return got.data;
}

/* ---------- routing ---------- */

async function route() {
  const parts = location.hash.replace(/^#/, "").split("/").filter(Boolean);
  const [roleId, langId] = parts;

  if (state.langs.some((l) => l.id === langId)) {
    state.lang = langId;
    store.set("lang", langId);
  }

  const role = (state.roles?.roles || []).find((r) => r.id === roleId);
  if (!role) {
    state.role = null;
    setView("pick");
    return;
  }

  // Changing station is a fresh start; changing only the language is not,
  // so cycling EN/KO does not kick you back to the top of the checklist.
  const switched = state.role?.id !== role.id;
  if (switched) {
    state.problem = null;
    state.gear = null;
    state.page = null;
    state.pinned = null;
    state.view = "home";
  }

  state.role = role;
  state.ticks = loadTicks(role.id);
  try {
    state.data = await ensureRole(role);
  } catch {
    failed(`The guide for "${role.id}"`);
    state.role = null;
    setView("pick");
    return;
  }

  // The station's own front page is the landing view, and the Mixer tab
  // never is: a station has to work when the bridge is down, so the first
  // thing a volunteer sees must not depend on a UDP reply.
  if (state.jump) {
    applyJump();
    return;
  }

  const keep = VIEWS.includes(state.view) && state.view !== "pick";
  const offered = tabsFor(role).some((tb) => tb.view === state.view);
  setView(keep && offered ? state.view : "home");
}

/* ---------- live connection ---------- */

/* Three things can be wrong at once and they are not the same thing:
 * no bridge (this is the Pages copy), a bridge that has never found a desk,
 * and a desk that was found and has gone quiet. The pill says which. */
function showStatus() {
  if (broken) return;
  const s = state.snap;
  if (!state.bridge) return setStatus("ref", t1("stateReference"));
  if (s?.ok) return setStatus("live", t1("stateFollowing"));
  if (state.connecting || s?.searching) return setStatus("waiting", t1("stateLooking"));
  setStatus("waiting", t1("stateNoMixer"));
}

function connect() {
  const src = new EventSource("events");
  src.onmessage = (e) => {
    state.bridge = true;
    state.snap = JSON.parse(e.data);
    showStatus();
    if (state.view === "now") renderNow();
    setFoot();
  };
  src.onerror = () => {
    // The browser reconnects an EventSource by itself; this only says so.
    if (state.bridge) setStatus("offline", t1("stateReconnecting"));
  };
}

/* The Connect button. The bridge hunts on its own too, on a backoff, but
 * a volunteer walking in wants it to happen now rather than within thirty
 * seconds -- and wants to see that pressing it did something. */
async function reconnect() {
  state.connecting = true;
  renderNow();
  showStatus();
  try {
    const r = await fetch("reconnect", { method: "POST", cache: "no-store" });
    if (r.ok) state.snap = await r.json();
  } catch { /* the stream already reports a bridge that went away */ }
  // A broadcast and its reply take about a second. Holding the label for
  // longer than that is deliberate: a button that snapped back instantly
  // would read as having done nothing at all.
  setTimeout(() => {
    state.connecting = false;
    if (state.view === "now") renderNow();
    showStatus();
    setFoot();
  }, 2500);
}

/* A remembered language, if it is still one this guide offers. Falls back
 * to the first declared one -- which is also what an old install stored as
 * an index rather than an id, and what the retired "EN·KO" segment becomes. */
function rememberedLang() {
  const saved = store.get("lang", null);
  return state.langs.some((l) => l.id === saved) ? saved : state.langs[0].id;
}

async function boot() {
  state.follow = store.get("follow", true);

  try {
    const got = await loadData("roles");
    state.roles = got.data;
    if (got.local) state.local = true;
    state.langs = normLangs(got.data.languages);
  } catch {
    failed("The station list");
    return;
  }

  // The app's own words. A separate file rather than a block inside
  // roles.json, so a church can translate the chrome in the editor and
  // override it in a *.local.json exactly like the rest of the guide.
  try {
    const got = await loadData("ui");
    state.ui = got.data.strings || {};
    if (got.local) state.local = true;
  } catch {
    failed("The app's own wording");
    return;
  }

  state.lang = rememberedLang();

  // Is a bridge serving us, or is this the Pages copy?
  try {
    const r = await fetch("state", { cache: "no-store" });
    if (!r.ok) throw new Error("no bridge");
    state.snap = await r.json();
    state.bridge = true;
    connect();
  } catch {
    state.bridge = false;
  }
  showStatus();

  await route();
}

/* ---------- wiring ---------- */

window.addEventListener("hashchange", route);

// Every internal link in the guide, in one place: the cards are rebuilt
// constantly, so binding each anchor as it appears would be a lot of
// wiring for one behaviour. Enter works too, since these carry no href
// and a keyboard user gets nothing from the browser for free.
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a.jump");
  if (!a) return;
  e.preventDefault();
  goTo(a.dataset.to);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const a = e.target.closest?.("a.jump");
  if (!a) return;
  e.preventDefault();
  goTo(a.dataset.to);
});

// One step up the hierarchy, not straight out of it: from a tab back to the
// station's front page, and only from there back to the station list.
$("back").onclick = () => {
  if (state.role && state.view !== "home") { setView("home"); return; }
  state.role = null;
  state.view = "pick";
  location.hash = "";
  setView("pick");
};

$("expand").onclick = () => {
  state.flowOpen = !state.flowOpen;
  renderFlow();
};

$("follow").onchange = (e) => {
  state.follow = e.target.checked;
  store.set("follow", state.follow);
  state.pinned = null;
  renderNow();
};

$("reset").onclick = () => {
  state.ticks = new Set();
  saveTicks();
  renderChecklist();
};

boot();
