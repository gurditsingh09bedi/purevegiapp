// Table bookings for front of house. Online bookings arrive as requests (table already held):
// staff Accept or Decline them, with an optional message that is texted to the customer
// (e.g. "Yes, we'll have a cake ready"). Also Message, Seat, No-show, Cancel, and phone bookings.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, kitchenSocket } from "../api.js";
import { clock, dayAndTime, whatsappLink } from "../format.js";
import { attempt, Field, PageHead, toast } from "../ui.jsx";

const ukDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const STATUS = { pending: "New request", confirmed: "Confirmed", declined: "Declined", seated: "Seated", no_show: "No-show", cancelled: "Cancelled" };
const QUICK = {
  confirmed: ["Yes, we can arrange that for you.", "We'll have it ready when you arrive.", "There's a small extra charge for this, paid on the day."],
  declined: ["Sorry, we're fully booked at that time.", "For a group this size please call us so we can plan it.", "We're closed for a private event that evening."],
  message: ["Yes, we can arrange that for you.", "Could you call us to talk about your request?", "Running 10 minutes behind, your table will be ready shortly."],
  cancelled: ["Sorry, we've had to close early today."],
};
// The text a customer gets, also used to pre-fill WhatsApp.
function customerText(b, action, note) {
  const when = dayAndTime(b.booking_at);
  const extra = note ? ` ${note}` : "";
  if (action === "confirmed") return `Hi ${b.name}, your Pure Vegi booking #${b.id} is confirmed: Table ${b.table_number} for ${b.guests}, ${when}.${extra} See you soon!`;
  if (action === "declined") return `Hi ${b.name}, sorry, we can't take your Pure Vegi booking for ${when}.${extra} Please pick another time or call 0121 554 7949.`;
  if (action === "cancelled") return `Hi ${b.name}, your Pure Vegi booking for ${when} is cancelled.${extra} Questions? Call 0121 554 7949.`;
  return `Hi ${b.name}, Pure Vegi here about your booking #${b.id} (${when}).${extra}`;
}

