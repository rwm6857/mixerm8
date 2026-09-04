/* MixerM8 — the Sunday guide.
 *
 * One page, four stations, two languages, and no build step.
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

const LANGS = [
  { id: "en",   label: "EN",     show: ["en"],       html: "en" },
  { id: "ko",   label: "한국어",  show: ["ko"],       html: "ko" },
  { id: "both", label: "EN·KO",  show: ["en", "ko"], html: "en" },
];

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

/* The page's own furniture. Content lives in data/*.json; these are the
 * handful of words the shell needs before any content has loaded. */
const UI = {
  pick:       { en: "Which station are you on today?", ko: "오늘 어느 자리에서 봉사하시나요?" },
  tabHome:    { en: "Home", ko: "홈" },
  faqHead:    { en: "Questions people ask", ko: "자주 묻는 질문" },
  openAll:    { en: "Open every step",  ko: "모두 펼치기" },
  closeAll:   { en: "Close every step", ko: "모두 접기" },
  reset:      { en: "Clear the ticks", ko: "체크 지우기" },
  back:       { en: "← Back", ko: "← 뒤로" },
  next:       { en: "Next", ko: "다음" },
  done:       { en: "All done.", ko: "모두 완료했습니다." },
};

/* What a page says before anyone has written its own lede. A page can
 * override this, and most of the shipped ones do; a page somebody added
 * this morning gets something sensible rather than a blank strip. */
const LEDE = {
  checklist: { en: "Work down the list. Ticks clear themselves each day.",
               ko: "위에서부터 하나씩 하세요. 체크는 매일 자동으로 지워집니다." },
  problems:  { en: "Tap whatever matches what you are hearing.",
               ko: "지금 들리는 상황에 맞는 항목을 누르세요." },
  flow:      { en: "Tap a step to open it.", ko: "각 단계를 눌러 펼치세요." },
  equipment: { en: "Tap a box to read what it does and where it is.",
               ko: "장비를 눌러 무슨 역할을 하고 어디에 있는지 확인하세요." },
  cards:     { en: "", ko: "" },
  mixer:     { en: "Every screen on the desk, and what it does.",
               ko: "콘솔의 모든 화면과 그 기능입니다." },
};

/* Which <section> draws each kind of page. Two pages of the same kind share
 * a section and are told apart by the page they are handed, so a station can
 * have two checklists without the app growing a second checklist view. */
const DRAWN_BY = {
  checklist: "checklist", problems: "problems", flow: "flow",
  equipment: "equipment", cards: "cards", mixer: "now",
};

