/* MixerM8 booth guide.
 *
 * Runs in two modes off the same files:
 *   bridge    - served by the Windows bridge on the LAN, follows the mixer live
 *   reference - served by GitHub Pages, no mixer, guides and service flow only
 *
 * Mode is detected, never configured. All URLs are relative so the app works
 * at "/" (bridge) and at "/mixerm8/" (Pages) without a build step.
 */

const LANGS = [
  { id: "en",   label: "EN",       show: ["en"] },
  { id: "ko",   label: "한국어",    show: ["ko"] },
  { id: "both", label: "EN+한국어", show: ["en", "ko"] },
];

const state = {
  guides: null,
  flow: null,
  bridge: false,
  snap: null,
  lang: 0,
  follow: true,
  view: "now",
  pinned: null,      // a guide opened by hand from the index
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

/* ---------- rendering helpers ---------- */

function text(node) {
  // Pull the right language(s) out of a {en, ko} block.
  if (!node) return "";
  const langs = LANGS[state.lang].show;
  return langs.map((l) => node[l]).filter(Boolean);
}

function card(entry, extraClass = "") {
  if (!entry) return "";
  const langs = LANGS[state.lang].show;
  const level = entry.level || "info";
  const title = text(entry.title)[0] || "";
  const badge = { ok: "Safe", caution: "Careful", danger: "Do not change", info: "Note" }[level];

  let html = `<div class="card ${extraClass}" data-level="${level}">`;
  html += `<span class="badge">${esc(badge)}</span>`;
  html += `<h2>${esc(title)}</h2>`;
  langs.forEach((l, i) => {
    if (!entry.body?.[l]) return;
    html += `<p class="${i > 0 ? "ko ko-block" : ""}">${esc(entry.body[l])}</p>`;
  });
  if (entry.action) {
    html += `<div class="action">`;
    html += langs.map((l, i) =>
      entry.action[l] ? `<div class="${i > 0 ? "ko" : ""}">${esc(entry.action[l])}</div>` : ""
    ).join("");
    html += `</div>`;
  }
  return html + `</div>`;
}

function plainCard(level, title, body, action) {
  return card({ level, title: { en: title }, body: { en: body }, action: action ? { en: action } : null });
}

/* ---------- the "Now" view ---------- */

function renderNow() {
  const box = $("now");
  const where = $("where");
  const s = state.snap;

  if (state.pinned) {
    const entry = state.guides.pages[state.pinned] || state.guides.screens[state.pinned];
    where.textContent = "";
    box.innerHTML = card(entry) +
      `<button class="chip" id="unpin" style="min-height:${44}px">← Back to following</button>`;
    $("unpin").onclick = () => { state.pinned = null; renderNow(); };
    return;
  }

  if (!state.bridge) {
    where.textContent = "";
    box.innerHTML = plainCard(
      "info",
      "Reference copy",
      "This copy is not connected to a mixer, so it cannot follow along. Everything in Guides and Service still works — this is the version to read at home.",
      "In the booth, open the bridge address on the media computer instead."
    );
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

  // Where the operator is standing, in words.
  let loc = s.screen_name || (s.screen === null ? "" : "screen " + s.screen);
  if (s.on_channel && s.channel) {
    loc += " · CH " + s.channel + (s.name ? " — " + s.name : "");
  }
  where.textContent = loc;

  if (s.on_channel) {
    if (s.page_name && state.guides.pages[s.page_name]) {
      box.innerHTML = card(state.guides.pages[s.page_name]);
    } else if (s.page !== null) {
      // Discovery mode: CHAN_PAGES is unconfirmed on the Compact.
      box.innerHTML = plainCard("info", `Tab ${s.page} — not mapped yet`,
        `The tab you just pressed reports as number ${s.page}, and there is no guide ` +
        `attached to that number yet.`,
        `Write it down, then add it to CHAN_PAGES in src/mixerm8/console.py.`);
    } else {
      box.innerHTML = plainCard("ok", "Home",
        "The safe screen. Faders control how loud each microphone is in the room.");
    }
    return;
  }

  const entry = state.guides.screens[s.screen_name];
  box.innerHTML = entry ? card(entry) : plainCard("info",
    s.screen_name || "Screen " + s.screen,
    "No guide written for this screen yet.",
    "Press HOME to get back to the channel pages.");
}

/* ---------- the other two views ---------- */

function renderGuides() {
  const g = state.guides;
  const tile = (key, entry) =>
    `<button class="tile" data-key="${esc(key)}" data-level="${entry.level || "info"}">` +
    `<b>${esc(text(entry.title)[0] || key)}</b>` +
    `<span>${esc((entry.body?.en || "").slice(0, 60))}…</span></button>`;

  let html = `<div class="group-head">Channel tabs</div>`;
  html += Object.entries(g.pages).map(([k, v]) => tile(k, v)).join("");
  html += `<div class="group-head">Main screens</div>`;
  html += Object.entries(g.screens).map(([k, v]) => tile(k, v)).join("");
  $("guides").innerHTML = html;

  $("guides").querySelectorAll(".tile").forEach((el) => {
    el.onclick = () => {
      state.pinned = el.dataset.key;
      setView("now");
    };
  });
}

function renderFlow() {
  const langs = LANGS[state.lang].show;
  $("flow").innerHTML = state.flow.steps.map((step) => {
    const detail = langs.map((l, i) =>
      step.detail?.[l] ? `<p class="${i > 0 ? "ko" : ""}">${esc(step.detail[l])}</p>` : ""
    ).join("");
    return `<li><div class="when">${esc(text(step.when)[0])}</div>` +
           `<h3>${esc(text(step.title)[0])}</h3>${detail}</li>`;
  }).join("");
}

function renderAll() {
  renderNow();
  if (state.guides) renderGuides();
  if (state.flow) renderFlow();
}

/* ---------- chrome ---------- */

function setStatus(kind, label) {
  $("status").dataset.state = kind;
  $("status-text").textContent = label;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.view === view;
    t.setAttribute("aria-selected", String(on));
  });
  ["now", "guides", "flow"].forEach((v) => { $("view-" + v).hidden = v !== view; });
  window.scrollTo(0, 0);
}

