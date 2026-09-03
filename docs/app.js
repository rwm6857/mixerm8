/* MixerM8 — the Sunday guide.
 *
 * One page, three stations, two languages, and no build step.
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
  { id: "en",   label: "EN",       show: ["en"],       html: "en" },
  { id: "ko",   label: "한국어",    show: ["ko"],       html: "ko" },
  { id: "both", label: "EN+한국어", show: ["en", "ko"], html: "en" },
];

/* The page's own furniture. Content lives in data/*.json; these are the
 * handful of words the shell needs before any content has loaded. */
const UI = {
  pick:       { en: "Which station are you on today?", ko: "오늘 어느 자리에서 봉사하시나요?" },
  tabCheck:   { en: "Before",    ko: "예배 전" },
  tabProblem: { en: "Problems",  ko: "문제 해결" },
  tabFlow:    { en: "Order",     ko: "진행 순서" },
  tabMixer:   { en: "Mixer",     ko: "믹서" },
  ledeCheck:  { en: "Work down the list. Ticks clear themselves each day.",
                ko: "위에서부터 하나씩 하세요. 체크는 매일 자동으로 지워집니다." },
  ledeProblem:{ en: "Tap whatever matches what you are hearing.",
                ko: "지금 들리는 상황에 맞는 항목을 누르세요." },
  ledeFlow:   { en: "The order of a normal Sunday.", ko: "평소 주일의 진행 순서입니다." },
  ledeMixer:  { en: "Every screen on the desk, and what it does.",
                ko: "콘솔의 모든 화면과 그 기능입니다." },
  reset:      { en: "Clear the ticks", ko: "체크 지우기" },
  back:       { en: "← Back", ko: "← 뒤로" },
  done:       { en: "All done.", ko: "모두 완료했습니다." },
};

const state = {
  roles: null,
  role: null,        // the role object from roles.json
  data: null,        // that role's checklist / problems / flow
  guides: null,      // console screen guides, sound station only
  cache: {},         // role id -> loaded content
  local: false,      // is any loaded file this church's own copy?
  bridge: false,
  snap: null,
  lang: 0,
  follow: true,
  view: "pick",
  problem: null,     // index of an open problem
  pinned: null,      // a console guide opened by hand
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

/* ---------- cards (console screen guides) ---------- */

function card(entry, extraClass = "") {
  if (!entry) return "";
  const level = entry.level || "info";
  const title = langs().map((l) => entry.title?.[l]).filter(Boolean)[0] || "";
  const badge = { ok: "Safe", caution: "Careful", danger: "Do not change", info: "Note" }[level];

  let html = `<div class="card ${extraClass}" data-level="${level}">`;
  html += `<span class="badge">${esc(badge)}</span>`;
  html += `<h2>${esc(title)}</h2>`;
  html += todo(entry);
  html += lines(entry.body, "body");
  if (entry.action) html += `<div class="action">${lines(entry.action)}</div>`;
  return html + `</div>`;
}

function plainCard(level, title, body, action) {
  return card({ level, title: { en: title }, body: { en: body }, action: action ? { en: action } : null });
}

/* ---------- station picker ---------- */

function renderPick() {
  $("pick-lede").textContent = t1("pick");
  $("pick").innerHTML = (state.roles?.roles || []).map((r) => {
    const label = langs().map((l) => r.label?.[l]).filter(Boolean);
    const where = langs().map((l) => r.where?.[l]).filter(Boolean);
    return `<a class="station" href="#${esc(r.id)}/${LANGS[state.lang].id}" data-role="${esc(r.id)}">` +
           `<b>${esc(label[0] || r.id)}</b>` +
           (label[1] ? `<b class="ko">${esc(label[1])}</b>` : "") +
           `<span>${esc(where[0] || "")}</span>` +
           (where[1] ? `<span class="ko">${esc(where[1])}</span>` : "") +
           `</a>`;
  }).join("");
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
    const title = langs().map((l) => p.title?.[l]).filter(Boolean);
    $("problems").innerHTML = "";
    $("problem-detail").innerHTML =
      `<button class="chip" id="pback">${esc(t1("back"))}</button>` +
      `<div class="card" data-level="${p.level || "info"}">` +
      `<h2>${esc(title[0] || "")}</h2>` +
      (title[1] ? `<h2 class="ko">${esc(title[1])}</h2>` : "") +
      lines(p.symptom, "symptom") +
      todo(p) +
      `<ol class="steps">` +
      (p.steps || []).map((s) => `<li>${lines(s)}</li>`).join("") +
      `</ol></div>`;
    $("pback").onclick = () => { state.problem = null; renderProblems(); };
    return;
  }

  $("problem-detail").innerHTML = "";
  $("problems").innerHTML = list.map((p, i) => {
    const title = langs().map((l) => p.title?.[l]).filter(Boolean);
    const sym = langs().map((l) => p.symptom?.[l]).filter(Boolean);
    return `<button class="tile" data-i="${i}" data-level="${p.level || "info"}">` +
           `<b>${esc(title[0] || "")}</b>` +
           (title[1] ? `<b class="ko">${esc(title[1])}</b>` : "") +
           `<span>${esc((sym[0] || "").slice(0, 70))}</span></button>`;
  }).join("");

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
  $("flow").innerHTML = (state.data.flow || []).map((step) => {
    const when = langs().map((l) => step.when?.[l]).filter(Boolean)[0] || "";
    const title = langs().map((l) => step.title?.[l]).filter(Boolean)[0] || "";
    return `<li${step.todo ? ' class="unfilled"' : ""}>` +
           `<div class="when">${esc(when)}</div>` +
           `<h3>${esc(title)}</h3>${todo(step)}${lines(step.detail, "detail")}</li>`;
  }).join("");
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
      `<b>${esc(langs().map((l) => entry.title?.[l]).filter(Boolean)[0] || key)}</b></button>`;
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
    return;
  }

  const entry = g.screens[s.screen_name];
  box.innerHTML = entry ? card(entry) : plainCard("info",
    s.screen_name || "Screen " + s.screen,
    "No guide written for this screen yet.",
    "Press HOME to get back to the channel pages.");
}

