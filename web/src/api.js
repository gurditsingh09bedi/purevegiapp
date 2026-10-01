// Client for the Pure Vegi API, plus small browser-storage helpers.
const env = import.meta.env || {};
export const API_URL = (env.VITE_API_URL || "").replace(/\/$/, "");
export const STRIPE_PK = env.VITE_STRIPE_PK || "";

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private browsing: keep going without saving */
    }
  },
};

export const auth = {
  token: () => store.get("pv_token", null),
  set: (t) => store.set("pv_token", t),
};

// Orders this browser placed, so guests can come back to tracking: {id: viewToken}
export const myOrderTokens = {
  all: () => store.get("pv_order_tokens", {}),
  get: (id) => store.get("pv_order_tokens", {})[id],
  add(id, token) {
    const all = store.get("pv_order_tokens", {});
    all[id] = token;
    store.set("pv_order_tokens", all);
  },
};

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail; // the server's detail (can be an object, e.g. alternative booking times)
  }
}

function errorText(body, status) {
  const d = body && body.detail;
  if (typeof d === "string") return d.charAt(0).toUpperCase() + d.slice(1);
  if (d && typeof d === "object" && d.message) return d.message;
  if (Array.isArray(d)) return d.map((e) => e.msg.replace(/^Value error, /, "")).join("; ");
  return `Something went wrong (${status}). Please try again.`;
}

// Counts requests in flight so the app can show the loading animation.
// Background refreshes pass { quiet: true } and never trigger it.
let pending = 0;
const busyListeners = new Set();
export const busy = {
  count: () => pending,
  subscribe(fn) { busyListeners.add(fn); return () => busyListeners.delete(fn); },
};
const bump = (n) => { pending += n; busyListeners.forEach((fn) => fn(pending)); };

export async function api(path, opts = {}) {
  if (opts.quiet) return request(path, opts);
  bump(1);
  try {
    return await request(path, opts);
  } finally {
    bump(-1);
  }
}

async function request(path, { method = "GET", body, query, headers: extra } = {}) {
  const url = new URL(API_URL + path, window.location.origin);
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
  const headers = { Accept: "application/json", ...extra };
  const token = auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't reach Pure Vegi right now. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) auth.set(null);
    throw new ApiError(res.status, errorText(data, res.status), data && data.detail);
  }
  return data;
}

// Table bookings this browser made: {id: viewToken}, so guests can follow their request.
export const myBookingTokens = {
  get: (id) => store.get("pv_booking_tokens", {})[id],
  add(id, token) {
    const all = store.get("pv_booking_tokens", {});
    all[id] = token;
    store.set("pv_booking_tokens", all);
  },
};

export function bookingHeaders(id) {
  const t = myBookingTokens.get(id);
  return t ? { "X-Booking-Token": t } : {};
}

export function orderHeaders(id) {
  const t = myOrderTokens.get(id);
  return t ? { "X-Order-Token": t } : {};
}

// Live order updates. Returns a stop function. Tracking also polls, so this is a bonus.
export function orderSocket(id, onEvent) {
  const base = (API_URL || window.location.origin).replace(/^http/, "ws");
  let ws;
  let closed = false;
  let retry;
  const open = () => {
    try {
      ws = new WebSocket(`${base}/ws/orders/${id}`);
    } catch {
      return;
    }
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 8000);
    };
    ws.onerror = () => ws.close();
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    if (ws) ws.close();
  };
}

// UK postcode → coordinates (free, no key): https://postcodes.io
export async function lookupPostcode(postcode) {
  const pc = postcode.trim().replace(/\s+/g, "");
  if (!pc) throw new ApiError(400, "Please enter your postcode");
  let res;
  try {
    res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
  } catch {
    throw new ApiError(0, "Couldn't check that postcode. Try again in a moment.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status !== 200) throw new ApiError(400, "We couldn't find that postcode");
  return { postcode: data.result.postcode, lat: data.result.latitude, lng: data.result.longitude };
}
