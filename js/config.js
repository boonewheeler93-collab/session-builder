// Shared constants for the planner. Anything Boone may want to change week to
// week lives in Settings (stored in Firebase); these are the defaults.

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBk7mDjK3-4NIExIUw01ru1Y4yvvhvJwmc",
  authDomain: "start-times-77f2f.firebaseapp.com",
  databaseURL: "https://start-times-77f2f-default-rtdb.firebaseio.com",
  projectId: "start-times-77f2f",
  storageBucket: "start-times-77f2f.firebasestorage.app",
  messagingSenderId: "326841126924",
  appId: "1:326841126924:web:d22137f73819b54d661e29",
};
export const FB_VERSION = "10.12.2";
// Same shared sign-in as start-times: every device unlocks with one password.
export const SYNC_LOGIN = "booth@northland-start-times.app";
// Everything this app writes lives under this one top-level path.
export const ROOT = "sessionBuilder";

export const DEFAULT_SETTINGS = {
  countdownBpm: 120,
  beginsNowBpm: 150,
  countdownSec: 311,      // 2024 Countdown Audio (5min) V2.wav, 0:00–5:11 in the 11/21–22 session
  beginsNowSec: 36,       // LC_23_Begins Now.wav, 8:17–8:53 in the 11/21–22 session
  countInBars: 2,
  gapSec: 0,              // downbeat lands this long after the previous audio ends
  padFadeInSec: 5,        // pad starts fading in this long before the previous song ends
  padFadeOutSec: 7,       // and fades out over this long into the next song
  momentSec: 30,
  padClipSec: 32,
};

// Build template track order (52 tracks; the SMPTE track is added later by lighting).
export const TEMPLATE_TRACKS = [
  "VIDEO", "CLICK", "COUNT", "GUIDE", "LOOP 1", "LOOP 2", "FX", "drums", "BASS SYNTH", "bass", "AG",
  "eg lead 1", "eg lead 2", "eg lead 3", "eg lead 4",
  "EG LEAD 1 SUPPORT 1", "EG LEAD 1 SUPPORT 2", "EG LEAD 2 SUPPORT 1", "EG LEAD 2 SUPPORT 2", "EG LEAD 3 SUPPORT 1",
  "EG RHYTHM 1", "EG RHYTHM 2", "EG RHYTHM 3", "EG RHYTHM 4", "EG TEXTURE 1", "EG TEXTURE 2",
  "KEYS 1", "KEYS 2", "KEYS 3", "KEYS 4", "piano 1", "PIANO 2", "ORGAN", "PAD",
  "SYNTH LEAD 1", "SYNTH LEAD 2", "SYNTH LEAD 3", "SYNTH PULSE 1", "SYNTH MOTION", "SYNTH STRINGS", "SYNTH AIR",
  "SYNTH TEXTURE 1", "SYNTH TEXTURE 2", "STRINGS", "lead vocal", "BGV 1", "BGV 2", "BGV 3", "BGV 4", "VFX",
  "TRACK 1", "TRACK 2",
];

// Booth output busses (§3b). drums and bass go to REF (heard on laptops, silent at the booth).
export const OUTPUT_OF = (track) => {
  const t = track.toUpperCase();
  if (t === "CLICK") return "CLICK";
  if (t === "COUNT" || t === "GUIDE") return "COUNT";
  if (/^LOOP|^FX$/.test(t)) return "LOOP";
  if (t === "BASS SYNTH") return "BASS";
  if (t === "DRUMS" || t === "BASS") return "REF";
  if (/^(AG|EG )/.test(t)) return "GUITARS";
  if (/^(KEYS|ORGAN|PAD|SYNTH|STRINGS)/.test(t)) return "KEYS";
  if (/^PIANO/.test(t)) return "PIANO";
  if (/^(LEAD VOCAL|BGV|VFX)/.test(t)) return "BGVS";
  if (/^(VIDEO|TRACK)/.test(t)) return "PT VID";
  return "?";
};

// Record keys Boone has confirmed or that were looked up (CLAUDE.md §2). Record key is
// NOT always the stem key; stemKey here is only set where Boone confirmed it.
export const KNOWN_KEYS = {
  "standing in victory": { record: "B", stem: "Bb", stemSource: "Confirmed by Boone" },
  "the blood": { record: "G", stem: "G", stemSource: "Filename tag, chart and detection agree" },
  "i know a name": { record: "C" },
  "the lord is with me": { record: "Eb" },
  "room": { record: "Ab" },
  "no one like the lord": { record: "E" },
};

export const PAD_DIR = "_NKC PROTOOLS COMPUTER/MUSIC/01 REVERENCE";
export const MOMENT_TITLES = /^(pastoral moment|song intro|baptism toss)\b/i;
export const PAD_DEFAULT_ON = /^pastoral moment/i;