const ACTION = {
  confirmed: { title: "Accept booking", button: "Accept & text customer", path: "status", label: "Message to the customer (optional)" },
  declined: { title: "Decline booking", button: "Decline & text customer", path: "status", label: "Reason (optional, sent to the customer)" },
  cancelled: { title: "Cancel booking", button: "Cancel & text customer", path: "status", label: "Reason (optional, sent to the customer)" },
  message: { title: "Message customer", button: "Send text", path: "message", label: "Message" },
};

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
  const [reply, setReply] = useState(null); // {b, action}
  const known = useRef(null);

  const load = useCallback(async () => {
    try {
      const rows = await api("/bookings", { query: { day } });
      const ids = new Set(rows.map((b) => b.id));
      if (known.current && day === ukDate(new Date()) && rows.some((b) => !known.current.has(b.id))) {
        chime();
        toast("New table booking request");
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

  async function sendReply(message, viaWhatsApp) {
    if (viaWhatsApp) window.open(whatsappLink(reply.b.phone, customerText(reply.b, reply.action, message)), "_blank", "noopener");
    const { b, action } = reply;
    const a = ACTION[action];
    const body = a.path === "status" ? { status: action, message } : { message };
    const done = { confirmed: `#${b.id} accepted, customer texted`, declined: `#${b.id} declined, customer texted`,
      cancelled: `#${b.id} cancelled, customer texted`, message: `Message sent to ${b.name}` }[action];
    const ok = await attempt(() => api(`/bookings/${b.id}/${a.path}`, { method: "POST", body }), done);
    if (ok) { setReply(null); load(); }
  }

  async function seat(b) {
    const ok = await attempt(() => api(`/bookings/${b.id}/seat`, { method: "POST" }), `${b.name} seated at table ${b.table_number}`);
    if (ok) load();
  }

  const visible = (list || []).filter((b) => showAll || !["cancelled", "no_show", "declined"].includes(b.status));
  const guests = visible.filter((b) => ["pending", "confirmed", "seated"].includes(b.status)).reduce((n, b) => n + b.guests, 0);
  const pending = (list || []).filter((b) => b.status === "pending").length;

  return (
    <>
      <PageHead title="Table bookings" sub={list ? `${visible.length} booking${visible.length === 1 ? "" : "s"} · ${guests} guests${pending ? ` · ${pending} waiting for an answer` : ""}` : ""}>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value || ukDate(new Date()))} aria-label="Day" />
        <button className="btn ghost" onClick={() => setShowAll((x) => !x)}>{showAll ? "Hide cancelled & declined" : "Show cancelled & declined"}</button>
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
              <div className="muted small">#{b.id} · <a href={`tel:${b.phone.replace(/\s/g, "")}`}>{b.phone}</a>{b.email ? ` · ${b.email}` : ""}</div>
              {b.notes && <div className="b-request"><b>Special request:</b> “{b.notes}”</div>}
              {b.staff_message && <div className="b-reply"><b>You replied:</b> “{b.staff_message}”</div>}
            </div>
            <span className={`badge b-${b.status}`}>{STATUS[b.status] || b.status}</span>
            <div className="b-actions">
              {b.status === "pending" && (
                <>
                  <button className="btn small primary" onClick={() => setReply({ b, action: "confirmed" })}>Accept</button>
                  <button className="btn small danger" onClick={() => setReply({ b, action: "declined" })}>Decline</button>
                </>
              )}
              {b.status === "confirmed" && <button className="btn small primary" onClick={() => seat(b)}>Seat</button>}
              {["pending", "confirmed", "seated"].includes(b.status) && <button className="btn small" onClick={() => setReply({ b, action: "message" })}>Message</button>}
              <a className="btn small whatsapp" href={whatsappLink(b.phone, customerText(b, "message", ""))} target="_blank" rel="noopener noreferrer" title="Chat on WhatsApp">WhatsApp</a>
              {b.status === "confirmed" && <button className="btn small ghost" onClick={() => setStatus(b, "no_show", `#${b.id} marked no-show, table freed`)}>No-show</button>}
              {b.status === "confirmed" && <button className="btn small ghost" onClick={() => setReply({ b, action: "cancelled" })}>Cancel</button>}
            </div>
          </article>
        ))}
      </div>

      {reply && <ReplyModal reply={reply} onClose={() => setReply(null)} onSend={sendReply} />}
      {adding && <PhoneBooking day={day} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </>
  );
}

function ReplyModal({ reply, onClose, onSend }) {
  const { b, action } = reply;
  const a = ACTION[action];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const need = action === "message";
  const add = (q) => setText((t) => (t.trim() ? `${t.trim()} ${q}` : q));

  async function submit(e) {
    e.preventDefault();
    const viaWhatsApp = e.nativeEvent.submitter?.dataset.wa === "1";
    setBusy(true);
    await onSend(text.trim(), viaWhatsApp); // opens WhatsApp first (must happen on the click), then texts/emails
    setBusy(false);
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{a.title} #{b.id}</h2>
        <p className="muted">{b.name} · {b.guests} guests · {clock(b.booking_at)} · Table {b.table_number || "?"} · {b.phone}</p>
        {b.notes && <div className="b-request"><b>Their request:</b> “{b.notes}”</div>}
        <Field label={a.label}>
          <textarea rows={4} maxLength={500} required={need} autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder={action === "confirmed" && b.notes ? "e.g. Yes, we'll have a cake ready. £15, paid on the day." : ""} />
        </Field>
        <div className="quick-replies">
          {(QUICK[action] || []).map((q) => <button type="button" key={q} className="chip" onClick={() => add(q)}>{q}</button>)}
        </div>
        <p className="muted small">Sent by text{b.email ? ", email" : ""} and notification, and shown on their booking page. “+ WhatsApp” also opens WhatsApp with it ready to send.</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Back</button>
          <button type="submit" data-wa="1" className="btn whatsapp" disabled={busy || (need && !text.trim())}>+ WhatsApp</button>
          <button type="submit" className={`btn ${action === "declined" || action === "cancelled" ? "danger" : "primary"}`} disabled={busy || (need && !text.trim())}>
            {busy ? "Sending…" : a.button}
          </button>
        </div>
      </form>
    </div>
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
