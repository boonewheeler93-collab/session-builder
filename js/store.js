// Data store: Firebase Realtime Database (shared sync password, like start-times)
// with a local fallback that keeps everything in this browser. Both expose the
// same small API over the sessionBuilder/ subtree.
import { FIREBASE_CONFIG, FB_VERSION, SYNC_LOGIN, ROOT } from "./config.js";

const LS_KEY = "sb.local.v1";
const listeners = new Set();
let mode = "local"; // "local" | "firebase"
let tree = {};
let db = null;
let authUser = null;

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const split = (path) => String(path).split("/").filter(Boolean);

function getAt(obj, path) {
  let o = obj;
  for (const k of split(path)) { if (o == null) return undefined; o = o[k]; }
  return o;
}
function setAt(obj, path, val) {
  const ks = split(path);
  let o = obj;
  ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== "object") o[k] = {}; o = o[k]; });
  const last = ks[ks.length - 1];
  if (val === null || val === undefined) delete o[last]; else o[last] = clone(val);
}
const emit = () => listeners.forEach((fn) => fn(tree));
const saveLocal = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(tree)); } catch (e) { /* storage full or blocked */ } };

export const store = {
  get mode() { return mode; },
  get user() { return authUser; },
  get data() { return tree; },
  get(path) { return getAt(tree, path); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async set(path, val) {
    if (mode === "firebase") return db.ref(`${ROOT}/${path}`).set(val ?? null);
    setAt(tree, path, val); saveLocal(); emit();
  },
  async update(path, obj) {
    if (mode === "firebase") return db.ref(`${ROOT}/${path}`).update(obj);
    for (const [k, v] of Object.entries(obj)) setAt(tree, `${path}/${k}`, v);
    saveLocal(); emit();
  },
  async push(path, val) {
    const id = mode === "firebase" ? db.ref(`${ROOT}/${path}`).push().key : "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await this.set(`${path}/${id}`, val);
    return id;
  },
  serverTime() { return Date.now(); },

  /** Start in local mode, seeded with demo data on first run. */
  initLocal(seed) {
    mode = "local";
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { saved = null; }
    tree = saved && saved.seedVersion === seed.seedVersion ? saved : clone(seed);
    saveLocal(); emit();
  },
  resetLocal(seed) { tree = clone(seed); saveLocal(); emit(); },

  /** Load the Firebase SDK and, if already signed in, switch to Firebase mode. */
  async initFirebase(onAuthChange) {
    await loadScripts([
      `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app-compat.js`,
      `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth-compat.js`,
      `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-database-compat.js`,
    ]);
    const fb = window.firebase;
    if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);
    db = fb.database();
    // Signed in but refused (e.g. the database rule isn't there yet): keep retrying every 30 s so the
    // page connects on its own once access is granted, without a reload.
    let retryT = null;
    const tryConnect = () => {
      clearTimeout(retryT);
      if (!authUser) return;
      connect().then(() => onAuthChange?.(true), (e) => {
        onAuthChange?.(false, e);
        if (/permission/i.test(e?.message || "")) retryT = setTimeout(tryConnect, 30000);
      });
    };
    fb.auth().onAuthStateChanged((u) => {
      authUser = u;
      if (u) tryConnect();
      else { clearTimeout(retryT); onAuthChange?.(false); }
    });
  },
  async signIn(password) {
    return window.firebase.auth().signInWithEmailAndPassword(SYNC_LOGIN, String(password).trim());
  },
  async signOut() { await window.firebase.auth().signOut(); mode = "local"; },

  /** Library index is big; read it once rather than keeping a live listener. */
  async loadLibrary() {
    if (mode === "firebase") {
      const snap = await db.ref(`${ROOT}/library`).once("value");
      if (snap.exists()) return snap.val();
    }
    try {
      const res = await fetch("data/library.json", { cache: "no-cache" });
      if (res.ok) return await res.json();
    } catch (e) { /* no local index */ }
    return null;
  },
};

// Live listeners on each child we use (not the library).
const LIVE = ["weekends", "songMeta", "machines", "jobs", "settings", "sends", "sync"];
async function connect() {
  // Probe access first so a missing rule shows a clear message instead of silent nothing.
  await db.ref(`${ROOT}/settings`).once("value");
  mode = "firebase";
  tree = {};
  for (const k of LIVE) {
    db.ref(`${ROOT}/${k}`).on("value", (snap) => { tree[k] = snap.val() || {}; emit(); });
  }
  const presence = db.ref(".info/connected");
  presence.on("value", (s) => { tree._online = !!s.val(); emit(); });
}

function loadScripts(urls) {
  return urls.reduce((p, src) => p.then(() => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src));
    document.head.appendChild(s);
  })), Promise.resolve());
}
