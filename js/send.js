// "Send to Planning Center": works out what would change in the plan (CLAUDE.md §1 rules).
// The planner only writes a request to Firebase; the pco-tools job does the writing with Boone's token.
// Rules: never edit or move template items or existing items; rename the "Walk-in:" placeholder; add new
// songs (song items with arrangement, plan key, length from stems) and in-set moments under WORSHIP in set
// order, after BEGINS NOW and before STAGE TIME. Songs missing from PCO's song library: ask, don't guess.

const walkinTitle = (r) => `Walk-in:  ${r.title}${r.song?.artist ? " - " + r.song.artist : ""}`;
const secs = (x) => (x == null ? null : Math.round(x));

/** Returns { changes, keep, warnings, blockers }. */
export function planSend(w, B) {
  const changes = [];
  const keep = [];
  const warnings = [];
  const blockers = [];
  let after = "BEGINS NOW"; // insertion anchor: the item the next new item goes after

  for (const r of B.resolved) {
    const it = r.item;
    if (r.type === "countdown") continue; // template item, never touched
    if (r.type === "beginsNow") { keep.push({ title: "BEGINS NOW", why: "template item" }); after = "BEGINS NOW"; continue; }

    if (r.type === "walkin") {
      const fromPlan = (it.pcoTitle || "").replace(/^walk-in:\s*/i, "").trim();
      if (!r.song) {
        if (!fromPlan) warnings.push("No walk-in chosen — the Walk-in: placeholder stays as it is.");
        else keep.push({ title: it.pcoTitle, why: "already in the plan" });
        continue;
      }
      const want = walkinTitle(r);
      if (!fromPlan) {
        changes.push({ op: "rename", itemId: it.pcoItemId || null, from: it.pcoTitle || "Walk-in:", title: want, lengthSec: secs(r.lengthSec), kind: "plain",
          text: `Rename “${it.pcoTitle || "Walk-in:"}” to “${want}”, length ${fmtLen(r.lengthSec)}` });
      } else if (norm(fromPlan) !== norm(want.replace(/^walk-in:\s*/i, ""))) {
        changes.push({ op: "rename", itemId: it.pcoItemId || null, from: it.pcoTitle, title: want, lengthSec: secs(r.lengthSec), kind: "plain", confirm: true,
          text: `Change the walk-in from “${it.pcoTitle}” to “${want}”` });
        warnings.push(`The plan already names a different walk-in (“${fromPlan}”). Sending replaces that title — tick it below to allow it.`);
      } else keep.push({ title: it.pcoTitle, why: "already in the plan" });
      continue;
    }

    const isNew = !!it.addedHere || !it.pcoTitle;
    if (!isNew) { keep.push({ title: it.pcoTitle || r.title, why: "already in the plan" }); after = it.pcoTitle || r.title; continue; }

    if (r.type === "song") {
      if (!r.planKey) blockers.push(`${r.title}: choose a plan key before sending.`);
      changes.push({
        op: "add", kind: "song", title: r.title, after, key: r.planKey || null, lengthSec: secs(r.lengthSec),
        arrangement: r.version?.name || null, libPath: r.song?.path || null, ifNotInSongLibrary: "ask",
        text: `Add song “${r.title}”${r.planKey ? " in " + r.planKey : ""}, ${fmtLen(r.lengthSec)}, after ${after}`,
      });
      after = r.title;
    } else if (r.type === "moment") {
      changes.push({ op: "add", kind: "plain", title: r.title, after, lengthSec: secs(r.lengthSec),
        text: `Add “${r.title}” (${fmtLen(r.lengthSec)}) after ${after}` });
      after = r.title;
    }
  }

  // Existing plan items moved or removed here stay as they are in Planning Center.
  const planOrder = B.resolved.filter((r) => r.item.pcoTitle && !r.item.addedHere && r.type === "song").map((r) => r.item.pcoOrder).filter((x) => x != null);
  if (planOrder.some((x, i) => i && x < planOrder[i - 1])) warnings.push("You reordered songs that are already in the plan. Their order in Planning Center stays as it is — move them there if needed.");
  for (const t of w.removedFromPlan || []) warnings.push(`“${t}” was removed here but stays in Planning Center (the planner never deletes plan items).`);
  if (changes.some((c) => c.kind === "song")) warnings.push("Songs not in Planning Center's song library: the job stops and asks before creating a song or adding it as a plain item.");
  return { changes, keep, warnings, blockers };
}

function fmtLen(s) {
  if (s == null) return "–";
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