/* ---------- chrome ---------- */

function setStatus(kind, label) {
  $("status").dataset.state = kind;
  $("status-text").textContent = label;
}

function tabsFor(role) {
  const tabs = [
    { view: "checklist", key: "tabCheck" },
    { view: "problems",  key: "tabProblem" },
    { view: "flow",      key: "tabFlow" },
  ];
  // The mixer tab exists for the sound station whether or not a bridge is
  // answering: the screen guides are worth reading on a Tuesday too, and a
  // dead bridge must never take a tab away mid-service.
  if (role.console) tabs.push({ view: "now", key: "tabMixer" });
  return tabs;
}

function renderTabs() {
  const tabs = tabsFor(state.role);
  const nav = $("tabs");
  nav.hidden = false;
  nav.style.gridTemplateColumns = `repeat(${tabs.length}, 1fr)`;
  nav.innerHTML = tabs.map((tb) =>
    `<button class="tab" data-view="${tb.view}" role="tab" ` +
    `aria-selected="${state.view === tb.view}">${esc(t1(tb.key))}</button>`
  ).join("");
  nav.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => setView(el.dataset.view);
  });
}

const VIEWS = ["pick", "checklist", "problems", "flow", "now"];

function setView(view) {
  state.view = view;
  if (view !== "problems") state.problem = null;
  if (view !== "now") state.pinned = null;
  VIEWS.forEach((v) => { $("view-" + v).hidden = v !== view; });
  $("tabs").querySelectorAll(".tab").forEach((t) => {
    t.setAttribute("aria-selected", String(t.dataset.view === view));
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
  $("lang").textContent = LANGS[state.lang].label;

  if (state.view === "pick" || !state.role) {
    $("home").hidden = true;
    $("tabs").hidden = true;
    $("brand-text").textContent = "MixerM8";
    renderPick();
  } else {
    $("home").hidden = false;
    $("brand-text").textContent =
      langs().map((l) => state.role.label?.[l]).filter(Boolean)[0] || state.role.id;
    renderTabs();
    if (state.view === "checklist") renderChecklist();
    if (state.view === "problems") renderProblems();
    if (state.view === "flow") renderFlow();
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
    state.pinned = null;
    state.view = "checklist";
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
  // The checklist is always the landing view. The mixer never is: a station
  // has to work when the bridge is down, and the first thing a volunteer
  // sees must not depend on a UDP reply.
  setView(VIEWS.includes(state.view) && state.view !== "pick" ? state.view : "checklist");
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

$("home").onclick = () => {
  state.view = "pick";
  location.hash = "";
  state.role = null;
  setView("pick");
};

$("lang").onclick = () => {
  state.lang = (state.lang + 1) % LANGS.length;
  store.set("lang", state.lang);
  // Keep the URL shareable: whatever you are reading, the link carries it.
  if (state.role) location.hash = `${state.role.id}/${LANGS[state.lang].id}`;
  else render();
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
