// Northland Session Builder — planner UI.
import { store } from "./store.js";
import { DEMO } from "./demo.js";
import { DEFAULT_SETTINGS, ROOT } from "./config.js";
import { KEYS, keyName, fmtShift, norm, pickVersion, splitTitleHints } from "./music.js";
import { buildWeekend, metaKey, sessionName, weekendTitle, libSong } from "./model.js";
import { fmt } from "./timing.js";
import { planSend } from "./send.js";

const $app = document.getElementById("app");
const LS = {
  get(k, d) { try { const v = localStorage.getItem("sb." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sb." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const ui = {
  sel: {},             // weekendId -> selected item id
  bankTab: "worship",
  bankSec: "All",
  bankQ: "",
  buildMachine: null,
  modal: null,
  toast: null,
};
let lib = null;
let libStatus = "loading";
let fbState = { tried: false, error: null };

// ---------- helpers ----------
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  lib: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  tl: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 6h8M7 12h10M5 18h14"/></svg>',
};
/** Machines with "online" meaning the helper checked in within the last 2 minutes (it does so every 30 s). */
function machinesNow() {
  const ms = store.get("machines") || {};
  const out = {};
  for (const [id, m] of Object.entries(ms)) out[id] = { ...m, online: !!m.online && (store.mode === "local" || Date.now() - (m.lastSeen || 0) < 120000) };
  return out;
}
const settings = () => ({ ...DEFAULT_SETTINGS, ...(store.get("settings") || {}) });
const me = () => LS.get("name", "");
const ago = (t) => {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 36) return `${hr} h ago`;
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
function toast(msg) {
  ui.toast = msg; render();
  clearTimeout(toast.t); toast.t = setTimeout(() => { ui.toast = null; render(); }, 2600);
}
const ctx = () => ({ lib, meta: store.get("songMeta") || {}, settings: settings() });
const weekends = () => store.get("weekends") || {};
const route = () => {
  const [path, q = ""] = location.hash.replace(/^#/, "").split("?");
  return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(q) };
};
const go = (hash) => { location.hash = hash; };

// ---------- mutations ----------
async function setItems(wid, items) {
  await store.update(`weekends/${wid}`, { items, updatedAt: Date.now(), updatedBy: me() || null });
}
async function patchItem(wid, id, patch) {
  const w = weekends()[wid];
  const items = (w.items || []).map((it) => (it.id === id ? clean({ ...it, ...patch }) : it));
  await setItems(wid, items);
}
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };
const newId = () => "i" + Math.random().toString(36).slice(2, 8);

// ---------- render ----------
function render() {
  const { parts } = route();
  let html = "";
  if (!me() && parts[0] !== "settings") ui.modal = ui.modal || { type: "name" };
  if (parts[0] === "w" && parts[1] && parts[2] === "bank") html = viewBank(parts[1]);
  else if (parts[0] === "w" && parts[1] && parts[2] === "build") html = viewBuild(parts[1]);
  else if (parts[0] === "w" && parts[1] && parts[2] === "send") html = viewSend(parts[1]);
  else if (parts[0] === "w" && parts[1]) html = viewWeekend(parts[1]);
  else if (parts[0] === "bank") html = viewBank(null);
  else if (parts[0] === "settings") html = viewSettings();
  else html = viewHome();
  html += modalHtml();
  if (ui.toast) html += `<div class="toast" role="status">${h(ui.toast)}</div>`;

  // keep focus/caret in the search box across re-renders
  const a = document.activeElement;
  const keep = a && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  $app.innerHTML = html;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text input */ } }
  }
}

function modeBanner() {
  if (store.mode === "firebase") return "";
  const why = fbState.error ? `Firebase: ${h(fbState.error)}` : "Not signed in to sync";
  return `<div class="banner local"><span><b>Test mode.</b> ${why} — changes stay in this browser and use sample plans.</span><a href="#/settings">Sign in</a></div>`;
}

// ----- home -----
function weekendStatus(w, B) {
  const b = w.build;
  if (b?.status === "uploaded") return { text: "Uploaded", cls: "ok" };
  if (b?.status === "built" || b?.status === "finished") return { text: `Built by ${b.by || "?"}`, cls: "ok" };
  if (b?.status === "building" || b?.status === "queued") return { text: b.status === "queued" ? "Build queued" : "Building…", cls: "solid" };
  const songs = (w.items || []).filter((i) => i.type === "song");
  if (!songs.length) return { text: "Plan is blank", cls: "" };
  const errs = B.flags.filter((f) => f.level === "error").length;
  const warns = B.flags.filter((f) => f.level === "warn").length;
  if (errs) return { text: `${errs} to fix`, cls: "err" };
  if (warns) return { text: `${warns} to check`, cls: "warn" };
  return { text: "Ready to build", cls: "solid" };
}

function viewHome() {
  const ws = Object.entries(weekends()).map(([id, w]) => ({ id, ...w })).sort((a, b) => a.sat.localeCompare(b.sat));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = ws.filter((w) => (w.sun || w.sat) >= today);
  const past = ws.filter((w) => (w.sun || w.sat) < today).reverse().slice(0, 4);
  const machines = Object.entries(machinesNow());
  const sync = store.get("sync") || {};
  const card = (w, i) => {
    const B = buildWeekend(w, ctx());
    const st = weekendStatus(w, B);
    const wi = B.resolved.find((r) => r.type === "walkin");
    const songs = B.resolved.filter((r) => r.type === "song");
    const moments = B.resolved.filter((r) => r.type === "moment");
    const line = [wi?.title ? `${wi.title} (walk-in)` : null, ...songs.map((s) => s.title)].filter(Boolean).join(" · ");
    return `<a href="#/w/${h(w.id)}" class="glass wk ${i === 0 && upcoming.includes(w) ? "next" : ""}">
      <div class="row" style="justify-content:space-between;align-items:baseline"><span class="num t">${h(weekendTitle(w))}</span><span class="chip ${st.cls}">${h(st.text)}</span></div>
      <span style="font-size:14px;color:var(--ink-2);line-height:1.45">${h(line || "No songs in the plan yet")}</span>
      <div class="row small muted" style="justify-content:space-between;flex-wrap:wrap">
        <span>${songs.length} song${songs.length === 1 ? "" : "s"}${moments.length ? ` · ${moments.map((m) => m.title.toLowerCase()).join(", ")}` : ""}</span>
        <span>${B.tl.bounce ? "WORSHIP " + fmt(B.tl.bounce.end - B.tl.bounce.start) : ""} · ${h(w.serviceType || "")}</span>
      </div></a>`;
  };
  return `<div class="wrap home">
    <div class="top">
      <div><span class="label">Northland</span><h1>Session Builder</h1></div>
      <div class="row"><a class="iconbtn" href="#/bank" aria-label="Song bank">${icon.lib}</a><a class="iconbtn" href="#/settings" aria-label="Settings">${icon.gear}</a></div>
    </div>
    ${modeBanner()}
    <div class="glass machines">
      <span class="label">Computers</span>
      ${machines.length ? machines.map(([id, m]) => `<div class="machine"><span class="row"><span class="dot ${m.online ? "on" : "off"}"></span>${h(m.name)}</span>
        <span class="small" style="color:${m.online ? "var(--ok)" : "var(--ink-4)"}">${m.online ? (m.kind === "booth" ? "Online · booth" : m.proTools ? "Online · Pro Tools open" : "Online · Pro Tools closed") : "Offline · seen " + ago(m.lastSeen)}</span></div>`).join("")
        : `<span class="small muted">No helper has registered yet. Install the helper on a laptop to build sessions.</span>`}
    </div>
    <span class="label">Upcoming weekends</span>
    ${upcoming.length ? upcoming.map(card).join("") : `<div class="glass wk"><span class="muted">No upcoming Northland weekend plans synced yet.</span></div>`}
    ${past.length ? `<span class="label" style="margin-top:8px">Recent</span>${past.map((w) => card(w, 99)).join("")}` : ""}
    <div class="small muted" style="text-align:center">Planning Center synced ${ago(sync.lastRun)} · Library ${libLine()}</div>
  </div>`;
}
const libLine = () => (lib ? `indexed ${ago(lib.generatedAt)} (${lib.worship.length} songs, ${lib.walkins.length} walk-ins)` : libStatus === "loading" ? "loading…" : "not available");