function setFoot() {
  const seen = state.snap?.seen ? Object.keys(state.snap.seen) : [];
  const bits = [];
  if (state.bridge && seen.length) {
    bits.push("Tab numbers seen: " + seen.sort((a, b) => a - b).join(", "));
  }
  bits.push(state.bridge ? "Connected to the booth bridge — read-only, it cannot change the desk."
                         : "Reference copy. github.com/rwm6857/mixerm8");
  $("foot").textContent = bits.join(" · ");
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
    // The browser retries on its own; just reflect it.
    if (state.bridge) setStatus("offline", "Reconnecting");
  };
}

async function boot() {
  const [guides, flow] = await Promise.all([
    fetch("data/guides.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/flow.json", { cache: "no-cache" }).then((r) => r.json()),
  ]);
  state.guides = guides;
  state.flow = flow;

  state.lang = store.get("lang", 0);
  state.follow = store.get("follow", true);
  $("follow").checked = state.follow;
  $("lang").textContent = LANGS[state.lang].label;

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
    // Hide the switch rather than showing it stuck "on" with nothing to
    // follow -- that reads as a promise the page cannot keep.
    document.querySelector(".follow-row").hidden = true;
  }

  renderAll();
  setFoot();
}

/* ---------- wiring ---------- */

document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => { if (t.dataset.view !== "now") state.pinned = null; setView(t.dataset.view); };
});

$("lang").onclick = () => {
  state.lang = (state.lang + 1) % LANGS.length;
  store.set("lang", state.lang);
  $("lang").textContent = LANGS[state.lang].label;
  renderAll();
};

$("follow").onchange = (e) => {
  state.follow = e.target.checked;
  store.set("follow", state.follow);
  state.pinned = null;
  renderNow();
};

boot();
