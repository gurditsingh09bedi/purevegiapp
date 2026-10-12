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

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

function voice() {
  const vs = window.speechSynthesis?.getVoices() || [];
  return vs.find((v) => v.lang === "en-GB" && /female|libby|sonia|serena|kate|google uk english female/i.test(v.name))
    || vs.find((v) => v.lang === "en-GB") || vs.find((v) => v.lang?.startsWith("en")) || null;
}

export function say(text) {
  const s = window.speechSynthesis;
  if (!s) return;
  const busy = s.speaking || s.pending;
  s.cancel(); // never stack announcements on top of each other
  const u = new SpeechSynthesisUtterance(text);
  const v = voice();
  if (v) u.voice = v;
  u.lang = v?.lang || "en-GB";
  u.rate = 0.95;
  u.volume = 1;
  // Chrome sometimes drops a speak() that comes straight after cancel(), so leave a short gap.
  if (busy) setTimeout(() => s.speak(u), 150);
  else s.speak(u);
}

const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const words = (n) => NUM[n] || String(n);
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// What to say for the orders still waiting to be accepted.
export function announcement(orders, repeat = false) {
  const tables = orders.filter((o) => o.type === "dine_in").map((o) => o.table_number || "unknown");
  const online = orders.filter((o) => o.type !== "dine_in");
  const parts = [];
  const later = (o) => (o.slot_start && new Date(o.slot_start) - Date.now() > 60 * 60000 ? ` ${spokenWhen(o.slot_start)}` : "");
  if (online.length === 1) parts.push(`Pure Vegi received one online order, for ${online[0].type === "delivery" ? "delivery" : "collection"}${later(online[0])}.`);
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

// "today at 7 pm", "tomorrow at 7:30 pm", "on Saturday 10 October at 1 pm" (UK time)
export function spokenWhen(iso, now = new Date()) {
  const tz = "Europe/London";
  const d = new Date(iso);
  const day = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  const time = d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
    .replace(":00", "").replace(/\s?(am|pm)/i, " $1").toLowerCase();
  if (day(d) === day(now)) return `today at ${time}`;
  if (day(d) === day(new Date(now.getTime() + 86400000))) return `tomorrow at ${time}`;
  const date = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz });
  return `on ${date} at ${time}`;
}

// What to say for table booking requests still waiting for an answer.
export function bookingAnnouncement(bookings, repeat = false, now = new Date()) {
  if (!bookings.length) return "";
  if (bookings.length === 1) {
    const b = bookings[0];
    const extra = b.notes ? " It has a special request." : "";
    return `New table booking request: table for ${words(b.guests)}, ${spokenWhen(b.booking_at, now)}.${extra}${repeat ? " Please accept or decline it." : ""}`;
  }
  const n = words(bookings.length);
  return `${n[0].toUpperCase()}${n.slice(1)} table booking requests are waiting.${repeat ? " Please accept or decline them." : ""}`;
}

// Quiet hours: no voice while the restaurant is closed (orders placed overnight for later
// still show on screen, and are announced once the kitchen wakes up, 30 minutes before opening).
let hours = null;
export function setOpeningHours(openingHours) { hours = openingHours || null; }

export function kitchenAwake(at = new Date(), openingHours = hours, marginMin = 30) {
  if (!openingHours) return true; // not loaded yet: never stay silent by mistake
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const mins = (hm) => { const [h, m] = hm.slice(0, 5).split(":").map(Number); return h * 60 + m; };
  const now = mins(`${get("hour")}:${get("minute")}`);
  const h = openingHours[get("weekday").toLowerCase()];
  if (!h || h.closed) return false;
  return now >= mins(h.opens) - marginMin && now < mins(h.closes) + marginMin;
}

// Chime, then speak everything that is waiting (orders and booking requests).
export function announce(orders, repeat = false, bookings = []) {
  if (!unlocked || (!orders.length && !bookings.length)) return;
  if (!kitchenAwake()) return;
  const wait = chime();
  const text = [orders.length ? announcement(orders, repeat) : "", bookingAnnouncement(bookings, repeat)].filter(Boolean).join(" ");
  setTimeout(() => say(text), wait);
}