const state = {
  roles: null,
  role: null,        // the role object from roles.json
  data: null,        // that role's home text, questions and pages
  guides: null,      // console screen guides, sound station only
  cache: {},         // role id -> loaded content
  local: false,      // is any loaded file this church's own copy?
  bridge: false,
  snap: null,
  lang: 0,
  follow: true,
  page: "pick",      // "pick", "home", or the id of a page in this station
  open: null,        // index of the item opened on a drill-down page
  pinned: null,      // a console guide opened by hand
  flowOpen: false,   // has the reader asked for every step at once?
  ticks: new Set(),
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

/* A run of four or more underscores is a blank nobody has filled in yet.
 * It is shown as a gap rather than guessed at: a volunteer who reads
 * "select ____" asks someone, where one who reads an invented scene name
 * loads the wrong scene in the middle of a service. */
/* Inline emphasis, written into the wording itself:
 *
 *     **bold**      *italic*      ++underline++
 *
 * Deliberately not `_underscores_`: four or more of those already mean an
 * unfilled blank, and one character cannot carry both conventions without
 * the guide occasionally underlining a gap instead of showing it. Applied
 * after esc(), so the only tags that can reach the page are these three. */
const RICH = [
  [/\*\*([^*\n]+)\*\*/g, "<b>$1</b>"],
  [/\*([^*\n]+)\*/g, "<i>$1</i>"],
  [/\+\+([^+\n]+)\+\+/g, "<u>$1</u>"],
];

const fill = (s) => {
  let out = esc(s).replace(/_{4,}/g, '<span class="blank">____</span>');
  for (const [pattern, tag] of RICH) out = out.replace(pattern, tag);
  return out;
};

const langs = () => LANGS[state.lang].show;
const t = (key) => langs().map((l) => UI[key]?.[l]).filter(Boolean);
const t1 = (key) => t(key)[0] || "";

/* The first available language of an {en, ko} block, as plain text. */
const one = (node) => (node ? langs().map((l) => node[l]).filter(Boolean)[0] || "" : "");
const two = (node) => (node ? langs().map((l) => node[l]).filter(Boolean)[1] || "" : "");

/* Both languages of a {en, ko} block, as escaped-and-filled HTML lines. */
function lines(node, cls = "") {
  if (!node) return "";
  return langs().map((l, i) =>
    node[l] ? `<div class="${i > 0 ? "ko " + cls : cls}">${fill(node[l])}</div>` : ""
  ).join("");
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
  (root || document).querySelectorAll("figure.diagram img").forEach((img) => {
    if (img.dataset.wired) return;
    img.dataset.wired = "1";
    img.onerror = () => { img.closest("figure").hidden = true; };
    if (img.complete && img.naturalWidth === 0) img.closest("figure").hidden = true;
  });
}

const BADGE = { ok: "Safe", caution: "Careful", danger: "Do not change", info: "Note" };

/* ---------- cards (console screen guides) ---------- */

function card(entry, extraClass = "") {
  if (!entry) return "";
  const level = entry.level || "info";
  const badge = BADGE[level];

  let html = `<div class="card ${extraClass}" data-level="${level}">`;
  html += `<span class="badge">${esc(badge)}</span>`;
  html += `<h2>${esc(one(entry.title))}</h2>`;
  html += todo(entry);
  html += lines(entry.body, "body");
  html += diagram(entry.diagram);
  if (entry.action) html += `<div class="action">${lines(entry.action)}</div>`;
  return html + `</div>`;
}

function plainCard(level, title, body, action) {
  return card({ level, title: { en: title }, body: { en: body }, action: action ? { en: action } : null });
}

/* ---------- pages ----------
 * A station's tabs are its `pages`, in the order they are written, named by
 * whatever they are named in the file. Home is not one of them on purpose:
 * it is what a QR sticker lands on, so it cannot be reordered away, hidden
 * or deleted. Everything else is the guide's own business. */

/* A page earns a tab when it is not hidden and has something in it. That
 * second half is why adding a page no longer breaks the guide: a half-built
 * page is invisible until it is worth reading, so somebody can add one on a
 * Tuesday and fill it in over three Sundays. */
function visiblePages() {
  return (state.data?.pages || []).filter((pg) =>
    !pg.hidden && (pg.kind === "mixer" ? state.role?.console : (pg.items || []).length));
}

function pageById(id) {
  return (state.data?.pages || []).find((pg) => pg.id === id) || null;
}

function currentPage() {
  return pageById(state.page);
}

function homeLabel() {
  return state.data?.home?.label || UI.tabHome;
}

/* Home first, then the station's own pages. */
function tabs() {
  return [{ id: "home", label: homeLabel(), blurb: state.data?.home?.blurb },
          ...visiblePages()];
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
    (two(hero.title) ? `<h1 class="ko">${esc(two(hero.title))}</h1>` : "") +
    lines(hero.blurb, "blurb") + `</div>`;
  wireDiagrams($("hero"));
}

function renderPick() {
  renderHero();
  $("pick-lede").textContent = t1("pick");
  $("pick").innerHTML = (state.roles?.roles || []).map((r) =>
    `<a class="station" href="#${esc(r.id)}/${LANGS[state.lang].id}" ` +
    `data-theme="${esc(r.theme || "")}" data-role="${esc(r.id)}">` +
    `<span class="station-icon" aria-hidden="true">${icon(r.icon)}</span>` +
    `<span class="station-text">` +
    `<b>${esc(one(r.label) || r.id)}</b>` +
    (two(r.label) ? `<b class="ko">${esc(two(r.label))}</b>` : "") +
    `<span>${esc(one(r.where))}</span>` +
    (two(r.where) ? `<span class="ko">${esc(two(r.where))}</span>` : "") +
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
    diagram(d.diagram);

  // The nav repeats the tab bar in a form that explains itself. Someone who
  // has never been in the booth does not know what "Order" means until they
  // have opened it once; here it says so before they tap.
  $("home-nav").innerHTML = visiblePages().map((pg) =>
    `<button class="navcard" data-page="${esc(pg.id)}">` +
    `<b>${esc(one(pg.label))}</b><span>${esc(one(pg.blurb))}</span></button>`
  ).join("");
  $("home-nav").querySelectorAll(".navcard").forEach((el) => {
    el.onclick = () => setPage(el.dataset.page);
  });

  const faq = d.faq || [];
  $("home-faq").innerHTML = faq.length
    ? `<h2 class="section">${esc(t1("faqHead"))}</h2>` +
      faq.map((item) => step({
        summary: item.q,
        body: lines(item.a, "answer"),
        entry: item,
        cls: "qa",
      })).join("")
    : "";

  wireDiagrams($("view-home"));
}

/* One collapsible card, used by the questions and by the running order.
 * A card carrying an unfilled blank opens by default: hiding a "____"
 * behind a closed summary would make the gap silent, which is the one
 * thing the blanks convention exists to prevent. */
function step({ summary, aside, body, entry, cls = "", open = false }) {
  const start = open || Boolean(entry?.todo);
  return `<details class="step ${cls}"${start ? " open" : ""}>` +
         `<summary>` +
         (aside ? `<span class="when">${esc(aside)}</span>` : "") +
         `<span class="step-title">${esc(one(summary))}</span>` +
         (two(summary) ? `<span class="step-title ko">${esc(two(summary))}</span>` : "") +
         `</summary>` +
         `<div class="step-body">${todo(entry)}${body}${diagram(entry?.diagram)}</div>` +
         `</details>`;
}

/* ---------- before the service ---------- */

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function tickKey() {
  return `ticks.${state.role.id}.${state.page}`;
}

function loadTicks() {
  // Ticks from last Sunday are worse than no ticks at all, so they expire.
  const saved = store.get(tickKey(), null);
  if (!saved || saved.date !== todayStamp()) return new Set();
  return new Set(saved.done);
}

function saveTicks() {
  store.set(tickKey(), { date: todayStamp(), done: [...state.ticks] });
}

function lede(pg) {
  return one(pg.lede) || one(LEDE[pg.kind]);
}

function renderChecklist(pg) {
  $("checklist-lede").textContent = lede(pg);
  $("reset").textContent = t1("reset");
  const items = pg.items || [];

  $("checklist").innerHTML = items.map((item, i) => {
    const on = state.ticks.has(i);
    return `<li class="${on ? "ticked" : ""}">` +
           `<label><input type="checkbox" data-i="${i}"${on ? " checked" : ""}>` +
           `<span class="box" aria-hidden="true"></span>` +
           `<span class="item">${todo(item)}${lines(item.text, "text")}</span></label></li>`;
  }).join("");

  $("checklist").querySelectorAll("input[type=checkbox]").forEach((el) => {
    el.onchange = () => {
      const i = Number(el.dataset.i);
      if (el.checked) state.ticks.add(i); else state.ticks.delete(i);
      saveTicks();
      el.closest("li").classList.toggle("ticked", el.checked);
    };
  });
}

/* ---------- something is wrong ---------- */

function renderProblems(pg) {
  $("problems-lede").textContent = lede(pg);
  const list = pg.items || [];

  if (state.open !== null && list[state.open]) {
    const p = list[state.open];
    $("problems").innerHTML = "";
    // Emergency steps are never collapsed. Somebody is reading this while a
    // microphone squeals; a card they have to open first is a card in the way.
    $("problem-detail").innerHTML =
      `<button class="chip" id="pback">${esc(t1("back"))}</button>` +
      `<div class="card" data-level="${p.level || "info"}">` +
      `<h2>${esc(one(p.title))}</h2>` +
      (two(p.title) ? `<h2 class="ko">${esc(two(p.title))}</h2>` : "") +
      lines(p.symptom, "symptom") +
      todo(p) +
      `<ol class="steps">` +
      (p.steps || []).map((s) => `<li>${lines(s)}</li>`).join("") +
      `</ol>` + diagram(p.diagram) + `</div>`;
    $("pback").onclick = () => { state.open = null; renderProblems(pg); };
    wireDiagrams($("view-problems"));
    return;
  }

  $("problem-detail").innerHTML = "";
  $("problems").innerHTML = list.map((p, i) =>
    `<button class="tile" data-i="${i}" data-level="${p.level || "info"}">` +
    `<b>${esc(one(p.title))}</b>` +
    (two(p.title) ? `<b class="ko">${esc(two(p.title))}</b>` : "") +
    `<span>${esc(one(p.symptom).slice(0, 70))}</span></button>`
  ).join("");

  $("problems").querySelectorAll(".tile").forEach((el) => {
    el.onclick = () => {
      state.open = Number(el.dataset.i);
      renderProblems(pg);
      window.scrollTo(0, 0);
    };
  });
}

/* ---------- running order ---------- */

function renderFlow(pg) {
  $("flow-lede").textContent = lede(pg);
  $("expand").textContent = t1(state.flowOpen ? "closeAll" : "openAll");
  $("flow").innerHTML = (pg.items || []).map((s) =>
    `<li${s.todo ? ' class="unfilled"' : ""}>` +
    step({ summary: s.title, aside: one(s.when), body: lines(s.detail, "detail"),
           entry: s, open: state.flowOpen }) +
    `</li>`
  ).join("");
  wireDiagrams($("view-flow"));
}

/* ---------- the gear at this station ----------
 * Same two-step shape as the problem pages: a grid of what is here, then
 * one page about the box you tapped. Audio declares no equipment layer --
 * its Mixer tab already is the sound desk's equipment page, and the boxes
 * behind the desk are not something a volunteer touches. */

function renderEquipment(pg) {
  $("equipment-lede").textContent = lede(pg);
  const list = pg.items || [];

  if (state.open !== null && list[state.open]) {
    const item = list[state.open];
    $("equipment").innerHTML = "";
    // Not a <details>: there is one card on screen and nothing to collapse
    // it against, and "where is it" is the reason the page was opened.
    $("equipment-detail").innerHTML =
      `<button class="chip" id="gback">${esc(t1("back"))}</button>` +
      `<div class="card" data-level="${item.level || "info"}">` +
      `<h2>${esc(one(item.title))}</h2>` +
      (two(item.title) ? `<h2 class="ko">${esc(two(item.title))}</h2>` : "") +
      lines(item.where, "spec") +
      todo(item) +
      lines(item.body, "body") +
      diagram(item.diagram) +
      (item.action ? `<div class="action">${lines(item.action)}</div>` : "") +
      `</div>`;
    $("gback").onclick = () => { state.open = null; renderEquipment(pg); };
    wireDiagrams($("view-equipment"));
    return;
  }

  $("equipment-detail").innerHTML = "";
  $("equipment").innerHTML = list.map((item, i) =>
    `<button class="tile" data-i="${i}" data-level="${item.level || "info"}">` +
    `<b>${esc(one(item.title))}</b>` +
    (two(item.title) ? `<b class="ko">${esc(two(item.title))}</b>` : "") +
    `<span>${fill(one(item.where).slice(0, 70))}</span></button>`
  ).join("");

  $("equipment").querySelectorAll(".tile").forEach((el) => {
    el.onclick = () => {
      state.open = Number(el.dataset.i);
      renderEquipment(pg);
      window.scrollTo(0, 0);
    };
  });
}

/* ---------- a page of plain cards ----------
 * The general case. Checklists, problem pages and equipment are all this
 * with a particular job; `cards` is what is left when a page does not have
 * one -- a contact sheet, a policy, a page of photos of the room. */

function renderCards(pg) {
  $("cards-lede").textContent = lede(pg);
  $("cards").innerHTML = (pg.items || []).map((item) =>
    `<div class="card" data-level="${item.level || "info"}">` +
    `<span class="badge">${esc(BADGE[item.level || "info"])}</span>` +
    `<h2>${esc(one(item.title))}</h2>` +
    (two(item.title) ? `<h2 class="ko">${esc(two(item.title))}</h2>` : "") +
    todo(item) +
    lines(item.body, "body") +
    diagram(item.diagram) +
    (item.action ? `<div class="action">${lines(item.action)}</div>` : "") +
    `</div>`
  ).join("");
  wireDiagrams($("view-cards"));
}

/* ---------- the mixer (sound station only) ---------- */

function renderNow(pg) {
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
      `<div class="group-head">${esc(lede(pg || { kind: "mixer" }))}</div>` +
      Object.entries(g.pages).map(([k, v]) => tile(k, v)).join("") +
      Object.entries(g.screens).map(([k, v]) => tile(k, v)).join("");
    $("screens").querySelectorAll(".tile").forEach((el) => {
      el.onclick = () => { state.pinned = el.dataset.key; renderNow(pg); window.scrollTo(0, 0); };
    });
  }

  if (state.pinned) {
    const entry = g.pages[state.pinned] || g.screens[state.pinned];
    where.textContent = "";
    box.innerHTML = card(entry) + `<button class="chip" id="unpin">${esc(t1("back"))}</button>`;
    $("unpin").onclick = () => { state.pinned = null; renderNow(pg); };
    wireDiagrams($("view-now"));
    return;
  }

  if (!state.bridge) {
    where.textContent = "";
    box.innerHTML = plainCard("info", "Not connected to the mixer",
      "This copy cannot follow along, so pick a screen below to read about it. In the booth, open the address the bridge prints on the media computer and this page will follow the desk by itself.");
    return;
  }

  if (!state.follow) {
    where.textContent = "";
    box.innerHTML = plainCard("info", "Following is off",
      "Turn the switch back on and this page will follow whatever screen the mixer is showing.");
    return;
  }

  if (!s || !s.ok) {
    where.textContent = "";
    box.innerHTML = plainCard("danger", "No answer from the mixer",
      "The bridge is running, but the console is not replying.",
      "Check the desk is switched on and the network cable is plugged in.");
    return;
  }

  let loc = s.screen_name || (s.screen === null ? "" : "screen " + s.screen);
  if (s.on_channel && s.channel) {
    loc += " · CH " + s.channel + (s.name ? " — " + s.name : "");
  }
  where.textContent = loc;

  if (s.on_channel) {
    if (s.page_name && g.pages[s.page_name]) {
      box.innerHTML = card(g.pages[s.page_name]);
    } else if (s.page !== null) {
      // Discovery mode: CHAN_PAGES is unconfirmed on the Compact.
      box.innerHTML = plainCard("info", `Tab ${s.page} — not mapped yet`,
        `The tab you just pressed reports as number ${s.page}, and there is no guide ` +
        `attached to that number yet.`,
        `Write it down, then add it to CHAN_PAGES in src/mixerm8/console.py.`);
    } else {
      box.innerHTML = card(g.pages.Home);
    }
    wireDiagrams($("view-now"));
    return;
  }

  const entry = g.screens[s.screen_name];
  box.innerHTML = entry ? card(entry) : plainCard("info",
    s.screen_name || "Screen " + s.screen,
    "No guide written for this screen yet.",
    "Press HOME to get back to the channel pages.");
  wireDiagrams($("view-now"));
}

/* ---------- chrome ---------- */

function setStatus(kind, label) {
  $("status").dataset.state = kind;
  $("status-text").textContent = label;
}

/* Which tabs a station has is declared per role in roles.json, because
 * `misc` is questions and policies with no equipment behind it, and a tab
 * bar offering an empty checklist is worse than no tab. */
function renderTabs() {
  const row = tabs();
  const nav = $("tabs");
  // One tab is not a choice, so a station with no pages gets no tab bar and
  // the extra height goes to its questions instead.
  nav.hidden = row.length < 2;
  nav.dataset.count = String(row.length);
  // Up to five share the width evenly, which is the shape the booth tablet
  // was designed around. Past that they take the width they need and the row
  // scrolls, because squeezing eight names into 780px makes none of them
  // readable and this is a page somebody reads at arm's length.
  nav.classList.toggle("scrolls", row.length > 5);
  nav.style.gridTemplateColumns = row.length > 5
    ? `repeat(${row.length}, minmax(max-content, 1fr))` : `repeat(${row.length}, 1fr)`;
  nav.innerHTML = row.map((pg) =>
    `<button class="tab" data-page="${esc(pg.id)}" role="tab" ` +
    `aria-selected="${state.page === pg.id}">${esc(one(pg.label))}</button>`
  ).join("");
  nav.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => setPage(el.dataset.page);
  });
  nav.querySelector('.tab[aria-selected="true"]')
     ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* The Next button. A first-timer who has never been in the booth should be
 * able to keep going without working out which tab comes after this one, so
 * a page can name its own successor -- and a page that names nothing simply
 * does not get a button. */
