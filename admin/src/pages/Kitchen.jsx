import { useCallback, useEffect, useRef, useState } from "react";
import { api, kitchenSocket } from "../api.js";
import { clock, minutesFrom, TYPE_LABEL } from "../format.js";
import { attempt, toast } from "../ui.jsx";

const COLUMNS = [
  { key: "new", title: "New orders", statuses: ["placed"] },
  { key: "up", title: "Accepted · up next", statuses: ["accepted"] },
  { key: "cook", title: "Cooking", statuses: ["preparing"] },
  { key: "ready", title: "Ready", statuses: ["ready"] },
];
const URGENCY_WORD = { waiting: "Pre-order", ok: "On time", amber: "Getting late", red: "Late" };

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.2, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    /* sound blocked until someone taps the screen */
  }
}

export default function Kitchen() {
  const [tickets, setTickets] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const known = useRef(null);

  const load = useCallback(async () => {
    try {
      const q = await api("/kitchen/queue");
      const newIds = q.filter((t) => t.order.status === "placed").map((t) => t.order.id);
      if (known.current && newIds.some((id) => !known.current.has(id))) {
        beep();
        toast("New order in");
      }
      known.current = new Set(newIds);
      setTickets(q);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    api("/restaurant").then(setInfo).catch(() => {});
    const poll = setInterval(load, 15000);
    const clockTick = setInterval(() => setNow(Date.now()), 30000);
    const stop = kitchenSocket((ev) => {
      if (ev.event === "online_orders_paused") setInfo((i) => (i ? { ...i, online_orders_paused: ev.paused } : i));
      if (ev.event === "booking_created") { beep(); toast(ev.status === "pending" ? "New table booking request: answer it on the Bookings page" : "New table booking"); return; }
      load();
    });
    return () => { clearInterval(poll); clearInterval(clockTick); stop(); };
  }, [load]);

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

  return (
    <div className="kitchen">
      <div className="kitchen-bar">
        <h1>Kitchen</h1>
        <span className="muted">{new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</span>
        <div className="spacer" />
        {error && <span className="error">Offline: {error}</span>}
        <button
          className={`btn ${info?.online_orders_paused ? "danger" : "ghost"}`}
          onClick={togglePause}
          aria-pressed={!!info?.online_orders_paused}
        >
          {info?.online_orders_paused ? "Online orders PAUSED · tap to resume" : "Busy? Pause online orders"}
        </button>
      </div>

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
