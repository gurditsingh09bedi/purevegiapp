import { useCallback, useEffect, useRef, useState } from "react";
import { api, kitchenSocket } from "../api.js";
import { clock, dayAndTime, minutesFrom, TYPE_LABEL } from "../format.js";
import { announce, chime, kitchenAwake, say, setOpeningHours, soundReady, unlockSound } from "../announcer.js";
import { attempt, toast } from "../ui.jsx";

const REPEAT_MS = 15000; // keep announcing every 15 seconds until the order is accepted
const SOUND_PREF = "pv_kitchen_sound";

const COLUMNS = [
  { key: "new", title: "New orders", statuses: ["placed"] },
  { key: "up", title: "Accepted · up next", statuses: ["accepted"] },
  { key: "cook", title: "Cooking", statuses: ["preparing"] },
  { key: "ready", title: "Ready", statuses: ["ready"] },
];
const URGENCY_WORD = { waiting: "Pre-order", ok: "On time", amber: "Getting late", red: "Late" };

export default function Kitchen() {
  const [tickets, setTickets] = useState(null);
  const [info, setInfo] = useState(null);
  const [meter, setMeter] = useState(null); // busy meter, as customers see it
  useEffect(() => {
    const get = () => api("/restaurant/busy").then(setMeter).catch(() => {});
    get();
    const t = setInterval(get, 20000);
    return () => clearInterval(t);
  }, []);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const known = useRef(null);
  const seen = useRef(null); // every order id on the board, to spot auto-accepted ones
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem(SOUND_PREF) !== "off"; } catch { return true; } });
  const [ready, setReady] = useState(soundReady());
  const pendingRef = useRef([]);
  const [requests, setRequests] = useState([]); // table booking requests waiting for an answer
  const requestsRef = useRef([]);
  const knownReq = useRef(null);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  const load = useCallback(async () => {
    try {
      const q = await api("/kitchen/queue");
      const waiting = q.filter((t) => t.order.status === "placed").map((t) => t.order);
      const newIds = waiting.map((o) => o.id);
      pendingRef.current = waiting;
      if (known.current && newIds.some((id) => !known.current.has(id))) {
        const fresh = waiting.filter((o) => !known.current.has(o.id));
        if (soundRef.current) announce(fresh);
        toast(fresh.some((o) => o.type === "dine_in") ? `New order from table ${fresh.find((o) => o.type === "dine_in").table_number}` : "New online order");
      }
      known.current = new Set(newIds);
      // Auto-accept on: orders skip "New", so announce them once when they first appear.
      const ids = new Set(q.map((t) => t.order.id));
      if (seen.current) {
        const auto = q.map((t) => t.order).filter((o) => o.status === "accepted" && !seen.current.has(o.id));
        if (auto.length && soundRef.current) announce(auto);
      }
      seen.current = ids;
      setTickets(q);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const rows = await api("/bookings", { query: { status: "pending" }, quiet: true });
      requestsRef.current = rows;
      if (knownReq.current) {
        const fresh = rows.filter((b) => !knownReq.current.has(b.id));
        if (fresh.length) {
          if (soundRef.current) announce([], false, fresh);
          toast(`New table booking request: ${fresh[0].name}, ${fresh[0].guests} guests`);
        }
      }
      knownReq.current = new Set(rows.map((b) => b.id));
      setRequests(rows);
    } catch {
      /* this account can't see bookings: the panel simply stays empty */
    }
  }, []);

  useEffect(() => {
    load();
    loadRequests();
    api("/restaurant").then((r) => { setOpeningHours(r.opening_hours); setInfo(r); }).catch(() => {});
    const poll = setInterval(() => { load(); loadRequests(); }, 15000);
    const clockTick = setInterval(() => setNow(Date.now()), 30000);
    const stop = kitchenSocket((ev) => {
      if (ev.event === "online_orders_paused") setInfo((i) => (i ? { ...i, online_orders_paused: ev.paused } : i));
      if (ev.event?.startsWith("booking")) { loadRequests(); return; } // requests are announced by loadRequests
      load();
    });
    return () => { clearInterval(poll); clearInterval(clockTick); stop(); };
  }, [load, loadRequests]);

  // Keep announcing until every new order has been accepted (or rejected).
  useEffect(() => {
    const t = setInterval(() => {
      if (soundRef.current && (pendingRef.current.length || requestsRef.current.length)) announce(pendingRef.current, true, requestsRef.current);
    }, REPEAT_MS);
    return () => clearInterval(t);
  }, []);

  // Any tap on the page unlocks sound (browsers need one tap before they allow audio).
  useEffect(() => {
    if (ready) return undefined;
    const on = () => {
      unlockSound();
      setReady(true);
      if (soundRef.current) announce(pendingRef.current, false, requestsRef.current); // what's already waiting
    };
    window.addEventListener("pointerdown", on, { once: true });
    return () => window.removeEventListener("pointerdown", on);
  }, [ready]);

  function enableSound() {
    unlockSound();
    setReady(true);
    setSoundOn(true);
    try { localStorage.setItem(SOUND_PREF, "on"); } catch { /* ignore */ }
    if (!kitchenAwake()) { const w = chime(); setTimeout(() => say("Sound is on. We're closed now, so orders will be announced from half an hour before opening."), w); }
    else if (pendingRef.current.length || requestsRef.current.length) announce(pendingRef.current, false, requestsRef.current);
    else { const w = chime(); setTimeout(() => say("Sound is on. New orders will be announced."), w); } // a quick test so staff hear it works
    toast("Sound is on: new orders will be announced");
  }

  function toggleSound() {
    const next = !soundOn;
    if (next) { enableSound(); return; }
    setSoundOn(false);
    window.speechSynthesis?.cancel();
    try { localStorage.setItem(SOUND_PREF, "off"); } catch { /* ignore */ }
  }

  async function acceptBooking(b) {
    const ok = await attempt(() => api(`/bookings/${b.id}/status`, { method: "POST", body: { status: "confirmed" } }),
      `Booking #${b.id} accepted, customer texted`);
    if (ok) loadRequests();
  }

  async function act(path, body, okText) {
    const ok = await attempt(() => api(path, { method: "POST", body }), okText);
    if (ok) load();
  }

  async function togglePause() {
    const paused = !info?.online_orders_paused;
    const r = await attempt(() => api("/kitchen/pause", { method: "POST", query: { paused } }),
      paused ? "Online orders paused" : "Online orders back on");
    if (r) setInfo((i) => ({ ...i, online_orders_paused: paused }));
  }

  const choices = info?.prep_minute_choices || [10, 15, 20, 30];
  const waitingOrders = (tickets || []).filter((t) => t.order.status === "placed").map((t) => t.order);

  return (
    <div className="kitchen">
      <div className="kitchen-bar">
        <h1>Kitchen</h1>
        <span className="muted">{new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</span>
        <div className="spacer" />
        {error && <span className="error">Offline: {error}</span>}
        {meter && kitchenAwake(new Date(now)) && <span className={`busy-chip lvl-${meter.level}`} title="What customers see on the website">{{ quiet: "🟢 Quiet", busy: "🟠 Busy", very_busy: "🔴 Very busy" }[meter.level]} · {meter.orders} on · ~{meter.wait_minutes} min</span>}
        {info && !kitchenAwake(new Date(now)) && <span className="quiet-badge" title="Orders placed now are for later. Voice announcements start 30 minutes before opening.">🌙 Closed · quiet hours</span>}
        <button className={`btn ${soundOn && ready ? "ghost" : "danger"}`} onClick={toggleSound} aria-pressed={soundOn}>
          {soundOn && ready ? "🔊 Sound on" : soundOn ? "🔇 Tap to turn on sound" : "🔇 Sound off"}
        </button>
        <button
          className={`btn ${info?.online_orders_paused ? "danger" : "ghost"}`}
          onClick={togglePause}
          aria-pressed={!!info?.online_orders_paused}
        >
          {info?.online_orders_paused ? "Online orders PAUSED · tap to resume" : "Busy? Pause online orders"}
        </button>
      </div>

      {soundOn && !ready && (
        <button className="sound-gate" onPointerDown={(e) => { e.stopPropagation(); enableSound(); }}>
          <b>🔔 Tap here to turn on order sounds</b>
          <span>The screen will call out every new order (“Order received from table number 7”) until it is accepted.</span>
        </button>
      )}
      {(waitingOrders.length > 0 || requests.length > 0) && (
        <div className="order-alarm" role="alert">
          <b>🔔 {[waitingOrders.length && `${waitingOrders.length} order${waitingOrders.length > 1 ? "s" : ""}`,
            requests.length && `${requests.length} table booking${requests.length > 1 ? "s" : ""}`].filter(Boolean).join(" + ")} waiting to be accepted</b>
          <span>{waitingOrders.map((o) => (o.type === "dine_in" ? `Table ${o.table_number}` : `#${o.id} ${TYPE_LABEL[o.type]}`)).join(" · ")}</span>
        </div>
      )}

      {requests.length > 0 && (
        <section className="booking-requests" aria-label="Table booking requests">
          <h2>📅 Table booking requests</h2>
          {requests.map((b) => (
            <article key={b.id} className="booking-req">
              <div>
                <b>{b.name}</b> · {b.guests} guest{b.guests === 1 ? "" : "s"} · {dayAndTime(b.booking_at)} · Table {b.table_number || "?"}
                {b.notes && <div className="b-request"><b>Special request:</b> “{b.notes}”</div>}
              </div>
              <div className="b-actions">
                <button className="btn primary" onClick={() => acceptBooking(b)}>Accept</button>
                <a className="btn ghost" href="#/bookings">Decline / reply</a>
              </div>
            </article>
          ))}
        </section>
      )}

      {!tickets ? (
        <p className="muted">Loading orders…</p>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => {
            const list = tickets.filter((t) => col.statuses.includes(t.order.status));
            return (
              <section key={col.key} className={`col col-${col.key}`}>
                <h2>{col.title} <span className="count">{list.length}</span></h2>
                {list.length === 0 && <p className="muted empty">Nothing here</p>}
                {list.map((t) => (
                  <Ticket key={t.order.id} t={t} now={now} choices={choices} act={act} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Ticket({ t, now, choices, act }) {
  const o = t.order;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const id = o.id;
  const where =
    o.type === "delivery" ? `Slot ${clock(o.slot_start)}–${clock(o.slot_end)}`
    : o.type === "dine_in" ? `Table ${o.table_number || "?"}`
    : o.customer_name || "Collection";
  const waited = minutesFrom(o.created_at, now);

  return (
    <article className={`ticket u-${t.urgency}`}>
      <header>
        <span className="ticket-no">#{id}</span>
        <span className={`badge t-${o.type}`}>{TYPE_LABEL[o.type]}</span>
        <span className={`urgency u-${t.urgency}`}>{URGENCY_WORD[t.urgency]}</span>
      </header>
      <p className="where">{where}</p>
      <p className="times muted">
        {t.pre_order ? `Start cooking ${clock(t.cook_at)} · ` : ""}Ready by {clock(t.ready_at)} · ordered {waited} min ago
      </p>
      <ul className="items">
        {o.items.map((it, i) => (
          <li key={i}>
            <b>{it.quantity}×</b> {it.name}
            {it.options.length > 0 && <span className="opts"> — {it.options.map((x) => x.name).join(", ")}</span>}
            {it.notes && <div className="note">“{it.notes}”</div>}
            {it.allergens.length > 0 && <div className="allergen">Allergens: {it.allergens.join(", ")}</div>}
          </li>
        ))}
      </ul>
      {o.notes && <p className="note">Order note: “{o.notes}”</p>}

      <div className="actions">
        {o.status === "placed" && !rejecting && (
          <>
            <span className="muted small-label">Accept · ready in</span>
            {choices.map((m) => (
              <button key={m} className="btn primary" onClick={() => act(`/kitchen/orders/${id}/accept`, { prep_minutes: m }, `#${id} accepted`)}>
                {m} min
              </button>
            ))}
            <button className="btn ghost" onClick={() => setRejecting(true)}>Reject</button>
          </>
        )}
        {rejecting && (
          <form className="reject" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) act(`/kitchen/orders/${id}/reject`, { reason }, `#${id} rejected, customer refunded`); }}>
            <input autoFocus placeholder="Reason, e.g. item sold out" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn danger" disabled={!reason.trim()}>Reject order</button>
            <button type="button" className="btn ghost" onClick={() => setRejecting(false)}>Back</button>
          </form>
        )}
        {o.status === "accepted" && (
          <button className="btn primary" onClick={() => act(`/kitchen/orders/${id}/start`, undefined, `#${id}: customer told cooking started`)}>Start cooking</button>
        )}
        {o.status === "preparing" && (
          <button className="btn primary" onClick={() => act(`/kitchen/orders/${id}/ready`, undefined, `#${id} ready`)}>Mark ready</button>
        )}
        {["accepted", "preparing"].includes(o.status) && (
          <>
            <button className="btn ghost" onClick={() => act(`/kitchen/orders/${id}/delay`, { minutes: 5 }, `#${id}: +5 min, customer told`)}>+5 min</button>
            <button className="btn ghost" onClick={() => act(`/kitchen/orders/${id}/delay`, { minutes: 10 }, `#${id}: +10 min, customer told`)}>+10 min</button>
          </>
        )}
        {o.status === "ready" && o.type !== "delivery" && (
          <button className="btn primary" onClick={() => act(`/kitchen/orders/${id}/handed-over`, undefined, `#${id} done`)}>
            {o.type === "dine_in" ? "Served" : "Collected"}
          </button>
        )}
        {o.status === "ready" && o.type === "delivery" && <span className="muted">Waiting for driver</span>}
      </div>
    </article>
  );
}
