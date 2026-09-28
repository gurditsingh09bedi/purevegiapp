// App-wide state: route, cart, restaurant info, logged-in customer.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, auth, store } from "./api.js";

// --- Routing (plain paths, so table QR links like /t/<token> work) --------------------
export function navigate(to) {
  if (to !== window.location.pathname + window.location.search) window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("pv:navigate"));
  window.scrollTo({ top: 0 });
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    window.addEventListener("pv:navigate", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("pv:navigate", on);
    };
  }, []);
  return path;
}

export function Link({ to, className, children, ...rest }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

// --- Inside the Pure Vegi phone app -----------------------------------------------
// The app (app/ folder) opens this website and sets window.PV_NATIVE = { pushToken, platform }
// before the page loads, then fires "pv:native" if the token arrives later.
export const native = () => (typeof window !== "undefined" && window.PV_NATIVE) || null;

// --- Cart --------------------------------------------------------------------------
// A line = one dish with one set of options. key keeps identical choices together.
const lineKey = (itemId, optionIds, notes) => `${itemId}|${[...optionIds].sort().join(",")}|${notes || ""}`;

const Ctx = createContext(null);

export function AppProvider({ children }) {
  const [cart, setCart] = useState(() => store.get("pv_cart", []));
  const [cartOpen, setCartOpen] = useState(false);
  const [restaurant, setRestaurant] = useState(null);
  const [user, setUser] = useState(null);
  const [table, setTable] = useState(() => store.get("pv_table", null)); // {token, number} in table mode

  useEffect(() => store.set("pv_cart", cart), [cart]);
  useEffect(() => store.set("pv_table", table), [table]);

  // In the app, register this phone for push notifications once the customer is logged in.
  useEffect(() => {
    if (!user) return undefined;
    const register = () => {
      const n = native();
      if (n?.pushToken) api("/auth/devices", { method: "POST", body: { push_token: n.pushToken, platform: n.platform || "android" }, quiet: true }).catch(() => {});
    };
    register();
    window.addEventListener("pv:native", register);
    return () => window.removeEventListener("pv:native", register);
  }, [user]);

  useEffect(() => {
    api("/restaurant").then(setRestaurant).catch(() => {});
    if (auth.token()) api("/auth/me").then(setUser).catch(() => auth.set(null));
  }, []);

  const add = useCallback((item, options, quantity, notes) => {
    const optionIds = options.map((o) => o.id);
    const key = lineKey(item.id, optionIds, notes);
    const unit = item.price_pence + options.reduce((s, o) => s + o.price_pence, 0);
    setCart((c) => {
      const found = c.find((l) => l.key === key);
      if (found) return c.map((l) => (l.key === key ? { ...l, quantity: Math.min(l.quantity + quantity, 50) } : l));
      return [...c, { key, itemId: item.id, name: item.name, optionIds, optionNames: options.map((o) => o.name), unit, quantity, notes }];
    });
  }, []);

  const setQty = useCallback((key, quantity) => {
    setCart((c) => (quantity <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity } : l))));
  }, []);

  const value = useMemo(() => {
    const count = cart.reduce((s, l) => s + l.quantity, 0);
    const subtotal = cart.reduce((s, l) => s + l.unit * l.quantity, 0);
    return {
      cart, count, subtotal, add, setQty, clear: () => setCart([]),
      cartOpen, setCartOpen,
      restaurant, user, setUser,
      table, setTable,
      logout: () => { auth.set(null); setUser(null); },
    };
  }, [cart, add, setQty, cartOpen, restaurant, user, table]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);

// --- Small helpers -----------------------------------------------------------------
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// Is the restaurant open right now (UK time)?
export function openNow(restaurant, at = new Date()) {
  if (!restaurant) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = get("weekday").toLowerCase();
  const hm = `${get("hour")}:${get("minute")}`;
  const h = restaurant.opening_hours?.[day];
  if (!h || h.closed) return false;
  return h.opens.slice(0, 5) <= hm && hm < h.closes.slice(0, 5);
}