function renderNext(pg) {
  const box = $("pagenext");
  const target = pg && pg.next ? pageById(pg.next) : null;
  const shown = target && visiblePages().includes(target);
  box.hidden = !shown;
  if (!shown) return;
  box.innerHTML = `<button class="nextbtn" type="button">` +
    `<span class="nextlabel">${esc(t1("next"))}</span>` +
    `<b>${esc(one(target.label))}</b><span class="arrow" aria-hidden="true">→</span></button>`;
  box.querySelector(".nextbtn").onclick = () => setPage(target.id);
}

function renderLangs() {
  $("langs").innerHTML = LANGS.map((l, i) =>
    `<button class="seg" data-i="${i}" type="button" lang="${l.html}" ` +
    `aria-pressed="${i === state.lang}">${esc(l.label)}</button>`
  ).join("");
  $("langs").querySelectorAll(".seg").forEach((el) => {
    el.onclick = () => setLang(Number(el.dataset.i));
  });
}

function setLang(i) {
  state.lang = i;
  store.set("lang", i);
  // Keep the URL shareable: whatever you are reading, the link carries it.
  if (state.role) location.hash = `${state.role.id}/${LANGS[i].id}`;
  else render();
}

const SECTIONS = ["pick", "home", "checklist", "problems", "flow",
                  "equipment", "cards", "now"];

