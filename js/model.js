// Turns a weekend's items + library + saved song data into resolved parts the
// timeline and UI use. Pure functions, no DOM.
import {
  findWorshipSong, findWalkin, pickVersion, stemKeyFor, shiftBetween, mapVersion,
  splitTitleHints, padKeyFor, keyName, norm,
} from "./music.js";
import { computeTimeline } from "./timing.js";
import { MOMENT_TITLES, PAD_DEFAULT_ON, PAD_DIR } from "./config.js";

/** Firebase-safe key for per-song saved data. */
export const metaKey = (path, version) =>
  encodeURIComponent(`${path}|${version || ""}`).replace(/\./g, "%2E");

export function libSong(lib, item) {
  if (!lib || !item.libPath) return null;
  const list = item.type === "walkin" ? lib.walkins : lib.worship;
  return (list || []).find((s) => s.path === item.libPath) || null;
}

/** Find the library song for an item that has none yet (from its PCO title). */
export function autoMatch(lib, item) {
  if (item.libPath || !lib) return item;
  if (item.type === "walkin") {
    const w = findWalkin(lib, item.title + (item.artist ? " " + item.artist : "")) || findWalkin(lib, item.title);
    return w ? { ...item, libPath: w.path, matchedBy: "auto" } : item;
  }
  if (item.type === "song") {
    const s = findWorshipSong(lib, item.pcoTitle || item.title);
    if (!s) return item;
    const { hints } = splitTitleHints(item.pcoTitle || item.title);
    const v = pickVersion(s, { hints, planKey: item.planKey, arrangement: item.pcoArrangement?.name });
    return { ...item, libPath: s.path, version: item.version || v?.name, matchedBy: "auto" };
  }
  return item;
}

const isFormNote = (n) =>
  /^\s*\*/.test(n) && (/>/.test(n) || /\b(start|end|ending|chorus|verse|bridge|tag|intro|turn|extra|skip|repeat|cut|outro|vamp)\b/i.test(n));

