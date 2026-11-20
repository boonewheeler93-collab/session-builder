// Session timeline: places every part on a bar line of the grid running before it
// (CLAUDE.md §3 transition + grid rules). Pure function, no DOM.
//
// Input: resolved parts in session order, each
//   { id, type: countdown|walkin|beginsNow|song|moment, title, bpm, meter:[n,d],
//     lengthSec, countInBars, nudgeBars, pad:{on,key} }
// Output: { parts, tempoMap, markers, bounce, end, warnings }

/**
 * Seconds per bar. Simple meters count the tempo in beats of the bottom note (4/4 = 4 quarters).
 * Compound meters (6/8, 9/8, 12/8) count it in dotted quarters, as Planning Center and the click do:
 * 6/8 at 86 = 2 beats per bar. Checked against the 11/21–22 session, whose bar lines only line up this way.
 */
export function barSec(bpm, meter = [4, 4]) {
  const [n, d] = meter;
  const beats = d === 8 && n % 3 === 0 ? n / 3 : n * (4 / d);
  return (beats * 60) / (bpm || 120);
}

/** Snap t to the nearest bar line of a grid starting at origin. */
function snap(t, origin, bar) {
  const k = Math.round((t - origin) / bar);
  return { t: origin + k * bar, bar: k };
}

export function computeTimeline(items, settings) {
  const S = settings;
  const parts = [];
  const warnings = [];
  let grid = null; // { origin, bar, bpm, meter, title }
  let prevEnd = 0;
  let prev = null;

  const nextSongAfter = (i) => items.slice(i + 1).find((x) => x.type === "song");

  items.forEach((it, i) => {
    const p = { ...it };
    p.bar = barSec(p.bpm, p.meter);
    p.countIn = p.type === "song" || p.type === "walkin" ? (p.countInBars ?? S.countInBars) * p.bar : 0;
    if (it.countInSec != null) p.countIn = it.countInSec;
    const nudge = p.nudgeBars || 0;

    if (p.type === "countdown" || !grid) {
      p.start = 0;
    } else if (p.type === "moment") {
      // Starts on the bar line nearest the previous audio end; the grid switches to
      // the following song's tempo so pad and next song share one grid.
      const s = snap(prevEnd, grid.origin, grid.bar);
      p.idealStart = prevEnd;
      p.start = s.t + nudge * grid.bar;
      p.snapBar = s.bar + nudge;
      const ns = nextSongAfter(i);
      if (ns) { p.bpm = ns.bpm; p.meter = ns.meter; p.bar = barSec(p.bpm, p.meter); p.gridFrom = ns.title; }
    } else {
      // Downbeat (end of count-in) lands right after the previous audio ends.
      const idealDownbeat = prevEnd + (S.gapSec || 0);
      p.idealStart = idealDownbeat - p.countIn;
      if (prev?.type === "moment") {
        // After a moment: the moment's planned length decides the downbeat.
        p.idealStart = prev.start + prev.lengthSec - p.countIn;
      }
      const s = snap(p.idealStart, grid.origin, grid.bar);
      p.start = s.t + nudge * grid.bar;
      p.snapBar = s.bar + nudge;
      p.gridOf = grid.title;
      p.gridBarSec = grid.bar;
    }
    p.downbeat = p.start + p.countIn;
    p.end = p.start + (p.lengthSec || 0);
    if (prev && p.type !== "moment") {
      p.overlapPrev = Math.max(0, prevEnd - p.start);
      p.gapAfterPrev = p.downbeat - prevEnd; // + = silence before downbeat, − = previous still ringing
      if (p.gapAfterPrev < -0.05 && p.type !== "beginsNow") {
        warnings.push({ id: p.id, text: `${p.title}: downbeat lands ${(-p.gapAfterPrev).toFixed(1)} s before ${prev.title} ends — tails get faded` });
      }
      if (p.gapAfterPrev > 4) warnings.push({ id: p.id, text: `${p.title}: ${p.gapAfterPrev.toFixed(1)} s of space before the downbeat` });
    }
    if (p.start < 0) { warnings.push({ id: p.id, text: `${p.title} starts before 0:00` }); }

    if (p.type === "moment") {
      p.end = p.start + p.lengthSec;
      // the moment doesn't end the previous audio; the next song uses the moment end
      prevEnd = p.end;
    } else {
      prevEnd = p.end;
    }
    grid = { origin: p.start, bar: p.bar, bpm: p.bpm, meter: p.meter, title: p.title };
    parts.push(p);
    prev = p;
  });

  // Pad regions: fade in under the previous song's ending, out into the next song.
  parts.forEach((p, i) => {
    if (p.type !== "moment") return;
    const before = parts.slice(0, i).reverse().find((x) => x.type !== "moment");
    const after = parts.slice(i + 1).find((x) => x.type === "song");
    p.padStart = Math.max(0, (before ? before.end : p.start) - S.padFadeInSec);
    p.padEnd = (after ? after.downbeat : p.end) + S.padFadeOutSec;
    p.padLen = p.padEnd - p.padStart;
    p.padRepeats = Math.ceil(p.padLen / (S.padClipSec || 32));
  });

  // Tempo map: one event per part on its bar line (meter shown when it changes).
  const tempoMap = [];
  let lastMeter = null;
  for (const p of parts) {
    const m = p.meter.join("/");
    const last = tempoMap[tempoMap.length - 1];
    if (last && Math.abs(last.at - p.start) < 0.001) tempoMap.pop();
    tempoMap.push({ at: p.start, bpm: p.bpm, meter: m !== lastMeter ? m : null, label: p.title });
    lastMeter = m;
  }

  // Markers (song markers "N) TITLE" at the song's bar 1, like the 11/21–22 session).
  const markers = [{ at: 0, name: "StartTime: 55:00 // 25:00", fixed: true }];
  let n = 0;
  for (const p of parts) {
    if (p.type === "walkin") markers.push({ at: p.start, name: "COVER" });
    else if (p.type === "beginsNow") markers.push({ at: p.start, name: "BEGINS NOW" });
    else if (p.type === "song") markers.push({ at: p.start, name: `${++n}) ${p.title.toUpperCase()}` });
    else if (p.type === "moment") markers.push({ at: p.start, name: p.title.toUpperCase() });
  }
  const musical = parts.filter((p) => p.type !== "countdown");
  const end = Math.max(...parts.map((p) => (p.padEnd ? Math.max(p.end, p.padEnd) : p.end)), 0);
  markers.push({ at: end, name: "END" });

  const firstBounce = parts.find((p) => p.type === "walkin") || parts.find((p) => p.type === "beginsNow") || musical[0];
  const lastSong = [...parts].reverse().find((p) => p.type === "song");
  const bounce = firstBounce && lastSong ? { start: firstBounce.start, end: lastSong.end } : null;

  return { parts, tempoMap, markers, bounce, end, warnings };
}

export function fmt(t, dec = 0) {
  if (t == null || isNaN(t)) return "–";
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = dec ? s.toFixed(dec).padStart(3 + dec, "0") : String(Math.floor(s)).padStart(2, "0");
  return (neg ? "−" : "") + m + ":" + ss;
}
