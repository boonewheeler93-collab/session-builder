# Northland Session Builder — planner

Static web app (GitHub Pages, no build step). Plans the weekend set, matches each song to its
Dropbox stem folder, lays out the Pro Tools timeline on bar lines, and sends Build requests to the
laptop helper through Firebase.

## Run locally

```bash
cd planner && python3 -m http.server 8765
```

Open http://127.0.0.1:8765. Without sync it runs in **test mode**: sample weekends, data kept in
this browser only.

The song bank needs a library index. Until the laptop helper publishes it to Firebase, make a
local one (read-only scan of the Dropbox folder; never downloads or changes anything):

```bash
python3 ../helper/library_index.py --out data/library.json
```

`data/library.json` is git-ignored so the library listing is not published on Pages.

## Firebase

Same project and shared sync password as start-times (`start-times-77f2f`, Realtime Database).
Everything lives under `sessionBuilder/`; nothing touches `startTimes/`. Add this next to the
existing `startTimes` rule in the Realtime Database rules (use the same condition start-times uses
if it's stricter than `auth != null`):

```json
"sessionBuilder": {
  ".read": "auth != null",
  ".write": "auth != null"
}
```

Paths: `weekends/{planId}` (items, build status), `songMeta/{song|version}` (confirmed BPM, meter,
stem key), `jobs/{id}` (build requests the helper claims), `machines/{id}` (helper presence),
`sends/{id}` (Send to Planning Center requests), `settings`, `sync`, `library` (helper-published index).

## Files

- `js/timing.js` — bar-line grid placement (count-ins, snapping, pads, tempo map, markers, bounce range)
- `js/music.js` — keys and shifts, stem → template track map, version matching
- `js/model.js` — resolves a weekend's items against the library into what the UI shows
- `js/store.js` — Firebase / local store
- `js/app.js` — screens (weekends, weekend list + detail + timeline, song bank, build, settings)
- `js/demo.js` — sample plans used in test mode (Nov 21–22 reproduces the 11/21–22 session)
