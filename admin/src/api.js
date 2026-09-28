// Thin client for the Pure Vegi API.
const env = import.meta.env || {};
// Empty = same address as this app (development proxy, or API served behind the same domain).
export const API_URL = (env.VITE_API_URL || "").replace(/\/$/, "");
export const SITE_URL = (env.VITE_SITE_URL || "https://purevegi.co.uk").replace(/\/$/, "");

const TOKEN_KEY = "pv_staff_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: stay logged in for this tab only */
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function errorText(body, status) {
  const d = body && body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => `${(e.loc || []).slice(-1)[0] || "value"}: ${e.msg}`).join("; ");
  return `Request failed (${status})`;
}

export async function api(path, { method = "GET", body, query } = {}) {
  const url = new URL(API_URL + path, window.location.origin);
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
  const headers = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check the internet connection.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, errorText(data, res.status));
  }
  return data;
}

export function kitchenSocket(onEvent) {
  // Live updates; the screen also polls, so a dropped socket only delays updates.
  const wsUrl = (API_URL || window.location.origin).replace(/^http/, "ws") + `/ws/kitchen?token=${encodeURIComponent(getToken() || "")}`;
  let ws;
  let closed = false;
  let retry;
  const open = () => {
    ws = new WebSocket(wsUrl);
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(open, 5000);
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
