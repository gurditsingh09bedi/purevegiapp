// Driver screen, made for a phone: ready deliveries in slot order, one-tap navigation and
// calling, Picked up / Delivered, and live location shared while a delivery is on the way.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, driverSocket } from "../api.js";
import { clock, money } from "../format.js";
import { attempt, toast } from "../ui.jsx";

const SEND_EVERY_MS = 10000;

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.2, 0.4].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 988;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.15);
    });
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* sound needs one tap on the screen first */
  }
}

export default function Driver({ user }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  const [gps, setGps] = useState("off"); // off | on | denied | unsupported
  const known = useRef(null);
  const lastSent = useRef(0);

  const load = useCallback(async () => {
    try {
      const list = await api("/driver/orders");
      const waiting = list.filter((o) => o.status === "ready").map((o) => o.id);
      if (known.current && waiting.some((id) => !known.current.has(id))) {
        beep();
        toast("New delivery ready to pick up");
      }
      known.current = new Set(waiting);
      setOrders(list);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    const stop = driverSocket(() => load());
    return () => { clearInterval(poll); stop(); };
  }, [load]);

  const onTheWay = (orders || []).filter((o) => o.status === "out_for_delivery");
  const ready = (orders || []).filter((o) => o.status === "ready");

  // Share location only while this driver has a delivery on the way.
  useEffect(() => {
    if (!onTheWay.length) { setGps("off"); return undefined; }
    if (!navigator.geolocation) { setGps("unsupported"); return undefined; }
    let wake = null;
    navigator.wakeLock?.request("screen").then((w) => { wake = w; }).catch(() => {});
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGps("on");
        const now = Date.now();
        if (now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        api("/driver/location", { method: "POST", body: { lat: pos.coords.latitude, lng: pos.coords.longitude } }).catch(() => {});
      },
      (err) => setGps(err.code === 1 ? "denied" : "on"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => { navigator.geolocation.clearWatch(id); wake?.release?.(); };
  }, [onTheWay.length]);

  async function act(path, okText) {
    const ok = await attempt(() => api(path, { method: "POST" }), okText);
    if (ok) load();
  }

  return (
    <div className="driver">
      <div className="driver-head">
        <h1>Deliveries</h1>
        <span className={`gps gps-${gps}`}>
          {gps === "on" ? "Sharing location" : gps === "denied" ? "Location blocked: allow it in settings" : gps === "unsupported" ? "No GPS on this device" : "Location off"}
        </span>
      </div>
      {error && <p className="error">Offline: {error}</p>}
      {!orders && <p className="muted">Loading deliveries…</p>}

      {onTheWay.length > 0 && <h2 className="driver-sub">On the way ({onTheWay.length})</h2>}
      {onTheWay.map((o) => (
        <DeliveryCard key={o.id} o={o}>
          <button className="btn primary huge" onClick={() => act(`/driver/orders/${o.id}/delivered`, `#${o.id} delivered`)}>Delivered</button>
        </DeliveryCard>
      ))}

      <h2 className="driver-sub">Ready to pick up ({ready.length})</h2>
      {orders && ready.length === 0 && <p className="muted">Nothing waiting. New deliveries beep when the kitchen marks them ready.</p>}
      {ready.map((o) => (
        <DeliveryCard key={o.id} o={o}>
          <button className="btn primary huge" onClick={() => act(`/driver/orders/${o.id}/picked-up`, `#${o.id} picked up, customer told you're on the way`)}>Picked up</button>
        </DeliveryCard>
      ))}
      <p className="muted small center">Logged in as {user.name}. Keep this screen open while delivering.</p>
    </div>
  );
}

function DeliveryCard({ o, children }) {
  const a = o.address || {};
  const dest = a.lat && a.lng ? `${a.lat},${a.lng}` : encodeURIComponent(`${a.line1 || ""} ${a.postcode || ""}`);
  const items = o.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <article className="delivery-card">
      <header>
        <span className="ticket-no">#{o.id}</span>
        {o.slot_start && <span className="slot-pill">{clock(o.slot_start)}–{clock(o.slot_end)}</span>}
        <span className="muted small">{items} item{items === 1 ? "" : "s"} · {money(o.total_pence)}</span>
      </header>
      <p className="addr">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br /><b>{a.postcode}</b></p>
      {a.notes && <p className="note">Driver note: “{a.notes}”</p>}
      <p className="muted small">{o.customer_name}</p>
      <div className="delivery-actions">
        <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`} target="_blank" rel="noreferrer">Navigate</a>
        {o.customer_phone && <a className="btn" href={`tel:${o.customer_phone.replace(/\s/g, "")}`}>Call customer</a>}
      </div>
      {children}
    </article>
  );
}