/* `id` is "pick", "home", or the id of one of this station's own pages. */
function setPage(id) {
  state.page = id;
  state.open = null;
  if (state.role) state.ticks = loadTicks();
  if (id !== "mixer") state.pinned = null;
  const pg = pageById(id);
  const section = id === "pick" || id === "home" ? id : DRAWN_BY[pg?.kind] || "home";
  SECTIONS.forEach((name) => { $("view-" + name).hidden = name !== section; });
  $("tabs").querySelectorAll(".tab").forEach((el) => {
    el.setAttribute("aria-selected", String(el.dataset.page === id));
  });
  render();
  window.scrollTo(0, 0);
}

function setFoot() {
  const bits = [];
  const seen = state.snap?.seen ? Object.keys(state.snap.seen) : [];
  if (state.bridge && seen.length) {
    bits.push("Tab numbers seen: " + seen.sort((a, b) => a - b).join(", "));
  }
  bits.push(state.local ? "Showing this church's own wording."
                        : "Showing the example wording — blanks are not filled in yet.");
  bits.push(state.bridge ? "Connected to the booth bridge — read-only, it cannot change the desk."
                         : "Reference copy. github.com/rwm6857/mixerm8");
  $("foot").textContent = bits.join(" · ");
}

function render() {
  document.documentElement.lang = LANGS[state.lang].html;
  renderLangs();

  if (state.page === "pick" || !state.role) {
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
    const pg = currentPage();
    if (state.page === "home") renderHome();
    else if (pg?.kind === "checklist") renderChecklist(pg);
    else if (pg?.kind === "problems") renderProblems(pg);
    else if (pg?.kind === "flow") renderFlow(pg);
    else if (pg?.kind === "equipment") renderEquipment(pg);
    else if (pg?.kind === "cards") renderCards(pg);
    else if (pg?.kind === "mixer") renderNow(pg);
    renderNext(pg);
  }
  setFoot();
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

function failed(what) {
  $("hero").hidden = true;
  $("pick").innerHTML = plainCard("danger", "The guide did not load",
    `${what} could not be fetched, so there is nothing to show.`,
    "Reload the page. If it keeps happening, tell whoever set this up.");
  setStatus("offline", "No content");
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

  const wanted = LANGS.findIndex((l) => l.id === langId);
  if (wanted >= 0) {
    state.lang = wanted;
    store.set("lang", wanted);
  }

  const role = (state.roles?.roles || []).find((r) => r.id === roleId);
  if (!role) {
    state.role = null;
    setPage("pick");
    return;
  }

  // Changing station is a fresh start; changing only the language is not,
  // so cycling EN/KO does not kick you back to the top of the checklist.
  const switched = state.role?.id !== role.id;
  if (switched) {
    state.open = null;
    state.pinned = null;
    state.page = "home";
  }

  state.role = role;
  try {
    state.data = await ensureRole(role);
  } catch {
    failed(`The guide for "${role.id}"`);
    state.role = null;
    setPage("pick");
    return;
  }

  // The station's own front page is the landing view, and the Mixer tab
  // never is: a station has to work when the bridge is down, so the first
  // thing a volunteer sees must not depend on a UDP reply.
  // Stay where you were if that page still exists and is still shown --
  // renaming a page or hiding it must not leave somebody on a dead tab.
  const offered = tabs().some((pg) => pg.id === state.page);
  setPage(offered && state.page !== "pick" ? state.page : "home");
}

/* ---------- live connection ---------- */

function connect() {
  const src = new EventSource("events");
  src.onmessage = (e) => {
    state.bridge = true;
    state.snap = JSON.parse(e.data);
    setStatus(state.snap.ok ? "live" : "waiting",
              state.snap.ok ? "Following" : "No mixer");
    if (currentPage()?.kind === "mixer") renderNow(currentPage());
    setFoot();
  };
  src.onerror = () => {
    if (state.bridge) setStatus("offline", "Reconnecting");
  };
}

async function boot() {
  state.lang = store.get("lang", 0);
  state.follow = store.get("follow", true);

  try {
    const got = await loadData("roles");
    state.roles = got.data;
    if (got.local) state.local = true;
  } catch {
    failed("The station list");
    return;
  }

  // Is a bridge serving us, or is this the Pages copy?
  try {
    const r = await fetch("state", { cache: "no-store" });
    if (!r.ok) throw new Error("no bridge");
    state.snap = await r.json();
    state.bridge = true;
    setStatus("live", "Following");
    connect();
  } catch {
    state.bridge = false;
    setStatus("ref", "Reference");
  }

  await route();
}

/* ---------- wiring ---------- */

window.addEventListener("hashchange", route);

// One step up the hierarchy, not straight out of it: from a tab back to the
// station's front page, and only from there back to the station list.
$("back").onclick = () => {
  if (state.role && state.page !== "home") { setPage("home"); return; }
  state.role = null;
  state.page = "pick";
  location.hash = "";
  setPage("pick");
};

$("expand").onclick = () => {
  state.flowOpen = !state.flowOpen;
  renderFlow(currentPage());
};

$("follow").onchange = (e) => {
  state.follow = e.target.checked;
  store.set("follow", state.follow);
  state.pinned = null;
  renderNow(currentPage());
};

$("reset").onclick = () => {
  state.ticks = new Set();
  saveTicks();
  renderChecklist(currentPage());
};

boot();
