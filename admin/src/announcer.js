// Kitchen announcements: a loud "ding-dong" and a spoken message ("Order received from table
// number 7"), repeated until staff accept the order. Uses the browser's built-in voice
// (speechSynthesis), so no sound files and no internet are needed.
// Browsers only allow sound after someone taps the page once, so the kitchen screen shows a
// "Tap to turn on sound" button until that has happened.

let ctx = null;
let unlocked = false;
let wakeLock = null;

export const soundReady = () => unlocked;

export function unlockSound() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    /* no Web Audio: voice only */
  }
  try {
    // A silent utterance inside the tap "unlocks" speech on Chrome and Safari.
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis?.speak(u);
  } catch {
    /* no speech: chime only */
  }
  unlocked = true;
  keepScreenOn();
  return true;
}

// Keep the kitchen tablet's screen from sleeping while the kitchen page is open.
async function keepScreenOn() {
  try {
    if ("wakeLock" in navigator && (!wakeLock || wakeLock.released)) wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    /* not allowed (e.g. battery saver) */
  }
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (unlocked && document.visibilityState === "visible") keepScreenOn(); });
}

export function chime() {
  if (!ctx) return 0;
  const notes = [[988, 0], [784, 0.32], [988, 0.64]]; // ding-dong-ding
  notes.forEach(([f, t]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    const at = ctx.currentTime + t;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.6, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + 0.62);
  });
  return 1300; // ms until the chime has finished
}

function voice() {
  const vs = window.speechSynthesis?.getVoices() || [];
  return vs.find((v) => v.lang === "en-GB" && /female|libby|sonia|serena|kate|google uk english female/i.test(v.name))
    || vs.find((v) => v.lang === "en-GB") || vs.find((v) => v.lang?.startsWith("en")) || null;
}

export function say(text) {
  const s = window.speechSynthesis;
  if (!s) return;
  s.cancel(); // never stack announcements on top of each other
  const u = new SpeechSynthesisUtterance(text);
  const v = voice();
  if (v) u.voice = v;
  u.lang = v?.lang || "en-GB";
  u.rate = 0.95;
  u.volume = 1;
  s.speak(u);
}

const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const words = (n) => NUM[n] || String(n);
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// What to say for the orders still waiting to be accepted.
export function announcement(orders, repeat = false) {
  const tables = orders.filter((o) => o.type === "dine_in").map((o) => o.table_number || "unknown");
  const online = orders.filter((o) => o.type !== "dine_in");
  const parts = [];
  if (online.length === 1) parts.push(`Pure Vegi received one online order, for ${online[0].type === "delivery" ? "delivery" : "collection"}.`);
  else if (online.length > 1) {
    const d = online.filter((o) => o.type === "delivery").length;
    const c = online.length - d;
    const kinds = [d && `${words(d)} for delivery`, c && `${words(c)} for collection`].filter(Boolean);
    parts.push(`Pure Vegi received ${words(online.length)} online orders: ${list(kinds)}.`);
  }
  if (tables.length === 1) parts.push(`Order received from table number ${tables[0]}.`);
  else if (tables.length > 1) parts.push(`Orders received from table numbers ${list([...new Set(tables)])}.`);
  if (repeat) parts.push(orders.length === 1 ? "Please accept the order." : "Please accept the orders.");
  return parts.join(" ");
}

// Chime, then speak.
export function announce(orders, repeat = false) {
  if (!unlocked || !orders.length) return;
  const wait = chime();
  const text = announcement(orders, repeat);
  setTimeout(() => say(text), wait);
}