// ----- weekend -----
function viewWeekend(wid) {
  const w = weekends()[wid];
  if (!w) return `<div class="wrap"><a href="#/">← Weekends</a><p>That weekend isn't here.</p></div>`;
  const B = buildWeekend(w, ctx());
  const sel = ui.sel[wid] && B.resolved.find((r) => r.id === ui.sel[wid]) ? ui.sel[wid] : (B.resolved.find((r) => r.type === "song") || B.resolved[0])?.id;
  ui.sel[wid] = sel;
  const r = B.resolved.find((x) => x.id === sel);
  const tlOpen = LS.get("timeline", window.innerWidth > 720);
  const warns = B.flags.filter((f) => f.level !== "info").length;
  const songsN = B.resolved.filter((x) => x.type === "song").length;
  const st = weekendStatus(w, B);

  return `<div class="wrap">
    <div class="top">
      <div class="row" style="gap:12px">
        <a class="iconbtn" href="#/" aria-label="Back to weekends">${icon.back}</a>
        <div><span class="label">${h(w.serviceType || "Northland | Weekend")}${w.planTitle ? " · " + h(w.planTitle) : ""} · ${w.planUrl ? `<a href="${h(w.planUrl)}" target="_blank" rel="noopener">open in Planning Center</a>` : w.source === "planner" ? "planned here" : "from Planning Center"}</span>
        <h1 class="num">${h(weekendTitle(w))} <span class="muted" style="font-size:15px;font-weight:500">${h(sessionName(w))}</span></h1></div>
      </div>
      <div class="wrapflex">
        <span class="chip num">Set ends ≈ ${fmt(B.tl.bounce?.end)}</span>
        ${B.tl.bounce ? `<span class="chip num hide-phone">WORSHIP ${fmt(B.tl.bounce.end - B.tl.bounce.start)}</span>` : ""}
        ${warns ? `<span class="chip warn">${warns} to check</span>` : `<span class="chip ok">No flags</span>`}
        ${B.edits.length ? `<span class="chip">${B.edits.length} arrangement edit${B.edits.length > 1 ? "s" : ""}</span>` : ""}
        ${B.steps.length ? `<span class="chip">${B.steps.length} manual step${B.steps.length > 1 ? "s" : ""}</span>` : ""}
        <button class="btn small ${tlOpen ? "on" : ""}" data-act="toggle-tl" aria-pressed="${tlOpen}">${icon.tl} Timeline</button>
        <a class="btn" href="#/w/${h(wid)}/bank">+ Add song</a>
        ${sendButton(wid, w, B)}
        <a class="btn primary" href="#/w/${h(wid)}/build">${st.text.startsWith("Built") || st.text === "Uploaded" ? "Rebuild" : "Build"}</a>
      </div>
    </div>
    ${modeBanner()}
    ${w.build ? buildLine({ ...w, id: wid }) : ""}
    ${w.changedSinceSend ? `<div class="banner local">The plan changed in Planning Center after it was sent from here. Planning Center wins: the list below shows the plan as it is now.</div>` : ""}
    ${tlOpen ? timelineHtml(wid, B, sel) : ""}
    <div class="panes">
      <div class="glass list" role="list">
        ${B.resolved.map((x) => listRow(wid, x, sel)).join("")}
        <div class="addrow">
          <a class="btn small" href="#/w/${h(wid)}/bank">+ Song</a>
          <button class="btn small" data-act="add-moment" data-w="${h(wid)}">+ Pastoral moment</button>
          ${!B.resolved.some((x) => x.type === "walkin") ? `<a class="btn small" href="#/w/${h(wid)}/bank?tab=walkin">+ Walk-in</a>` : ""}
        </div>
        ${!songsN ? `<p class="small muted" style="padding:4px 8px">The plan has no songs yet. Add them here, then send the set to Planning Center.</p>` : ""}
      </div>
      <div class="detailcol" id="detail">
        ${r ? detailHtml(wid, w, B, r) : ""}
        ${sessionCard(B)}
      </div>
    </div>
  </div>`;
}

function buildLine(w) {
  const b = w.build;
  const m = machinesNow()[b.machine];
  const label = { queued: "Build queued", building: "Building", built: "Built", finished: "Finished", uploaded: "Finished · WORSHIP bounce in Planning Center", failed: "Build failed" }[b.status] || b.status;
  return `<div class="banner" style="background:var(--glass);border:1px solid var(--line)"><span class="dot ${b.status === "failed" ? "" : "on"}" style="${b.status === "failed" ? "background:var(--err)" : ""}"></span>
    <span>${h(label)} by <b>${h(b.by || "?")}</b> on ${h(m?.name || b.machine || "?")} · ${ago(b.at)}</span>
    ${b.jobId ? `<a href="#/w/${h(w.id || "")}/build">Progress</a>` : ""}</div>`;
}

