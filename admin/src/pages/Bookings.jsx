// Table bookings for front of house: the day's list with table numbers, a beep when a new
// booking arrives, Confirm / Seat / No-show / Cancel, and a form for bookings taken by phone.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, kitchenSocket } from "../api.js";
import { clock } from "../format.js";
import { attempt, Field, PageHead, toast } from "../ui.jsx";

const ukDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const STATUS = { pending: "Needs confirming", confirmed: "Confirmed", seated: "Seated", no_show: "No-show", cancelled: "Cancelled" };

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i ? 1047 : 784;
      g.gain.setValueAtTime(0.2, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.25);
    });
  } catch {
    /* sound needs a tap first */
  }
}

export default function Bookings() {
  const [day, setDay] = useState(() => ukDate(new Date()));
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const known = useRef(null);

  const load = useCallback(async () => {
    try {
      const rows = await api("/bookings", { query: { day } });
      const ids = new Set(rows.map((b) => b.id));
      if (known.current && day === ukDate(new Date()) && rows.some((b) => !known.current.has(b.id))) {
        chime();
        toast("New table booking");
      }
      known.current = ids;
      setList(rows);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [day]);

  useEffect(() => {
    known.current = null;
    load();
    const poll = setInterval(load, 20000);
    const stop = kitchenSocket((ev) => { if (ev.event?.startsWith("booking")) load(); });
    return () => { clearInterval(poll); stop(); };
  }, [load]);

  async function setStatus(b, status, okText) {
    const ok = await attempt(() => api(`/bookings/${b.id}/status`, { method: "POST", body: { status } }), okText);
    if (ok) load();
  }

  async function seat(b) {
    const ok = await attempt(() => api(`/bookings/${b.id}/seat`, { method: "POST" }), `${b.name} seated at table ${b.table_number}`);
    if (ok) load();
  }

  const visible = (list || []).filter((b) => showAll || !["cancelled", "no_show"].includes(b.status));
  const guests = visible.filter((b) => b.status !== "cancelled").reduce((n, b) => n + b.guests, 0);
  const pending = (list || []).filter((b) => b.status === "pending").length;

  return (
    <>
      <PageHead title="Table bookings" sub={list ? `${visible.length} booking${visible.length === 1 ? "" : "s"} · ${guests} guests${pending ? ` · ${pending} to confirm` : ""}` : ""}>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value || ukDate(new Date()))} aria-label="Day" />
        <button className="btn ghost" onClick={() => setShowAll((x) => !x)}>{showAll ? "Hide cancelled" : "Show cancelled"}</button>
        <button className="btn primary" onClick={() => setAdding(true)}>Add phone booking</button>
      </PageHead>

      {error && <p className="error">{error}</p>}
      {list && visible.length === 0 && <p className="muted card">No bookings for this day yet.</p>}

      <div className="booking-list">
        {visible.map((b) => (
          <article key={b.id} className={`booking-row st-${b.status}`}>
            <div className="b-time">{clock(b.booking_at)}<span>to {clock(b.ends_at)}</span></div>
            <div className="b-main">
              <b>{b.name}</b> · {b.guests} guest{b.guests === 1 ? "" : "s"} · <b>Table {b.table_number || "?"}</b>
              <div className="muted small">#{b.id} · <a href={`tel:${b.phone.replace(/\s/g, "")}`}>{b.phone}</a>{b.notes ? ` · “${b.notes}”` : ""}</div>
            </div>
            <span className={`badge b-${b.status}`}>{STATUS[b.status] || b.status}</span>
            <div className="b-actions">
              {b.status === "pending" && <button className="btn small primary" onClick={() => setStatus(b, "confirmed", `Booking #${b.id} confirmed, customer texted`)}>Confirm</button>}
              {["pending", "confirmed"].includes(b.status) && <button className="btn small" onClick={() => seat(b)}>Seat</button>}
              {b.status === "confirmed" && <button className="btn small ghost" onClick={() => setStatus(b, "no_show", `#${b.id} marked no-show, table freed`)}>No-show</button>}
              {["pending", "confirmed"].includes(b.status) && <button className="btn small ghost" onClick={() => setStatus(b, "cancelled", `Booking #${b.id} cancelled, customer texted`)}>Cancel</button>}
            </div>
          </article>
        ))}
      </div>

      {adding && <PhoneBooking day={day} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </>
  );
}

function PhoneBooking({ day, onClose, onDone }) {
  const [f, setF] = useState({ name: "", phone: "", guests: 2, notes: "" });
  const [date, setDate] = useState(day);
  const [times, setTimes] = useState(null);
  const [pick, setPick] = useState("");
  const [tableId, setTableId] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    setTimes(null);
    setPick("");
    api("/bookings/availability", { query: { day: date, guests: f.guests } }).then((r) => setTimes(r.filter((t) => new Date(t.start).getTime() > Date.now()))).catch(() => setTimes([]));
  }, [date, f.guests]);

  const row = (times || []).find((t) => t.start === pick);

  async function save(e) {
    e.preventDefault();
    const ok = await attempt(() => api("/bookings", {
      method: "POST",
      body: { name: f.name.trim(), phone: f.phone.trim(), guests: Number(f.guests), booking_at: pick, table_id: tableId ? Number(tableId) : null, notes: f.notes.trim() },
    }), "Booking added");
    if (ok) onDone();
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>Add a phone booking</h2>
        <div className="grid2">
          <Field label="Name"><input required value={f.name} onChange={set("name")} /></Field>
          <Field label="Phone"><input required minLength={10} value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Guests"><input type="number" min="1" max="50" value={f.guests} onChange={set("guests")} /></Field>
          <Field label="Time">
            <select required value={pick} onChange={(e) => { setPick(e.target.value); setTableId(""); }}>
              <option value="">{times === null ? "Loading…" : times.length ? "Choose a time" : "No times left on this day"}</option>
              {(times || []).map((t) => (
                <option key={t.start} value={t.start} disabled={!t.tables_left}>
                  {clock(t.start)} · {t.tables_left ? `${t.tables_left} free` : "full"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Table">
            <select value={tableId} onChange={(e) => setTableId(e.target.value)} disabled={!row}>
              <option value="">Best free table</option>
              {(row?.tables || []).map((t) => <option key={t.id} value={t.id}>Table {t.number} ({t.seats} seats)</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notes"><input value={f.notes} onChange={set("notes")} /></Field>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!pick}>Add booking</button>
        </div>
      </form>
    </div>
  );
}