/** Resolve one item. Returns an object with everything the UI shows. */
export function resolveItem(item, ctx, index, all) {
  const { lib, meta, settings } = ctx;
  const r = { item, flags: [], steps: [], edits: [], id: item.id, type: item.type, title: item.title };
  const S = settings;
  if (item.type === "countdown" || item.type === "beginsNow") {
    const cd = item.type === "countdown";
    const file = item.file || (cd ? S.countdownFile : S.beginsNowFile);
    const entry = (lib?.music || []).find((m) => m.path === file);
    const fallback = cd ? S.countdownSec : S.beginsNowSec;
    const isDefault = !item.file || item.file === (cd ? S.countdownFile : S.beginsNowFile);
    Object.assign(r, {
      bpm: cd ? S.countdownBpm : S.beginsNowBpm, meter: [4, 4], lane: "video",
      file, fileName: file.split("/").pop(), fileSource: isDefault ? "Default (Settings)" : "Chosen for this weekend",
      lengthSec: item.lengthSec ?? (entry?.exact ? entry.secs : isDefault ? fallback : entry?.secs ?? fallback),
      lengthApprox: !(entry?.exact) && !(isDefault && cd),
    });
    if (lib?.music && !entry) r.flags.push({ level: "warn", text: `${r.fileName} not found in Dropbox — check the path in Settings` });
    return r;
  }
  if (item.type === "moment") {
    const next = all.slice(index + 1).find((x) => x.type === "song");
    const fromNote = (item.notes || []).map((n) => n.match(/key of\s+([A-G][#b]?m?)/i)).find(Boolean);
    const want = item.pad?.key || (fromNote ? fromNote[1] : next?.planKey);
    const pk = padKeyFor(want);
    const padOn = item.pad?.on ?? PAD_DEFAULT_ON.test(item.title);
    Object.assign(r, {
      lengthSec: item.lengthSec ?? item.planLengthSec ?? S.momentSec,
      lane: "pad", padOn, padKey: pk.key,
      padKeySource: item.pad?.key ? "Set here" : fromNote ? "From the note" : next?.planKey ? `Next song's key (${next.title})` : "Unknown",
      padFile: pk.key ? `${PAD_DIR}/Reverence ${pk.key}.wav` : null,
      bpm: 0, meter: [4, 4],
    });
    if (padOn && !pk.key) r.flags.push({ level: "warn", text: "Pad key unknown — pick one" });
    if (pk.fromMinor) r.flags.push({ level: "warn", text: `${pk.fromMinor} isn't in the Reverence pack — using relative major ${pk.key}` });
    if (item.notInPlan) r.flags.push({ level: "info", text: "Not in the Planning Center plan — added here" });
    return r;
  }

  // walk-in or song
  const song = libSong(lib, item);
  r.song = song;
  r.lane = "music";
  if (!song) {
    r.flags.push({ level: "error", text: lib ? "No stem folder matched — pick one in the song bank" : "Library not loaded" });
    Object.assign(r, { bpm: item.bpm || 120, meter: item.meter || [4, 4], lengthSec: item.lengthSec || item.planLengthSec || 240, stub: true });
    return r;
  }
  const version = song.versions.find((v) => v.name === item.version) || pickVersion(song, { planKey: item.planKey, hints: splitTitleHints(item.pcoTitle || "").hints, arrangement: item.pcoArrangement?.name });
  r.version = version;
  const m = meta[metaKey(song.path, version?.name)] || {};
  r.meta = m;
  const click = version?.click;
  const arr = item.pcoArrangement || {};
  const exactClick = click?.bpmExact ? click.bpm : null;
  // Trust order: set this weekend > confirmed for the song > exact click name > Planning Center arrangement > rough click name
  r.bpm = item.bpm ?? m.bpm ?? exactClick ?? arr.bpm ?? click?.bpm ?? 120;
  r.bpmSource = item.bpm != null ? "Set for this weekend" : m.bpm != null ? `Confirmed${m.bpmBy ? " by " + m.bpmBy : ""}`
    : exactClick ? `From ${click.file.replace(/\.wav$/i, "")}` : arr.bpm ? `Planning Center arrangement “${arr.name || ""}”`
    : click?.bpm ? `Click says "${click.file.match(/\(([^)]*\d[^)]*)\)/)?.[1] || "≈" + click.bpm}"` : click ? "Click has no BPM in its name" : "No click — enter BPM";
  r.bpmNeedsConfirm = item.bpm == null && m.bpm == null && !exactClick && !arr.bpm;
  if (r.bpmNeedsConfirm) r.flags.push({ level: "warn", text: click ? `BPM inexact (${r.bpmSource}) — enter the exact BPM once` : "No click stem — enter BPM" });
  if (exactClick && arr.bpm && Math.abs(arr.bpm - exactClick) > 0.5 && item.bpm == null && m.bpm == null) {
    const half = Math.abs(arr.bpm - exactClick * 2) < 1 || Math.abs(arr.bpm * 2 - exactClick) < 1;
    r.flags.push({ level: half ? "info" : "warn", text: `Planning Center says ${arr.bpm} BPM, the click says ${exactClick}${half ? " (half/double time) — using the click" : " — using the click; confirm which is right"}` });
  }
  const arrMeter = /^\d+\/\d+$/.test(arr.meter || "") ? arr.meter.split("/").map(Number) : null;
  r.meter = item.meter || m.meter || arrMeter || [4, 4];
  r.meterSource = item.meter ? "Set for this weekend" : m.meter ? "Confirmed" : arrMeter ? "Planning Center arrangement" : "Default";
  r.countInBars = item.countInBars ?? m.countInBars;
  const full = version ? version.lengthSec : 0;
  r.fileLengthSec = full;
  r.lengthSec = item.lengthSec ?? full;
  r.lengthApprox = !version?.exact;
  if (item.lengthSec != null) r.trimmed = true;

  // stems → tracks
  r.map = mapVersion(version);
  const unmapped = r.map.filter((x) => !x.track);
  if (unmapped.length) r.flags.push({ level: "warn", text: `${unmapped.length} stem${unmapped.length > 1 ? "s" : ""} with no track: ${unmapped.map((x) => x.stem).join(", ")}` });
  if (!click) r.flags.push({ level: "warn", text: "No CLICK stem in this version" });

  // keys (songs only; walk-ins play in their own key)
  if (item.type === "song") {
    r.planKey = keyName(item.planKey);
    r.stemKey = stemKeyFor(song, version, m, arr.chord_chart_key);
    r.shift = r.planKey && r.stemKey.key ? shiftBetween(r.stemKey.key, r.planKey) : null;
    if (!r.planKey) r.flags.push({ level: "warn", text: "No plan key" });
    if (!r.stemKey.key) r.flags.push({ level: "warn", text: "Stem key unknown — confirm it" });
    else if (r.stemKey.guess) r.flags.push({ level: "warn", text: `Stem key ${r.stemKey.key} is the record key — confirm the stems are in ${r.stemKey.key}` });
    r.pnt = item.transpose === "pnt";
    if (r.shift) {
      if (r.pnt) r.steps.push(`Pitch ’n Time ${r.shift > 0 ? "+" : "−"}${Math.abs(r.shift)} on pitched stems`);
      if (Math.abs(r.shift) >= 3) r.flags.push({ level: "info", text: `Shift of ${Math.abs(r.shift)} semitones — listen to the A/B preview after the build` });
    }
  }
  // Arrangement edits from Planning Center notes (§2 song sections will apply these automatically and
  // Boone reviews them; until that feature exists they are done by hand after the build).
  for (const n of item.notes || []) if (isFormNote(n)) r.edits.push(n.replace(/^\s*\*\s*/, ""));
  return r;
}

/** Resolve all items, then lay out the timeline. */
export function buildWeekend(weekend, ctx) {
  const items = (weekend.items || []).map((it) => autoMatch(ctx.lib, it));
  const resolved = items.map((it, i) => resolveItem(it, ctx, i, items));
  const parts = resolved.map((r) => ({
    id: r.id, type: r.type, title: r.title, bpm: r.bpm, meter: r.meter, lengthSec: r.lengthSec,
    countInBars: r.countInBars, countInSec: r.item.countInSec, nudgeBars: r.item.nudgeBars || 0,
  }));
  const tl = computeTimeline(parts, ctx.settings);
  tl.parts.forEach((p, i) => Object.assign(resolved[i], { t: p }));
  const songs = resolved.filter((r) => r.type === "song");
  const steps = resolved.flatMap((r) => r.steps.map((s) => ({ id: r.id, title: r.title, text: s })));
  const edits = resolved.flatMap((r) => r.edits.map((s) => ({ id: r.id, title: r.title, text: s })));
  const flags = resolved.flatMap((r) => r.flags.map((f) => ({ ...f, id: r.id, title: r.title })));
  // Work left for a person after the build: manual steps plus edits song sections can't apply yet.
  const handWork = [...edits.map((e) => ({ ...e, text: "Arrangement: " + e.text })), ...steps];
  return { items, resolved, tl, songs, steps, edits, handWork, flags };
}

/** Is this PCO item an in-set moment (pastoral moment etc.)? */
export const isMomentTitle = (t) => MOMENT_TITLES.test(t || "");

/** Session folder name from the weekend dates: !NKC.MM.DD-DD */
export function sessionName(w) {
  if (w.sessionName) return w.sessionName;
  const a = new Date(w.sat + "T12:00:00"), b = new Date((w.sun || w.sat) + "T12:00:00");
  const p = (n) => String(n).padStart(2, "0");
  return `!NKC.${p(a.getMonth() + 1)}.${p(a.getDate())}-${p(b.getDate())}`;
}

export function weekendTitle(w) {
  const a = new Date(w.sat + "T12:00:00"), b = new Date((w.sun || w.sat) + "T12:00:00");
  const mon = a.toLocaleString("en-US", { month: "short" });
  if (!w.sun || w.sun === w.sat) return `${mon} ${a.getDate()}`;
  const mon2 = b.toLocaleString("en-US", { month: "short" });
  return mon === mon2 ? `${mon} ${a.getDate()}–${b.getDate()}` : `${mon} ${a.getDate()} – ${mon2} ${b.getDate()}`;
}

export { norm };