function listRow(wid, r, sel) {
  const t = r.t;
  let sub = "", badge = "";
  const fl = r.flags.filter((f) => f.level !== "info");
  const hasErr = fl.some((f) => f.level === "error");
  if (r.type === "countdown") sub = `Fixed · ${fmt(r.lengthSec)} · ${r.bpm} BPM`;
  else if (r.type === "beginsNow") sub = `Fixed · ${fmt(r.lengthSec)} · ${r.bpm} BPM`;
  else if (r.type === "walkin") sub = r.item.placeholder && !r.song ? "Walk-in · pick a song" : `Walk-in · ${r.song?.artist || ""} · ${r.bpm} BPM · ${fmt(r.lengthSec)}`;
  else if (r.type === "moment") sub = r.padOn ? `Pad ${r.padKey || "?"} · ${fmt(r.lengthSec)}` : `No pad · ${fmt(r.lengthSec)}`;
  else if (r.type === "song") {
    const vn = r.version ? r.version.name.replace(new RegExp("^" + r.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\((.*)\\)$", "i"), "$1") : "no stems";
    sub = `${vn === "Default" ? "stems" : vn} · ${r.bpm}${r.meter[0] !== 4 ? " " + r.meter.join("/") : ""} · ${fmt(r.lengthSec)}`;
    badge = r.planKey ? `<span class="badge ${r.shift ? "warn" : ""}" title="Plan key${r.shift ? ", shift " + fmtShift(r.shift) : ""}">${h(r.planKey)}${r.shift ? " " + fmtShift(r.shift) : ""}</span>` : `<span class="badge ghost">?</span>`;
  }
  if (r.type === "moment" && r.padOn) badge = `<span class="badge" style="background:var(--pad)">${h(r.padKey || "?")}</span>`;
  const title = r.title || (r.type === "walkin" ? "Walk-in" : "Untitled");
  return `<button class="li ${r.id === sel ? "sel" : ""}" data-act="sel" data-w="${h(wid)}" data-id="${h(r.id)}" role="listitem" aria-current="${r.id === sel}">
    <span class="tm num">${fmt(t.start)}</span>
    <span class="grow"><span class="tt">${h(title)}</span><span class="st">${h(sub)}</span></span>
    ${fl.length ? `<span class="flagdot ${hasErr ? "err" : ""}" title="${h(fl.map((f) => f.text).join("\n"))}"></span>` : ""}
    ${badge}</button>`;
}

const KIND = { countdown: "Pre-experience", walkin: "Walk-in", beginsNow: "Worship · fixed", moment: "In-set moment" };

function detailHtml(wid, w, B, r) {
  const t = r.t;
  const it = r.item;
  const songN = B.resolved.filter((x) => x.type === "song").indexOf(r) + 1;
  const kind = r.type === "song" ? `Song ${songN}${r.song?.collection ? " · " + r.song.collection : ""}` : KIND[r.type];
  const idx = B.resolved.indexOf(r);
  const prev = B.resolved.slice(0, idx).reverse().find((x) => x.type !== "moment" || r.type === "song");
  const nav = `<div class="row only-phone" style="justify-content:space-between">
     <button class="btn small" data-act="sel" data-w="${h(wid)}" data-id="${h(B.resolved[Math.max(0, idx - 1)].id)}" ${idx === 0 ? "disabled" : ""}>‹ Prev</button>
     <button class="btn small" data-act="sel" data-w="${h(wid)}" data-id="${h(B.resolved[Math.min(B.resolved.length - 1, idx + 1)].id)}" ${idx === B.resolved.length - 1 ? "disabled" : ""}>Next ›</button></div>`;

  let body = "";
  const flags = r.flags.length ? `<div class="flags">${r.flags.map((f) => `<div class="flag ${f.level}">${h(f.text)}</div>`).join("")}</div>` : "";
  const facts = [];
  facts.push(["Starts", fmt(t.start, 1), t.snapBar != null && t.gridOf ? `bar ${t.snapBar + 1} of ${t.gridOf}` : "0:00"]);
  if (t.countIn) facts.push(["Downbeat", fmt(t.downbeat, 1), `${(it.countInBars ?? r.countInBars ?? settings().countInBars)}-bar count-in · ${t.countIn.toFixed(2)} s`]);
  facts.push(["Ends", fmt(t.end, 1), r.type === "moment" ? `${fmt(r.lengthSec)} moment` : `${fmt(r.lengthSec)}${r.lengthApprox ? " ≈" : ""}${r.trimmed ? " · trimmed" : ""}`]);
  if (r.type !== "moment") facts.push(["Tempo", `${r.bpm}${r.meter.join("/") !== "4/4" ? " · " + r.meter.join("/") : ""}`, r.bpmSource || "fixed"]);
  if (r.type === "moment") facts.push(["Grid", `${t.bpm} · ${t.meter.join("/")}`, t.gridFrom ? `${t.gridFrom}'s tempo` : ""]);
  if (r.type === "song") facts.push(["Key", r.stemKey?.key && r.planKey ? `${r.stemKey.key} → ${r.planKey}` : r.planKey || "?", r.shift == null ? "shift unknown" : r.shift === 0 ? "no shift" : `shift ${fmtShift(r.shift)} · ${r.pnt ? "Pitch ’n Time" : "automatic"}`, r.shift == null || r.stemKey?.guess]);

  const transition = t.gridOf ? `<div class="field"><span>Position — moves in whole bars of ${h(t.gridOf)} (${t.gridBarSec?.toFixed(2)} s)</span>
    <div class="wrapflex"><div class="stepper"><button data-act="nudge" data-w="${h(wid)}" data-id="${h(r.id)}" data-d="-1" aria-label="One bar earlier">−</button>
    <span class="val num">${(it.nudgeBars || 0) > 0 ? "+" : ""}${it.nudgeBars || 0} bar${Math.abs(it.nudgeBars || 0) === 1 ? "" : "s"}</span>
    <button data-act="nudge" data-w="${h(wid)}" data-id="${h(r.id)}" data-d="1" aria-label="One bar later">+</button></div>
    <span class="small muted">${t.gapAfterPrev != null ? (t.gapAfterPrev >= 0 ? `${t.gapAfterPrev.toFixed(1)} s after ${h(prev?.title || "previous")} ends` : `overlaps ${h(prev?.title || "previous")}'s ending by ${(-t.gapAfterPrev).toFixed(1)} s`) : ""}</span>
    ${it.nudgeBars ? `<button class="btn small" data-act="nudge0" data-w="${h(wid)}" data-id="${h(r.id)}">Reset</button>` : ""}</div></div>` : "";

  if (r.type === "song" || r.type === "walkin") {
    const vs = r.song?.versions || [];
    const keyOpts = (cur) => `<option value="">—</option>` + KEYS.flatMap((k) => [k, k + "m"]).map((k) => `<option ${keyName(cur) === k ? "selected" : ""}>${k}</option>`).join("");
    body += `<div class="field"><span>Stem folder</span><div class="row" style="flex-wrap:wrap">
      <span class="grow small" style="overflow-wrap:anywhere">${r.song ? h((r.type === "walkin" ? "+ WALK-IN/" : "+ WORSHIP/") + r.song.path.replace(/^\+ WALK-IN\//, "")) : '<span style="color:var(--err)">none</span>'}${it.matchedBy === "auto" || (!it.libPath && r.song) ? ' <span class="tag">matched by title</span>' : ""}</span>
      <a class="btn small" href="#/w/${h(wid)}/bank?for=${h(r.id)}${r.type === "walkin" ? "&tab=walkin" : ""}">Change</a></div></div>`;
    body += `<div class="fields">
      ${vs.length > 1 ? `<label class="field"><span>Version</span><select class="input" data-ch="version" data-w="${h(wid)}" data-id="${h(r.id)}">${vs.map((v) => `<option value="${h(v.name)}" ${r.version?.name === v.name ? "selected" : ""}>${h(v.name)}${v.kind === "key" ? " (key folder)" : ""} · ${fmt(v.lengthSec)}</option>`).join("")}</select></label>` : ""}
      ${r.type === "song" ? `<label class="field"><span>Plan key</span><select class="input" data-ch="planKey" data-w="${h(wid)}" data-id="${h(r.id)}">${keyOpts(it.planKey)}</select></label>
      <label class="field"><span>Stem key · ${h(r.stemKey?.source || "")}</span><select class="input" data-ch="stemKey" data-w="${h(wid)}" data-id="${h(r.id)}">${keyOpts(r.stemKey?.key)}</select></label>` : ""}
      <label class="field"><span>BPM${r.bpmNeedsConfirm ? " — confirm" : ""}</span><input class="input num" inputmode="decimal" value="${h(r.bpm)}" data-ch="bpm" data-w="${h(wid)}" data-id="${h(r.id)}" aria-label="BPM"></label>
      <label class="field"><span>Meter</span><select class="input" data-ch="meter" data-w="${h(wid)}" data-id="${h(r.id)}">${["4/4", "3/4", "6/8", "12/8", "2/4", "6/4"].map((m) => `<option ${r.meter.join("/") === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
    </div>`;
    if (r.type === "song" && r.shift) {
      body += `<label class="switch"><input type="checkbox" data-ch="pnt" data-w="${h(wid)}" data-id="${h(r.id)}" ${r.pnt ? "checked" : ""}> Use Pitch ’n Time instead (manual step after the build)</label>`;
    }
    body += transition;
    body += `<details class="more"><summary>Length and count-in</summary><div class="fields" style="margin-top:10px">
      <label class="field"><span>Use length (m:ss) · file ${fmt(r.fileLengthSec)}${r.lengthApprox ? " ≈" : ""}</span><input class="input num" value="${r.trimmed ? fmt(r.lengthSec, 1) : ""}" placeholder="${fmt(r.fileLengthSec, 1)}" data-ch="length" data-w="${h(wid)}" data-id="${h(r.id)}"></label>
      <label class="field"><span>Count-in bars</span><input class="input num" inputmode="numeric" value="${h(it.countInBars ?? r.countInBars ?? settings().countInBars)}" data-ch="countInBars" data-w="${h(wid)}" data-id="${h(r.id)}"></label>
    </div><p class="small muted">Lengths come from file sizes (48 kHz / 24-bit assumed) until the helper reads the real files.</p></details>`;
    if (r.map?.length) {
      const shiftOn = r.type === "song" && r.shift && !r.pnt;
      body += `<details class="more"><summary>Stems → tracks (${r.map.filter((m) => m.track).length} of ${r.map.length})</summary><div class="tbox"><table class="map">
        <thead><tr><th>Stem</th><th>Track</th><th class="hide-phone">Output</th><th></th></tr></thead><tbody>
        ${r.map.map((m) => `<tr class="${m.track ? "" : "bad"}"><td>${h(m.stem)}</td><td>${h(m.track || "—")}</td><td class="hide-phone muted">${h(m.output || "")}</td>
          <td>${m.muted ? '<span class="tag m">muted</span>' : ""}${shiftOn && m.pitched ? `<span class="tag p">${fmtShift(r.shift)}${m.formant ? " · formant" : ""}</span>` : ""}${m.flags.map((f) => `<span class="tag m">${h(f)}</span>`).join("")}</td></tr>`).join("")}
        </tbody></table></div></details>`;
    }
  } else if (r.type === "moment") {
    body += `<div class="fields">
      <label class="field"><span>Moment length (seconds)</span><input class="input num" inputmode="numeric" value="${h(r.lengthSec)}" data-ch="momentLen" data-w="${h(wid)}" data-id="${h(r.id)}"></label>
      <label class="field"><span>Pad key · ${h(r.padKeySource)}</span><select class="input" data-ch="padKey" data-w="${h(wid)}" data-id="${h(r.id)}"><option value="">Auto</option>${KEYS.flatMap((k) => [k, k + "m"]).map((k) => `<option ${it.pad?.key === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    </div>
    <label class="switch"><input type="checkbox" data-ch="padOn" data-w="${h(wid)}" data-id="${h(r.id)}" ${r.padOn ? "checked" : ""}> Pad under this moment</label>
    ${r.padOn && r.padFile ? `<p class="small muted" style="margin:0">${h(r.padFile.split("/").pop())} · ${fmt(t.padStart, 1)} → ${fmt(t.padEnd, 1)} (${fmt(t.padLen)}${t.padRepeats > 1 ? `, looped ${t.padRepeats}× with crossfades` : ""}) · fades in ${settings().padFadeInSec} s before the previous song ends, out over ${settings().padFadeOutSec} s into the next song</p>` : ""}
    ${transition}
    <button class="btn small" data-act="remove" data-w="${h(wid)}" data-id="${h(r.id)}" style="align-self:flex-start">Remove moment</button>`;
  } else {
    const opts = audioChoices(r.type);
    body += `<label class="field"><span>Audio · ${h(r.fileSource)} · ${fmt(r.lengthSec, 1)}${r.lengthApprox ? " ≈" : ""}</span>
      <select class="input" data-ch="fixedFile" data-w="${h(wid)}" data-id="${h(r.id)}">
        <option value="">Default — ${h((r.type === "countdown" ? settings().countdownFile : settings().beginsNowFile).split("/").pop())}</option>
        ${opts.filter((m) => m.path !== (r.type === "countdown" ? settings().countdownFile : settings().beginsNowFile)).map((m) => `<option value="${h(m.path)}" ${it.file === m.path ? "selected" : ""}>${h(m.path.split("/").slice(-2).join(" / "))}${m.secs ? " · " + fmt(m.secs) : ""}</option>`).join("")}
      </select></label>
      <p class="small muted" style="margin:0">Goes on the VIDEO track at the top of the session. Tempo ${r.bpm} BPM (Settings). To change the default for every new session, use Settings.</p>${transition}`;
  }

  const notes = (it.notes || []).length ? `<div class="glass card" style="gap:8px"><span class="label">From Planning Center</span>
    ${it.pcoTitle ? `<span class="small muted">${h(it.pcoTitle)}${it.planLengthSec ? " · " + fmt(it.planLengthSec) + " in the plan" : ""}</span>` : ""}
    <div class="notes">${it.notes.map((n) => `<span>${h(n)}</span>`).join("")}</div></div>` : "";
  const steps = (r.edits.length ? `<div class="glass card" style="gap:10px"><span class="label">Arrangement edits from the plan</span>${r.edits.map((s) => `<span class="check"><i></i>${h(s)}</span>`).join("")}
      <span class="small muted">Song sections will apply these automatically for you to review. Until that's built, do them by hand after the build.</span></div>` : "") +
    (r.steps.length ? `<div class="glass card" style="gap:10px"><span class="label">Manual steps after the build</span>${r.steps.map((s) => `<span class="check"><i></i>${h(s)}</span>`).join("")}</div>` : "");
  const canMove = r.type === "song" || r.type === "moment";

  return `${nav}<div class="glass card">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;align-items:flex-start">
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="label">${h(kind)}</span><h2>${h(r.title || "Walk-in")}</h2>
      ${r.song?.artist ? `<span class="muted">${h(r.song.artist)}</span>` : ""}</div>
      <div class="row">${canMove ? `<button class="btn small" data-act="move" data-d="-1" data-w="${h(wid)}" data-id="${h(r.id)}" aria-label="Move earlier in the set">↑</button><button class="btn small" data-act="move" data-d="1" data-w="${h(wid)}" data-id="${h(r.id)}" aria-label="Move later in the set">↓</button>` : ""}
      ${r.type === "song" ? `<button class="btn small" data-act="remove" data-w="${h(wid)}" data-id="${h(r.id)}">Remove</button>` : ""}</div>
    </div>
    <div class="facts">${facts.map(([l, v, hint, warn]) => `<div class="fact ${warn ? "warn" : ""}"><span class="label">${h(l)}</span><span class="v num">${h(v)}</span><span class="h">${h(hint)}</span></div>`).join("")}</div>
    ${flags}
    ${body}
  </div>
  ${notes || steps ? `<div class="split">${notes}${steps}</div>` : ""}`;
}

function sessionCard(B) {
  const tl = B.tl;
  return `<div class="glass card" style="gap:12px"><span class="label">Session plan</span>
    <div class="split">
      <div style="display:flex;flex-direction:column;gap:8px"><span class="small muted">Tempo / meter (on bar lines)</span>
        <div class="kv num">${tl.tempoMap.map((e) => `<span class="k">${fmt(e.at, 1)}</span><span>${h(e.label)}</span><span>${e.bpm}${e.meter ? " · " + e.meter : ""}</span>`).join("")}</div></div>
      <div style="display:flex;flex-direction:column;gap:8px"><span class="small muted">Markers</span>
        <div class="kv num">${tl.markers.map((m) => `<span class="k">${fmt(m.at, 1)}</span><span style="grid-column:span 2">${h(m.name)}</span>`).join("")}</div></div>
    </div>
    ${tl.bounce ? `<span class="small muted">WORSHIP bounce ${fmt(tl.bounce.start, 1)} → ${fmt(tl.bounce.end, 1)} (${fmt(tl.bounce.end - tl.bounce.start)}) · VIDEO bounce 0:00 → ${fmt(tl.end, 1)}</span>` : ""}
    ${B.handWork.length ? `<details class="more"><summary>After the build, by hand (${B.handWork.length})</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${B.handWork.map((s) => `<span class="check"><i></i>${h(s.title)} · ${h(s.text)}</span>`).join("")}</div></details>` : ""}
    ${tl.warnings.length ? `<details class="more"><summary>Transitions to look at (${tl.warnings.length})</summary><div class="flags" style="margin-top:8px">${tl.warnings.map((x) => `<div class="flag info">${h(x.text)}</div>`).join("")}</div></details>` : ""}
  </div>`;
}

function timelineHtml(wid, B, sel) {
  const tl = B.tl;
  const T = Math.max(tl.end, 60) * 1.01;
  const pct = (x) => ((x / T) * 100).toFixed(3) + "%";
  const ticks = [];
  for (let m = 0; m * 60 <= T; m += 5) ticks.push(`<span class="num" style="left:${pct(m * 60)}">${m}:00</span>`);
  const blk = (r, cls, s, e, label, meta, top, ht, extra = "") =>
    `<button class="blk ${cls} ${r.id === sel ? "sel" : ""}" data-act="sel" data-w="${h(wid)}" data-id="${h(r.id)}"
      style="left:${pct(s)};width:max(6px, ${pct(Math.max(e - s, 0.1))});top:${top}px;height:${ht}px" aria-label="${h(label)}, ${fmt(s)} to ${fmt(e)}" title="${h(label)} · ${fmt(s, 1)} – ${fmt(e, 1)}">${extra}${h(label)}<small>${h(meta)}</small></button>`;
  const video = B.resolved.filter((r) => r.lane === "video").map((r) => blk(r, "video", r.t.start, r.t.end, r.type === "countdown" ? "Countdown" : "BN", fmt(r.t.start), 6, 44)).join("");
  let alt = 0;
  const music = B.resolved.filter((r) => r.lane === "music").map((r) => {
    const row = alt++ % 2;
    const ci = r.t.countIn ? `<span class="ci" style="width:${((r.t.countIn / Math.max(r.t.end - r.t.start, 1)) * 100).toFixed(2)}%"></span>` : "";
    const meta = r.type === "song" ? `${r.planKey || "?"}${r.shift ? " " + fmtShift(r.shift) : ""} · ${r.bpm}` : `walk-in · ${r.bpm}`;
    return blk(r, r.type === "walkin" ? "walkin" : "song", r.t.start, r.t.end, r.title || "Walk-in", meta, row ? 40 : 4, 34, ci);
  }).join("");
  const pad = B.resolved.filter((r) => r.type === "moment").map((r) =>
    (r.padOn ? blk(r, "pad", r.t.padStart, r.t.padEnd, r.padKey || "pad", "pad", 6, 32) : "") +
    blk(r, "moment", r.t.start, r.t.end, "", r.title, 40, 12)).join("");
  const b = tl.bounce;
  return `<div class="glass tl" aria-label="Session timeline"><div class="scroll"><div class="inner">
    <div class="ruler">${ticks.join("")}</div>
    <div class="lane"><span class="label name">Video</span><div class="track" style="height:58px">${video}</div></div>
    <div class="lane"><span class="label name">Music</span><div class="track" style="height:80px">${music}</div></div>
    <div class="lane"><span class="label name">Pad</span><div class="track" style="height:56px">${pad}</div></div>
    ${b ? `<div class="bounce"><div class="ln" style="left:${pct(b.start)};width:${pct(b.end - b.start)}"></div><span class="num" style="left:${pct(b.start)}">WORSHIP bounce ${fmt(b.start)} → ${fmt(b.end)}</span></div>` : ""}
    <div class="legend"><span>Striped = 2-bar count-in</span><span>Songs alternate rows so overlaps show</span><span>Dashed = moment length</span></div>
  </div></div></div>`;
}

/** Last time a song / walk-in was in a Northland Weekend plan (from the sync job, same key rule). */
const fkey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/[.#$[\]/]/g, "") || "_";
function lastUsedOf(tab, title) {
  const lu = store.get("sync")?.lastUsed;
  return lu ? (tab === "walkin" ? lu.walkins : lu.songs)?.[fkey(title)] : null;
}

/** Audio files the helper found in MUSIC / BEGINS NOW, countdown-ish ones first for the countdown. */
function audioChoices(type) {
  const list = (lib?.music || []).filter((m) => /\.(wav|aiff?)$/i.test(m.path));
  const re = type === "countdown" ? /countdown/i : /begins now/i;
  return [...list.filter((m) => re.test(m.path)), ...list.filter((m) => !re.test(m.path))];
}

// ----- song bank -----
function bankSongs(tab) {
  if (!lib) return [];
  return tab === "walkin" ? lib.walkins : lib.worship;
}
function viewBank(wid) {
  const { q } = route();
  const forId = q.get("for");
  if (q.get("tab") && !ui._bankTabSet) { ui.bankTab = q.get("tab"); ui._bankTabSet = true; }
  const w = wid ? weekends()[wid] : null;
  const tab = ui.bankTab;
  const secs = tab === "walkin" ? ["All", "At The Movies", "Christmas"] : ["All", "Songs For Sometimes", "Christmas 2026", "SWITCH", "Archive"];
  const secKey = { All: null, "At The Movies": "At The Movies", Christmas: "Christmas" };
  const sec = secs.includes(ui.bankSec) ? ui.bankSec : "All";
  const back = wid ? `#/w/${wid}` : "#/";
  const forItem = forId && w ? (w.items || []).find((i) => i.id === forId) : null;
  return `<div class="wrap">
    <div class="top"><div class="row" style="gap:12px"><a class="iconbtn" href="${h(back)}" aria-label="Back">${icon.back}</a>
      <div><span class="label">${w ? (forItem ? `Choosing stems for ${h(forItem.title || "the walk-in")}` : `Adding to ${h(weekendTitle(w))}`) : "Dropbox stem library · read-only"}</span><h1>Song bank</h1></div></div>
      ${w ? `<a class="btn primary" href="${h(back)}">Done</a>` : ""}</div>
    ${!lib ? `<div class="banner local">${libStatus === "loading" ? "Loading the library…" : "No library index yet. Run the helper's library scan (helper/library_index.py) on a laptop with Dropbox."}</div>` : ""}
    <div class="tabs" role="tablist">
      <button role="tab" class="${tab === "worship" ? "on" : ""}" aria-selected="${tab === "worship"}" data-act="bank-tab" data-v="worship">Worship songs</button>
      <button role="tab" class="${tab === "walkin" ? "on" : ""}" aria-selected="${tab === "walkin"}" data-act="bank-tab" data-v="walkin">Walk-ins</button>
    </div>
    <label class="sr" for="bankQ">Search</label>
    <input id="bankQ" class="input" type="search" placeholder="${tab === "walkin" ? "Search walk-ins by title or artist" : "Search worship songs"}" value="${h(ui.bankQ)}" data-in="bankQ" style="max-width:520px">
    <div class="wrapflex">${secs.map((s) => `<button class="sec ${s === sec ? "on" : ""}" data-act="bank-sec" data-v="${h(s)}">${h(s)}</button>`).join("")}</div>
    <div class="bank" id="bankList">${bankList(wid, forId, tab, sec, secKey)}</div>
  </div>`;
}
function bankList(wid, forId, tab, sec, secKey) {
  const ql = norm(ui.bankQ);
  const w = wid ? weekends()[wid] : null;
  const inSet = new Set((w?.items || []).map((i) => i.libPath).filter(Boolean));
  let list = bankSongs(tab).filter((s) => !s.noStems);
  if (sec !== "All") list = list.filter((s) => s.collection === (secKey[sec] ?? sec));
  else if (tab === "worship") list = list.filter((s) => s.collection !== "Archive");
  if (ql) list = list.filter((s) => norm(`${s.title} ${s.artist || ""} ${s.folder}`).includes(ql));
  const total = list.length;
  list = list.slice(0, 150);
  if (!total) return `<p class="muted">No songs match.</p>`;
  return list.map((s) => {
    const vs = s.versions;
    const clicks = vs.map((v) => v.click).filter(Boolean);
    const bpms = [...new Set(clicks.map((c) => c.bpm).filter(Boolean))];
    const inexact = clicks.some((c) => !c.bpmExact);
    const keyFolders = vs.filter((v) => v.kind === "key").map((v) => v.key);
    const len = Math.max(...vs.map((v) => v.lengthSec));
    const stems = Math.max(...vs.map((v) => v.stems.length));
    const meta = [
      tab === "walkin" ? s.artist : null,
      keyFolders.length ? `keys ${keyFolders.join(" ")}` : vs.length > 1 ? `${vs.length} versions` : null,
      bpms.length ? bpms.join("/") + " BPM" : null,
      `${stems} stems`, `≈${fmt(len)}`,
    ].filter(Boolean).join(" · ");
    const loose = clicks.find((c) => !c.bpmExact);
    const lu = lastUsedOf(tab, s.title);
    const flag = lu ? `Last used at Northland ${new Date(lu + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` + (!clicks.length ? " · no click stem" : "") : !clicks.length ? "No click stem" : inexact ? (loose.bpm ? `Click says "${loose.file.match(/\(([^)]*\d[^)]*)\)/)?.[1] || "≈" + loose.bpm}" — confirm BPM` : "Click has no BPM in its name") : s.folderNotes ? s.folderNotes.join(", ") : s.collection || "";
    const on = inSet.has(s.path);
    const label = forId ? "Use" : on ? "In set" : "Add";
    return `<div class="glass song"><div style="min-width:0"><div class="t">${h(s.title)}</div><div class="m">${h(meta)}</div>
      ${flag ? `<div class="f" style="color:${!clicks.length || inexact ? "var(--warn)" : "var(--ink-4)"}">${h(flag)}</div>` : ""}</div>
      ${wid ? `<button class="addbtn ${on && !forId ? "on" : ""}" data-act="bank-add" data-w="${h(wid)}" data-path="${h(s.path)}" data-tab="${tab}" ${forId ? `data-for="${h(forId)}"` : ""} aria-label="${h(label + " " + s.title)}" ${on && !forId ? "disabled" : ""}>${forId ? "→" : on ? "✓" : "+"}</button>` : ""}</div>`;
  }).join("") + (total > 150 ? `<p class="muted small">Showing 150 of ${total} — search to narrow.</p>` : "");
}

async function bankAdd(wid, path, tab, forId) {
  const w = weekends()[wid];
  const items = [...(w.items || [])];
  const s = (tab === "walkin" ? lib.walkins : lib.worship).find((x) => x.path === path);
  if (!s) return;
  if (forId) {
    const i = items.findIndex((x) => x.id === forId);
    if (i >= 0) {
      const cur = items[i];
      const v = pickVersion(s, { planKey: cur.planKey, hints: splitTitleHints(cur.pcoTitle || "").hints });
      items[i] = clean({ ...cur, libPath: s.path, version: v?.name, matchedBy: undefined, title: cur.title || s.title, artist: s.artist || cur.artist, placeholder: undefined, lengthSec: undefined });
    }
    await setItems(wid, items);
    toast(`Using ${s.title}`);
    go(`#/w/${wid}`);
    return;
  }
  if (tab === "walkin") {
    const i = items.findIndex((x) => x.type === "walkin");
    const item = { id: i >= 0 ? items[i].id : newId(), type: "walkin", title: s.title, artist: s.artist || null, libPath: s.path, version: s.versions[0]?.name, notes: i >= 0 ? items[i].notes || [] : [], pcoTitle: i >= 0 ? items[i].pcoTitle : null, planLengthSec: i >= 0 ? items[i].planLengthSec : null };
    if (i >= 0) items[i] = clean(item); else items.splice(items.findIndex((x) => x.type === "countdown") + 1, 0, clean(item));
    await setItems(wid, items);
    toast(`Walk-in: ${s.title}`);
    return;
  }
  const v = pickVersion(s, {});
  items.push({ id: newId(), type: "song", title: s.title, libPath: s.path, version: v?.name, notes: [], addedHere: true });
  await setItems(wid, items);
  toast(`Added ${s.title}`);
}

// ----- send to Planning Center -----
const SEND_LABEL = { queued: "Queued", sending: "Sending…", sent: "Sent", failed: "Send failed", waiting: "Needs your answer" };
function sendButton(wid, w, B) {
  const p = planSend(w, B);
  const s = w.send;
  if (s && ["queued", "sending", "waiting", "failed"].includes(s.status)) return `<a class="btn" href="#/w/${h(wid)}/send">PCO: ${h(SEND_LABEL[s.status])}</a>`;
  if (!p.changes.length) return s?.status === "sent" ? `<span class="chip ok">Sent to PCO</span>` : "";
  return `<a class="btn" href="#/w/${h(wid)}/send">Send to Planning Center (${p.changes.length})</a>`;
}

function viewSend(wid) {
  const w = weekends()[wid];
  if (!w) return viewHome();
  const B = buildWeekend(w, ctx());
  const p = planSend(w, B);
  const s = w.send;
  const req = s?.id ? (store.get("sends") || {})[s.id] : null;
  const needConfirm = p.changes.some((c) => c.confirm);
  const status = s ? `<div class="glass card" style="gap:8px"><span class="label">Last request</span>
      <span><b>${h(SEND_LABEL[s.status] || s.status)}</b> · sent by ${h(s.by || "?")} ${ago(s.at)}${s.status === "sent" && s.sentAt ? " · written to the plan " + ago(s.sentAt) : ""}</span>
      ${req?.message ? `<span class="small">${h(req.message)}</span>` : ""}
      ${s.status === "queued" ? `<span class="small muted">The pco-tools job checks for requests every ~5 minutes.</span>` : ""}
      ${s.status === "sent" ? `<span class="small muted">Planning Center is the source of truth again; later edits there sync back here.</span>` : ""}</div>` : "";
  return `<div class="wrap" style="max-width:720px">
    <div class="top"><div class="row" style="gap:12px"><a class="iconbtn" href="#/w/${h(wid)}" aria-label="Back to the weekend">${icon.back}</a>
      <div><span class="label">Send to Planning Center · ${h(w.serviceType || "Northland | Weekend")}</span><h1 class="num">${h(weekendTitle(w))}</h1></div></div></div>
    ${modeBanner()}
    ${status}
    ${p.blockers.length ? `<div class="flags">${p.blockers.map((b) => `<div class="flag error">${h(b)}</div>`).join("")}</div>` : ""}
    <div class="glass card" style="gap:10px"><span class="label">What will change (${p.changes.length})</span>
      ${p.changes.length ? p.changes.map((c) => `<span class="check"><i style="border-color:var(--accent)"></i>${h(c.text)}${c.arrangement && c.arrangement !== "Default" ? ` <span class="tag">${h(c.arrangement)}</span>` : ""}</span>`).join("") : `<span class="muted">Nothing to send — the plan already matches.</span>`}
    </div>
    <div class="glass card" style="gap:8px"><span class="label">Stays as it is</span>
      <span class="small muted">Template items and everything in PRE-EXPERIENCE, STAGE TIME, MESSAGE and CLOSE are never touched, and item notes (who leads, cues) are never overwritten.</span>
      ${p.keep.map((k) => `<span class="small">${h(k.title)} <span class="muted">· ${h(k.why)}</span></span>`).join("")}
    </div>
    ${p.warnings.length ? `<div class="flags">${p.warnings.map((x) => `<div class="flag warn">${h(x)}</div>`).join("")}</div>` : ""}
    ${needConfirm ? `<label class="switch"><input type="checkbox" id="sendConfirm"> Yes, replace the walk-in title that's already in the plan</label>` : ""}
    <button class="btn primary" style="min-height:54px;font-size:16px" data-act="send-pco" data-w="${h(wid)}" ${p.blockers.length || !p.changes.length ? "disabled" : ""}>Send ${p.changes.length} change${p.changes.length === 1 ? "" : "s"} to Planning Center</button>
    <span class="small muted" style="text-align:center">The planner never writes to Planning Center itself: the pco-tools job does it with Boone's token and reports back here.</span>
  </div>`;
}

async function sendToPco(wid) {
  const w = weekends()[wid];
  const B = buildWeekend(w, ctx());
  const p = planSend(w, B);
  if (p.blockers.length || !p.changes.length) return;
  if (p.changes.some((c) => c.confirm) && !document.getElementById("sendConfirm")?.checked) { toast("Tick the box to allow replacing the walk-in title"); return; }
  const at = Date.now();
  const req = clean({ weekendId: wid, pcoPlanId: w.pcoPlanId || null, serviceType: w.serviceType || null, by: me() || "?", at, status: "queued",
    changes: JSON.parse(JSON.stringify(p.changes.map(({ text, ...c }) => clean({ ...c, summary: text })))) });
  const id = await store.push("sends", req);
  await store.update(`weekends/${wid}`, { send: { id, status: "queued", by: req.by, at } });
  toast("Queued for Planning Center");
  if (store.mode === "local") {
    // Test mode: pretend the pco-tools job picked it up.
    setTimeout(async () => {
      await store.update(`sends/${id}`, { status: "sent", message: "Test mode: nothing was written to Planning Center." });
      await store.update(`weekends/${wid}/send`, { status: "sent", sentAt: Date.now() });
      const items = (weekends()[wid].items || []).map((it) => {
        const c = p.changes.find((x) => (x.op === "add" && x.title === it.title && it.addedHere) || (x.op === "rename" && it.type === "walkin"));
        if (!c) return it;
        return clean({ ...it, addedHere: undefined, placeholder: undefined, pcoTitle: c.op === "rename" ? c.title : it.title });
      });
      await setItems(wid, items);
    }, 2500);
  }
}

// ----- build -----
const BUILD_STEPS = [
  ["copy", "Copy stems from Dropbox"],
  ["shift", "Pitch-shift stems (Rubber Band)"],
  ["session", "Create session from template"],
  ["import", "Import audio into the session"],
  ["spot", "Place clips"],
  ["tempo", "Tempo and meter changes"],
  ["markers", "Markers"],
  ["mute", "Mute lead vocal, check outputs"],
];
function viewBuild(wid) {
  const w = weekends()[wid];
  if (!w) return viewHome();
  const B = buildWeekend(w, ctx());
  const machines = Object.entries(machinesNow()).filter(([, m]) => m.kind !== "booth");
  const mine = machines.find(([, m]) => m.owner && m.owner.toLowerCase() === (me() || "").toLowerCase());
  const pick = ui.buildMachine && machines.some(([id]) => id === ui.buildMachine) ? ui.buildMachine : (mine || machines.find(([, m]) => m.online) || machines[0] || [])[0];
  const job = w.build?.jobId ? (store.get("jobs") || {})[w.build.jobId] : null;
  const errors = B.flags.filter((f) => f.level === "error");
  const warns = B.flags.filter((f) => f.level === "warn");
  const existing = w.build && ["built", "finished", "uploaded", "building", "queued"].includes(w.build.status);
  const name = sessionName(w);
  let jobHtml = "";
  if (job) {
    const doneN = BUILD_STEPS.findIndex(([k]) => k === job.step);
    const pctDone = job.status === "done" ? 100 : Math.max(0, Math.round((doneN / BUILD_STEPS.length) * 100));
    jobHtml = `<div class="glass card"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><span class="label">${job.status === "done" ? "Built" : job.status === "queued" ? "Waiting for" : "Building on"} ${h(machinesNow()[job.machine]?.name || job.machine)}</span><span class="small muted">Started by ${h(job.by)} · ${ago(job.at)}</span></div>
      <div class="bar"><div style="width:${pctDone}%"></div></div>
      <div class="steps">${BUILD_STEPS.map(([k, label], i) => {
        const st = job.status === "done" || i < doneN ? "done" : i === doneN ? (job.status === "failed" ? "fail" : "active") : "todo";
        return `<div class="stp"><span class="ic ${st}">${st === "done" ? "✓" : st === "fail" ? "!" : ""}</span><span><span style="font-size:15px;${st === "todo" ? "color:var(--ink-3)" : "font-weight:500"}">${h(label)}</span>${job.detail && i === doneN ? `<br><span class="small muted">${h(job.detail)}</span>` : ""}</span></div>`;
      }).join("")}</div>
      ${job.status === "queued" ? `<p class="small muted" style="margin:0">Waiting for the helper to pick it up. Pro Tools must be open on that computer.</p>` : ""}
      ${job.status === "done" ? `<p class="small" style="margin:0">${h(job.detail || "Saved in TRACKS / " + name + ".")}${job.result?.test ? " <b>Test build</b> (test mode is on)." : ""}</p>
        ${(job.result?.manual || []).length || B.handWork.length ? `<details class="more" open><summary>To do by hand in Pro Tools (${(job.result?.manual || []).length + B.edits.length})</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${[...(job.result?.manual || []), ...B.edits.map((e) => e.title + " · arrangement: " + e.text)].map((t) => `<span class="check"><i></i>${h(t)}</span>`).join("")}</div></details>` : "<p class=\"small\" style=\"margin:0\">Nothing to do by hand — ready to Finish.</p>"}` : ""}
      ${job.status === "failed" ? `<div class="flag error">${h(job.detail || "The build failed.")}</div>` : ""}
    </div>`;
  }
  return `<div class="wrap" style="max-width:640px">
    <div class="top"><div class="row" style="gap:12px"><a class="iconbtn" href="#/w/${h(wid)}" aria-label="Back to the weekend">${icon.back}</a>
      <div><span class="label">Build · ${h(weekendTitle(w))}</span><h1 class="num">${h(name)}</h1></div></div></div>
    ${modeBanner()}
    ${jobHtml}
    <div class="field"><span class="label">Build on</span>${machines.map(([id, m]) => `<button class="pick ${id === pick ? "on" : ""}" data-act="pick-machine" data-v="${h(id)}" aria-pressed="${id === pick}">
      <span><span style="font-size:15px;font-weight:600;display:block">${h(m.name)}</span><span class="small muted">${m.online ? (m.proTools ? "Online · Pro Tools open" : "Online · open Pro Tools to build") : "Offline · build waits until it's on"}</span></span><span class="dot ${m.online ? "on" : "off"}" style="width:10px;height:10px"></span></button>`).join("") || `<span class="muted small">No computers registered yet.</span>`}</div>
    ${existing ? `<div class="flag warn">Already ${h(w.build.status)} by ${h(w.build.by)} on ${h(machinesNow()[w.build.machine]?.name || w.build.machine)} (${ago(w.build.at)}). Rebuilding makes a new session; it never overwrites theirs, and the lighting director's SMPTE/video edits stay in the earlier copy.</div>` : ""}
    ${errors.length ? `<div class="flags">${errors.map((f) => `<div class="flag error">${h(f.title)}: ${h(f.text)}</div>`).join("")}</div>` : ""}
    ${warns.length ? `<details class="more"><summary>${warns.length} thing${warns.length > 1 ? "s" : ""} to check first</summary><div class="flags" style="margin-top:8px">${warns.map((f) => `<div class="flag warn">${h(f.title)}: ${h(f.text)}</div>`).join("")}</div></details>` : ""}
    <div class="glass card" style="gap:6px"><span class="label">What gets built</span>
      <span class="small">${B.resolved.filter((r) => r.type !== "countdown" && r.type !== "beginsNow").map((r) => h(r.title || "Walk-in") + (r.shift && !r.pnt ? ` (${fmtShift(r.shift)})` : "")).join(" · ")}</span>
      <span class="small muted">${B.tl.tempoMap.length} tempo events · ${B.tl.markers.length} markers · ends ${fmt(B.tl.end)} · ${B.resolved.filter((r) => r.shift && !r.pnt).length} songs shifted automatically</span></div>
    <button class="btn primary" style="min-height:54px;font-size:16px" data-act="start-build" data-w="${h(wid)}" data-m="${h(pick || "")}" ${errors.length || !pick ? "disabled" : ""}>${existing ? "Rebuild" : "Build"} on ${h(machinesNow()[pick]?.name || "…")}</button>
    <span class="small muted" style="text-align:center">You can close this page — the planner shows progress when you come back.</span>
  </div>`;
}

async function startBuild(wid, machineId) {
  const w = weekends()[wid];
  const B = buildWeekend(w, ctx());
  const existing = w.build && ["built", "finished", "uploaded", "building", "queued"].includes(w.build.status);
  if (existing && !confirm(`${weekendTitle(w)} was already ${w.build.status} by ${w.build.by}. Build a new session anyway?`)) return;
  const plan = {
    sessionName: sessionName(w),
    parts: B.resolved.map((r) => clean({
      id: r.id, type: r.type, title: r.title, libPath: r.song?.path, version: r.version?.name, file: r.file,
      start: +r.t.start.toFixed(4), countIn: +r.t.countIn.toFixed(4), end: +r.t.end.toFixed(4), bpm: r.bpm, meter: r.meter.join("/"),
      shift: r.type === "song" && !r.pnt ? r.shift : 0, pnt: r.pnt || undefined,
      pad: r.type === "moment" && r.padOn ? { key: r.padKey, file: r.padFile, start: +r.t.padStart.toFixed(3), end: +r.t.padEnd.toFixed(3) } : undefined,
      stems: r.map?.filter((m) => m.track).map((m) => ({ file: m.file, track: m.track, shift: m.pitched, formant: m.formant, muted: m.muted || false })),
    })),
    tempoMap: B.tl.tempoMap.map((e) => clean({ at: +e.at.toFixed(4), bpm: e.bpm, meter: e.meter || undefined })),
    markers: B.tl.markers.map((m) => ({ at: +m.at.toFixed(4), name: m.name })),
    bounce: B.tl.bounce,
  };
  const job = { type: "build", weekendId: wid, machine: machineId, by: me() || "?", at: Date.now(), status: "queued", plan: JSON.parse(JSON.stringify(plan)) };
  const jobId = await store.push("jobs", job);
  await store.update(`weekends/${wid}`, { build: { status: "queued", jobId, machine: machineId, by: job.by, at: job.at } });
  if (store.mode === "local") simulateJob(wid, jobId);
}

/** Test mode only: pretend the helper is building so the progress screen can be tried. */
function simulateJob(wid, jobId) {
  const m = machinesNow()[store.get(`jobs/${jobId}/machine`)];
  if (!m?.online || !m.proTools) return;
  let i = 0;
  const tick = async () => {
    if (i < BUILD_STEPS.length) {
      await store.update(`jobs/${jobId}`, { status: "running", step: BUILD_STEPS[i][0], detail: i === 4 ? "placing clips left to right" : "" });
      await store.update(`weekends/${wid}/build`, { status: "building" });
      i++; setTimeout(tick, 900);
    } else {
      await store.update(`jobs/${jobId}`, { status: "done", step: null });
      await store.update(`weekends/${wid}/build`, { status: "built", at: Date.now() });
    }
  };
  setTimeout(tick, 700);
}

// ----- settings -----
function viewSettings() {
  const S = settings();
  const num = (k, label) => `<label class="field"><span>${label}</span><input class="input num" inputmode="decimal" value="${h(S[k])}" data-set="${k}"></label>`;
  return `<div class="wrap" style="max-width:720px">
    <div class="top"><div class="row" style="gap:12px"><a class="iconbtn" href="#/" aria-label="Back">${icon.back}</a><div><span class="label">Session Builder</span><h1>Settings</h1></div></div></div>
    <div class="glass card"><span class="label">You</span>
      <label class="field"><span>Your name (this device) — shown on builds you start</span><input class="input" id="nameIn" value="${h(me())}" data-ch="name" autocomplete="name"></label></div>
    <div class="glass card"><span class="label">Sync</span>
      ${store.mode === "firebase" ? `<span>Signed in — plans sync across devices.</span><button class="btn small" data-act="signout" style="align-self:flex-start">Sign out of sync</button>`
        : `<span class="small muted">Same shared sync password as the start-times app.${fbState.error ? ` Last error: ${h(fbState.error)}` : ""}</span>
        <form class="row" data-form="signin" style="flex-wrap:wrap"><label class="sr" for="pw">Sync password</label><input id="pw" class="input grow" type="password" autocomplete="current-password" placeholder="Sync password" style="max-width:280px"><button class="btn primary" type="submit">Sign in</button></form>`}
    </div>
    <div class="glass card"><span class="label">Fixed audio for every new session</span>
      ${["countdown", "beginsNow"].map((t) => {
        const k = t === "countdown" ? "countdownFile" : "beginsNowFile";
        const opts = audioChoices(t);
        const has = opts.some((m) => m.path === S[k]);
        return `<label class="field"><span>${t === "countdown" ? "Countdown" : "Begins Now"}</span><select class="input" data-setfile="${k}">
          ${has ? "" : `<option selected value="${h(S[k])}">${h(S[k].split("/").slice(-2).join(" / "))}${lib ? " (not found)" : ""}</option>`}
          ${opts.map((m) => `<option value="${h(m.path)}" ${m.path === S[k] ? "selected" : ""}>${h(m.path.split("/").slice(-2).join(" / "))}${m.secs ? " · " + fmt(m.secs) : ""}</option>`).join("")}</select></label>`;
      }).join("")}
      <span class="small muted">Lists audio in _NKC PROTOOLS COMPUTER/MUSIC (and the older _DRB SESSION NEEDS/BEGINS NOW). Any weekend can pick a different file on its Countdown or Begins Now item.</span></div>
    <div class="glass card"><span class="label">Timing defaults</span>
      <div class="fields">${num("countdownBpm", "Countdown BPM")}${num("beginsNowBpm", "Begins Now BPM")}${num("countdownSec", "Countdown length (s)")}${num("beginsNowSec", "Begins Now length (s)")}${num("countInBars", "Count-in bars")}${num("gapSec", "Gap before downbeat (s)")}${num("padFadeInSec", "Pad fade-in lead (s)")}${num("padFadeOutSec", "Pad fade-out (s)")}${num("momentSec", "Default moment (s)")}</div>
      <span class="small muted">SWITCH may need different values later.</span></div>
    <div class="glass card"><span class="label">Library</span><span class="small">${libLine()}</span>
      <span class="small muted">The laptop helper scans the Dropbox library (read-only) and publishes the index. Lengths are estimates until the helper reads the files.</span></div>
    ${store.mode === "local" ? `<div class="glass card"><span class="label">Test data</span><button class="btn small" data-act="reset-demo" style="align-self:flex-start">Reset sample weekends</button></div>` : ""}
  </div>`;
}

// ----- modal -----
function modalHtml() {
  if (!ui.modal) return "";
  if (ui.modal.type === "name") {
    return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><form class="glass card" data-form="name">
      <h2 id="mt" style="font-size:22px">Who's planning?</h2>
      <span class="small muted">Stored on this device. It's shown on builds and finishes you start.</span>
      <label class="field"><span>Your name</span><input class="input" id="nameFirst" autocomplete="name" required></label>
      <button class="btn primary" type="submit">Continue</button></form></div>`;
  }
  return "";
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const { act, w: wid, id, d, v } = el.dataset;
  if (act === "sel") {
    ui.sel[wid] = id; render();
    if (window.innerWidth <= 720 && el.classList.contains("li")) document.getElementById("detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (act === "toggle-tl") { LS.set("timeline", !LS.get("timeline", window.innerWidth > 720)); render(); }
  else if (act === "nudge") { const it = weekends()[wid].items.find((x) => x.id === id); await patchItem(wid, id, { nudgeBars: (it.nudgeBars || 0) + +d }); }
  else if (act === "nudge0") await patchItem(wid, id, { nudgeBars: 0 });
  else if (act === "move") {
    const items = [...weekends()[wid].items];
    const i = items.findIndex((x) => x.id === id);
    const j = i + +d;
    const fixed = (x) => ["countdown", "walkin", "beginsNow"].includes(x?.type);
    if (j < 0 || j >= items.length || fixed(items[j])) return;
    [items[i], items[j]] = [items[j], items[i]];
    await setItems(wid, items);
  } else if (act === "remove") {
    const it = weekends()[wid].items.find((x) => x.id === id);
    const inPlan = it.pcoTitle && !it.addedHere;
    if (!confirm(`Remove ${it.title || "this item"} from the set?${inPlan ? " It stays in Planning Center; the planner never deletes plan items." : ""}`)) return;
    await setItems(wid, weekends()[wid].items.filter((x) => x.id !== id));
    if (inPlan) await store.update(`weekends/${wid}`, { removedFromPlan: [...(weekends()[wid].removedFromPlan || []), it.pcoTitle] });
  } else if (act === "add-moment") {
    const items = [...weekends()[wid].items];
    const selIdx = items.findIndex((x) => x.id === ui.sel[wid]);
    const at = selIdx >= 0 && items[selIdx].type === "song" ? selIdx + 1 : items.length;
    const nid = newId();
    items.splice(at, 0, { id: nid, type: "moment", title: "Pastoral Moment", notes: [], pad: { on: true }, addedHere: true });
    ui.sel[wid] = nid;
    await setItems(wid, items);
  } else if (act === "bank-tab") { ui.bankTab = v; ui.bankSec = "All"; ui.bankQ = ""; render(); }
  else if (act === "bank-sec") { ui.bankSec = v; render(); }
  else if (act === "bank-add") await bankAdd(wid, el.dataset.path, el.dataset.tab, el.dataset.for);
  else if (act === "pick-machine") { ui.buildMachine = v; render(); }
  else if (act === "start-build") await startBuild(wid, el.dataset.m);
  else if (act === "send-pco") await sendToPco(wid);
  else if (act === "signout") { await store.signOut(); store.initLocal(DEMO); }
  else if (act === "reset-demo") { if (confirm("Reset the sample weekends in this browser?")) store.resetLocal(DEMO); }
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  const { ch, w: wid, id } = el.dataset;
  if (el.dataset.setfile) {
    const k = el.dataset.setfile;
    const m = (lib?.music || []).find((x) => x.path === el.value);
    const patch = { [k]: el.value };
    if (m?.exact) patch[k === "countdownFile" ? "countdownSec" : "beginsNowSec"] = m.secs;
    await store.update("settings", patch);
    toast("Default saved for new sessions");
    return;
  }
  if (el.dataset.set) {
    const n = parseFloat(el.value);
    if (!isNaN(n)) await store.update("settings", { [el.dataset.set]: n });
    return;
  }
  if (!ch) return;
  if (ch === "name") { LS.set("name", el.value.trim()); toast("Saved"); return; }
  const w = weekends()[wid];
  const it = w.items.find((x) => x.id === id);
  const B = buildWeekend(w, ctx());
  const r = B.resolved.find((x) => x.id === id);
  if (ch === "version") await patchItem(wid, id, { version: el.value, libPath: r.song?.path, lengthSec: undefined });
  else if (ch === "planKey") await patchItem(wid, id, { planKey: el.value || undefined });
  else if (ch === "stemKey") {
    if (!r.song) return;
    await store.update(`songMeta/${metaKey(r.song.path, r.version?.name)}`, { stemKey: el.value || null, stemKeyBy: me() || null, stemKeyAt: Date.now() });
    toast(`Stem key saved for ${r.title}${r.version ? " · " + r.version.name : ""}`);
  } else if (ch === "bpm") {
    const n = parseFloat(el.value);
    if (isNaN(n) || n < 30 || n > 300) { toast("BPM must be a number between 30 and 300"); render(); return; }
    if (r.song) {
      await store.update(`songMeta/${metaKey(r.song.path, r.version?.name)}`, { bpm: n, bpmBy: me() || null, bpmAt: Date.now() });
      if (it.bpm != null) await patchItem(wid, id, { bpm: undefined });
      toast(`BPM ${n} remembered for ${r.title}`);
    } else await patchItem(wid, id, { bpm: n });
  } else if (ch === "meter") {
    const meter = el.value.split("/").map(Number);
    if (r.song) await store.update(`songMeta/${metaKey(r.song.path, r.version?.name)}`, { meter });
    else await patchItem(wid, id, { meter });
    if (it.meter) await patchItem(wid, id, { meter: undefined });
  } else if (ch === "pnt") await patchItem(wid, id, { transpose: el.checked ? "pnt" : "auto" });
  else if (ch === "length") {
    const v = el.value.trim();
    if (!v) { await patchItem(wid, id, { lengthSec: undefined }); return; }
    const m = v.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    const secs = m ? +m[1] * 60 + +m[2] : parseFloat(v);
    if (isNaN(secs) || secs <= 0) { toast("Use m:ss, e.g. 4:50"); render(); return; }
    await patchItem(wid, id, { lengthSec: secs });
  } else if (ch === "countInBars") {
    const n = parseInt(el.value, 10);
    if (isNaN(n) || n < 0 || n > 8) { render(); return; }
    await patchItem(wid, id, { countInBars: n });
  } else if (ch === "momentLen") {
    const n = parseFloat(el.value);
    if (!isNaN(n) && n > 0) await patchItem(wid, id, { lengthSec: n });
  } else if (ch === "fixedFile") await patchItem(wid, id, { file: el.value || undefined });
  else if (ch === "padOn") await patchItem(wid, id, { pad: { ...(it.pad || {}), on: el.checked } });
  else if (ch === "padKey") await patchItem(wid, id, { pad: clean({ ...(it.pad || {}), key: el.value || undefined }) });
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.in === "bankQ") {
    ui.bankQ = e.target.value;
    const { parts, q } = route();
    const wid = parts[0] === "w" ? parts[1] : null;
    const tab = ui.bankTab;
    const secs = { All: null, "At The Movies": "At The Movies", Christmas: "Christmas" };
    const list = document.getElementById("bankList");
    if (list) list.innerHTML = bankList(wid, q.get("for"), tab, ui.bankSec, secs);
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target.dataset.form;
  if (!f) return;
  e.preventDefault();
  if (f === "name") {
    const v = document.getElementById("nameFirst").value.trim();
    if (!v) return;
    LS.set("name", v); ui.modal = null; render();
  } else if (f === "signin") {
    const pw = document.getElementById("pw").value;
    try { await store.signIn(pw); fbState.error = null; toast("Signed in"); }
    catch (err) { fbState.error = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential" ? "wrong password" : err.message; render(); }
  }
});

window.addEventListener("hashchange", () => { ui._bankTabSet = false; ui.bankQ = ""; render(); window.scrollTo(0, 0); });
let resizeT;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(render, 150); });

// ---------- boot ----------
store.subscribe(() => render());
store.initLocal(DEMO);
store.loadLibrary().then((l) => { lib = l; libStatus = l ? "ok" : "missing"; render(); });
store.initFirebase((ok, err) => {
  fbState.tried = true;
  if (ok) {
    fbState.error = null;
    store.loadLibrary().then((l) => { if (l) lib = l; render(); });
  } else if (err) {
    fbState.error = /permission/i.test(err.message) ? `no access to /${ROOT} yet (add the database rule)` : err.message;
    store.initLocal(DEMO);
  }
  render();
}).catch((e) => { fbState.error = "offline (" + e.message + ")"; render(); });
render();
