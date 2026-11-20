// Keys, stem → track mapping, version matching. Pure functions, no DOM.
import { TEMPLATE_TRACKS, KNOWN_KEYS, OUTPUT_OF } from "./config.js";

export const KEYS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SHARP = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb", "E#": "F", "B#": "C", Fb: "E", Cb: "B" };

/** Parse "F#", "Bbm", "c#m" → { root: "Gb", minor: false } or null. */
export function parseKey(k) {
  if (!k) return null;
  const m = String(k).trim().match(/^([A-Ga-g])([#b]?)(m(?!aj))?/);
  if (!m) return null;
  let root = m[1].toUpperCase() + (m[2] || "");
  root = SHARP[root] || root;
  if (!KEYS.includes(root)) return null;
  return { root, minor: !!m[3] };
}
export const keyName = (k) => { const p = parseKey(k); return p ? p.root + (p.minor ? "m" : "") : ""; };
export const keyIndex = (k) => { const p = parseKey(k); return p ? KEYS.indexOf(p.root) : -1; };

/** Smallest semitone shift from → to, in −5…+6 (ties prefer up). */
export function shiftBetween(from, to) {
  const a = keyIndex(from), b = keyIndex(to);
  if (a < 0 || b < 0) return null;
  let d = (((b - a) % 12) + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}
export const fmtShift = (s) => (s == null ? "?" : s === 0 ? "0" : (s > 0 ? "+" : "−") + Math.abs(s));

/** Relative major of a minor key (pads only exist in major). */
export function padKeyFor(k) {
  const p = parseKey(k);
  if (!p) return { key: null };
  if (!p.minor) return { key: p.root };
  return { key: KEYS[(KEYS.indexOf(p.root) + 3) % 12], fromMinor: p.root + "m" };
}

// ---------- stem → template track ----------
const TRACK_BY_UPPER = Object.fromEntries(TEMPLATE_TRACKS.map((t) => [t.toUpperCase(), t]));
const EG_SUPPORT = ["EG LEAD 1 SUPPORT 1", "EG LEAD 1 SUPPORT 2", "EG LEAD 2 SUPPORT 1", "EG LEAD 2 SUPPORT 2", "EG LEAD 3 SUPPORT 1"];

const RULES = [
  [/^CLICK\b/, () => "CLICK"],
  [/^COUNT\b/, () => "COUNT"],
  [/^GUIDE\b/, () => "GUIDE"],
  [/^LOOPS?( ?1)?$/, () => "LOOP 1"],
  [/^LOOPS? ?2$/, () => "LOOP 2"],
  [/^(PERC|PERCUSSION)( ?1)?$/, () => "LOOP 2"],
  [/^(FX|SFX|SYNTH FX)$/, () => "FX"],
  [/^DRUMS?$/, () => "drums"],
  [/^BASS$/, () => "bass"],
  [/^(BASS SYNTH|SYNTH BASS|SUB BASS)$/, () => "BASS SYNTH"],
  [/^ORGAN$/, () => "ORGAN"],
  [/^(ACOUSTIC|AG|ACOUSTIC GUITAR|ACOUSTIC 1|AG ?1)$/, () => "AG"],
  [/^PIANO( ?1)?$/, () => "piano 1"],
  [/^PIANO ?2$/, () => "PIANO 2"],
  [/^KEYS?$/, () => "KEYS 1"],
  [/^KEYS? ?([1-4])$/, (m) => "KEYS " + m[1]],
  [/^EG ?([1-5])$/, (m) => EG_SUPPORT[+m[1] - 1]],
  [/^(BGV|BGVS)( ?1)?$/, () => "BGV 1"],
  [/^BGVS? ?([2-4])$/, (m) => "BGV " + m[1]],
  [/^CHOIR( ?1)?$/, () => "BGV 2"],
  [/^CHOIR ?2$/, () => "BGV 3"],
  [/^(TRACK|TRK)$/, () => "TRACK 1"],
  [/^(LV|LEAD VOCAL|LEAD VOX|LEADVOCAL|LEAD VOC)$/, () => "lead vocal"],
  [/^STRINGS$/, () => "STRINGS"],
  [/^(VFX|VOX FX)$/, () => "VFX"],
  [/^PADS?$/, () => "PAD"],
];
// Mappings the brief marks "(confirm)".
const CONFIRM = new Set(["STRINGS"]);

/** Map one stem name to a template track. Returns { track, how, confirm } or { track: null }. */
export function trackForStem(stem) {
  const s = String(stem).toUpperCase().replace(/\s+/g, " ").trim();
  if (TRACK_BY_UPPER[s]) return { track: TRACK_BY_UPPER[s], how: "same name" };
  for (const [re, fn] of RULES) {
    const m = s.match(re);
    if (m) { const track = fn(m); return { track, how: "rule", confirm: CONFIRM.has(s) }; }
  }
  return { track: null };
}

const PITCH_FROM = TEMPLATE_TRACKS.indexOf("BASS SYNTH");
export const isPitchedTrack = (t) => TEMPLATE_TRACKS.indexOf(t) >= PITCH_FROM;
const FORMANT_ON = /^(lead vocal|BGV|AG|piano|PIANO|eg |EG |STRINGS|TRACK)/;
export const formantDefault = (t) => FORMANT_ON.test(t);

/**
 * Stem → track map for one version. Handles collisions (two stems on one track):
 * TRACK gets TRACK 2 as its alternate; others are flagged.
 */
export function mapVersion(version) {
  const used = new Map();
  const rows = (version?.stems || []).map((st) => {
    const r = trackForStem(st.stem);
    const row = { stem: st.stem, file: st.file, secs: st.secs, exact: st.exact, track: r.track, confirm: r.confirm, flags: [] };
    if (!r.track) row.flags.push("No template track — choose one or leave out");
    else if (used.has(r.track)) {
      const alt = r.track === "TRACK 1" ? "TRACK 2" : null;
      if (alt && !used.has(alt)) row.track = alt;
      else { row.flags.push(`${r.track} already has ${used.get(r.track)}`); row.track = null; }
    }
    if (row.track) {
      used.set(row.track, st.stem);
      row.output = OUTPUT_OF(row.track);
      row.pitched = isPitchedTrack(row.track);
      row.formant = row.pitched && formantDefault(row.track);
      if (row.track === "lead vocal") row.muted = true;
    }
    if (r.confirm) row.flags.push("Mapping to confirm");
    return row;
  });
  rows.sort((a, b) => (a.track ? TEMPLATE_TRACKS.indexOf(a.track) : 999) - (b.track ? TEMPLATE_TRACKS.indexOf(b.track) : 999));
  return rows;
}

// ---------- library matching ----------
export const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Strip PCO version hints: "Holy Forever (SHORT)" → { base: "Holy Forever", hints: ["short"] } */
export function splitTitleHints(title) {
  const hints = [];
  let base = String(title || "");
  base = base.replace(/\(([^)]*)\)/g, (_, h) => { hints.push(h.toLowerCase()); return ""; }).replace(/\s+/g, " ").trim();
  return { base, hints };
}

export function findWorshipSong(lib, title) {
  if (!lib) return null;
  const { base } = splitTitleHints(title);
  const n = norm(base);
  const list = lib.worship || [];
  const score = (s) => (s.collection === "" ? 0 : s.collection === "Stem Archive" ? 2 : s.collection === "Archive" ? 3 : 1);
  const hits = list.filter((s) => norm(s.title) === n && !s.noStems).sort((a, b) => score(a) - score(b));
  if (hits.length) return hits[0];
  return list.find((s) => norm(s.title).startsWith(n) && !s.noStems) || null;
}

export function findWalkin(lib, name) {
  if (!lib || !name) return null;
  const n = norm(name);
  const list = lib.walkins || [];
  return (
    list.find((w) => norm(w.title) === n) ||
    list.find((w) => norm(`${w.title} ${w.artist || ""}`) === n) ||
    list.find((w) => n.startsWith(norm(w.title)) && norm(w.title).length > 6) ||
    list.find((w) => norm(w.title).startsWith(n) && n.length > 6) ||
    null
  );
}

/** Pick a version: title hints first, then the key folder nearest the plan key. */
export function pickVersion(song, { hints = [], planKey, arrangement } = {}) {
  const vs = song?.versions || [];
  if (!vs.length) return null;
  // Planning Center arrangement name vs version folder: "Short To 5:30m" ~ "I Know A Name (Short To 530m)"
  const compact = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (arrangement && compact(arrangement).length > 3) {
    const v = vs.find((v) => compact(v.name).includes(compact(arrangement)));
    if (v) return v;
  }
  const want = hints.join(" ");
  if (/short/.test(want)) { const v = vs.find((v) => /short/i.test(v.name)); if (v) return v; }
  if (/long/.test(want)) { const v = vs.find((v) => /long/i.test(v.name)); if (v) return v; }
  const keyed = vs.filter((v) => v.kind === "key");
  if (keyed.length && planKey) {
    let best = null;
    for (const v of keyed) {
      const s = shiftBetween(v.key, planKey);
      if (s == null) continue;
      const cost = Math.abs(s) * 2 + (v.original ? 0 : 0.5);
      if (!best || cost < best.cost) best = { v, cost };
    }
    if (best) return best.v;
  }
  return vs.find((v) => /full/i.test(v.name)) || vs.find((v) => v.original) || vs[0];
}

/**
 * Stem key for a song/version, with where it came from (order of trust, CLAUDE.md §2).
 * meta = saved per-song data { stemKey, stemKeyBy } keyed by song path + version.
 */
export function stemKeyFor(song, version, meta, chartKey) {
  if (meta?.stemKey) return { key: meta.stemKey, source: "Confirmed", by: meta.stemKeyBy, trust: 1 };
  if (version?.kind === "key") return { key: version.key, source: "Key folder", trust: 2 };
  if (version?.keyTag) return { key: version.keyTag, source: "Filename tag", trust: 2 };
  const known = KNOWN_KEYS[norm(song?.title)];
  if (known?.stem) return { key: known.stem, source: known.stemSource, trust: 1 };
  if (song?.chartKeys?.length === 1) return { key: song.chartKeys[0], source: "Chart filename", trust: 3 };
  if (version?.keyHint || song?.keyHint) return { key: version?.keyHint || song.keyHint, source: "Folder name", trust: 4 };
  if (known?.record) return { key: known.record, source: "Record key (stems may differ)", trust: 4, guess: true };
  if (chartKey) return { key: keyName(chartKey), source: "Planning Center chart key (stems may differ)", trust: 4, guess: true };
  return { key: null, source: "Unknown — confirm or run detection", trust: 9 };
}

export const versionLength = (v) => (v ? v.lengthSec : 0);
