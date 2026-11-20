// Test data used until the sync job writes real Planning Center plans to Firebase.
// Nov 21–22 mirrors the finished plan and Ana's 11/21–22 session; the
// nudges reproduce that session's placements on the new bar-line grid.
const now = Date.now();
const H = 3600e3;

export const DEMO = {
  seedVersion: 7,
  settings: {},
  machines: {
    boone: { name: "Boone's MacBook", owner: "Boone", online: true, proTools: true, lastSeen: now - 60e3, kind: "laptop" },
    ana: { name: "Ana's laptop", owner: "Ana", online: false, proTools: false, lastSeen: now - 50 * H, kind: "laptop" },
    booth: { name: "Booth Mac mini", owner: "", online: true, proTools: false, lastSeen: now - 5 * 60e3, kind: "booth" },
  },
  sync: { lastRun: now - 12 * 60e3, ok: true },
  songMeta: {},
  jobs: {},
  sends: {},
  weekends: {
    "pco-nov21": {
      sat: "2026-11-21", sun: "2026-11-22", serviceType: "Northland | Weekend", pcoPlanId: "demo-1121",
      source: "pco", planTotal: "63:27", demo: true,
      items: [
        { id: "cd", type: "countdown", title: "Countdown" },
        {
          id: "wi", type: "walkin", title: "Waiting On The World To Change", artist: "John Mayer",
          pcoTitle: "Walk-in:  Waiting On The World To Change - John Mayer", notes: ["+ Boone", "*BGV's"],
          libPath: "+ WALK-IN/Waiting On The World To Change (John Mayer)", version: "Default", nudgeBars: -4,
          planLengthSec: 199,
        },
        { id: "bn", type: "beginsNow", title: "Begins Now", planLengthSec: 29, nudgeBars: -3 },
        {
          id: "s1", type: "song", title: "The Joy", pcoTitle: "The Joy", planKey: "G", planLengthSec: 291,
          notes: ["+ Tara", "*WELCOME"], nudgeBars: -3, lengthSec: 290, transpose: "auto",
        },
        {
          id: "s2", type: "song", title: "I Know A Name", pcoTitle: "I Know A Name", planKey: "D", planLengthSec: 282,
          notes: ["+ Boone"], version: "I Know A Name (Short To 530m)", meter: [6, 8], nudgeBars: 2, lengthSec: 279,
        },
        { id: "pm", type: "moment", title: "Pastoral Moment", notes: ["+ Ana"], lengthSec: 30, pad: { on: true }, nudgeBars: 2, notInPlan: true },
        {
          id: "s3", type: "song", title: "More Than Able", pcoTitle: "More Than Able", planKey: "D", planLengthSec: 456,
          notes: ["+ Boone / Ana"], meter: [6, 8], nudgeBars: 8, lengthSec: 454,
        },
      ],
      build: { status: "built", machine: "ana", by: "Ana", at: now - 60 * H },
    },
    "pco-nov28": {
      sat: "2026-11-28", sun: "2026-11-29", serviceType: "Northland | Weekend", pcoPlanId: "demo-1128",
      source: "pco", planTotal: "52:46", demo: true,
      items: [
        { id: "cd", type: "countdown", title: "Countdown" },
        { id: "wi", type: "walkin", title: "", pcoTitle: "Walk-in:", placeholder: true, planLengthSec: 240 },
        { id: "bn", type: "beginsNow", title: "Begins Now", planLengthSec: 40 },
        { id: "s1", type: "song", title: "The Love Of Jesus", pcoTitle: "The Love of Jesus", planKey: "D", planLengthSec: 336, notes: [] },
      ],
    },
    "pco-nov14": {
      sat: "2026-11-14", sun: "2026-11-15", serviceType: "Northland | Weekend", pcoPlanId: "demo-1114",
      source: "pco", demo: true, past: true,
      items: [
        { id: "cd", type: "countdown", title: "Countdown" },
        { id: "bn", type: "beginsNow", title: "Begins Now" },
        { id: "s1", type: "song", title: "Standing In Victory", pcoTitle: "Standing In Victory", planKey: "Bb", notes: [] },
      ],
      build: { status: "uploaded", machine: "ana", by: "Ana", at: now - 7 * 24 * H },
    },
  },
};
