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
  tabHome:    { en: "Home",      ko: "홈" },
  tabCheck:   { en: "Before",    ko: "예배 전" },
  tabProblem: { en: "Problems",  ko: "문제 해결" },
  tabFlow:    { en: "Order",     ko: "진행 순서" },
  tabEquip:   { en: "Equipment", ko: "장비" },
  tabMixer:   { en: "Mixer",     ko: "믹서" },
  navCheck:   { en: "What to do before the service starts.",
                ko: "예배가 시작되기 전에 할 일입니다." },
  navProblem: { en: "Something is wrong right now.",
                ko: "지금 문제가 생겼을 때 보세요." },
  navFlow:    { en: "The order of a normal Sunday, with times.",
                ko: "평소 주일의 진행 순서와 시간입니다." },
  navEquip:   { en: "What each piece of gear here is, and where it lives.",
                ko: "이 자리의 각 장비가 무엇이고 어디에 있는지 알려줍니다." },
  navMixer:   { en: "Every screen on the desk, and what it does.",
                ko: "콘솔의 모든 화면과 그 기능입니다." },
  ledeCheck:  { en: "Work down the list. Ticks clear themselves each day.",
                ko: "위에서부터 하나씩 하세요. 체크는 매일 자동으로 지워집니다." },
  ledeProblem:{ en: "Tap whatever matches what you are hearing.",
                ko: "지금 들리는 상황에 맞는 항목을 누르세요." },
  ledeFlow:   { en: "The order of a normal Sunday. Tap a step to open it.",
                ko: "평소 주일의 진행 순서입니다. 각 단계를 눌러 펼치세요." },
  ledeEquip:  { en: "Tap a box to read what it does and where it is.",
                ko: "장비를 눌러 무슨 역할을 하고 어디에 있는지 확인하세요." },
  ledeMixer:  { en: "Every screen on the desk, and what it does.",
                ko: "콘솔의 모든 화면과 그 기능입니다." },
  faqHead:    { en: "Questions people ask", ko: "자주 묻는 질문" },
  openAll:    { en: "Open every step",  ko: "모두 펼치기" },
  closeAll:   { en: "Close every step", ko: "모두 접기" },
  reset:      { en: "Clear the ticks", ko: "체크 지우기" },
  back:       { en: "← Back", ko: "← 뒤로" },
  done:       { en: "All done.", ko: "모두 완료했습니다." },
};

const state = {
  roles: null,
  role: null,        // the role object from roles.json
  data: null,        // that role's home text, questions, and layers
  guides: null,      // console screen guides, sound station only
  cache: {},         // role id -> loaded content
  local: false,      // is any loaded file this church's own copy?
  bridge: false,
  snap: null,
  lang: 0,
  follow: true,
  view: "pick",
  problem: null,     // index of an open problem
  gear: null,        // index of an open equipment page
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
const fill = (s) => esc(s).replace(/_{4,}/g, '<span class="blank">____</span>');

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

/* ---------- cards (console screen guides) ---------- */

function card(entry, extraClass = "") {
  if (!entry) return "";
  const level = entry.level || "info";
  const badge = { ok: "Safe", caution: "Careful", danger: "Do not change", info: "Note" }[level];

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

function loadTicks(roleId) {
  // Ticks from last Sunday are worse than no ticks at all, so they expire.
  const saved = store.get("ticks." + roleId, null);
  if (!saved || saved.date !== todayStamp()) return new Set();
  return new Set(saved.done);
}

function saveTicks() {
  store.set("ticks." + state.role.id, { date: todayStamp(), done: [...state.ticks] });
}

function renderChecklist() {
  $("checklist-lede").textContent = t1("ledeCheck");
  $("reset").textContent = t1("reset");
  const items = state.data.checklist || [];

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
      (two(p.title) ? `<h2 class="ko">${esc(two(p.title))}</h2>` : "") +
      lines(p.symptom, "symptom") +
      todo(p) +
      `<ol class="steps">` +
      (p.steps || []).map((s) => `<li>${lines(s)}</li>`).join("") +
      `</ol>` + diagram(p.diagram) + `</div>`;
    $("pback").onclick = () => { state.problem = null; renderProblems(); };
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
      (two(item.title) ? `<h2 class="ko">${esc(two(item.title))}</h2>` : "") +
      lines(item.where, "spec") +
      todo(item) +
      lines(item.body, "body") +
      diagram(item.diagram) +
      (item.action ? `<div class="action">${lines(item.action)}</div>` : "") +
      `</div>`;
    $("gback").onclick = () => { state.gear = null; renderEquipment(); };
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
      state.gear = Number(el.dataset.i);
      renderEquipment();
      window.scrollTo(0, 0);
    };
  });
}

/* ---------- the mixer (sound station only) ---------- */

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
function tabsFor(role) {
  const tabs = [{ view: "home", key: "tabHome", nav: "tabHome" }];
  const layers = role.layers || [];
  if (layers.includes("checklist")) tabs.push({ view: "checklist", key: "tabCheck", nav: "navCheck" });
  if (layers.includes("problems")) tabs.push({ view: "problems", key: "tabProblem", nav: "navProblem" });
  if (layers.includes("flow")) tabs.push({ view: "flow", key: "tabFlow", nav: "navFlow" });
  if (layers.includes("equipment")) tabs.push({ view: "equipment", key: "tabEquip", nav: "navEquip" });
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

const VIEWS = ["pick", "home", "checklist", "problems", "flow", "equipment", "now"];

function setView(view) {
  state.view = view;
  if (view !== "problems") state.problem = null;
  if (view !== "equipment") state.gear = null;
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
    if (state.view === "now") renderNow();
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
    setView("pick");
    return;
  }

  // Changing station is a fresh start; changing only the language is not,
  // so cycling EN/KO does not kick you back to the top of the checklist.
  const switched = state.role?.id !== role.id;
  if (switched) {
    state.problem = null;
    state.gear = null;
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
  const keep = VIEWS.includes(state.view) && state.view !== "pick";
  const offered = tabsFor(role).some((tb) => tb.view === state.view);
  setView(keep && offered ? state.view : "home");
}

/* ---------- live connection ---------- */

function connect() {
  const src = new EventSource("events");
  src.onmessage = (e) => {
    state.bridge = true;
    state.snap = JSON.parse(e.data);
    setStatus(state.snap.ok ? "live" : "waiting",
              state.snap.ok ? "Following" : "No mixer");
    if (state.view === "now") renderNow();
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
