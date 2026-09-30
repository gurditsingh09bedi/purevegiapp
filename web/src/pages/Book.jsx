// Table booking. Every time shows how many suitable tables are left; a time with none is
// "Full". Picking a time shows the best free tables; if someone takes the last one first,
// the server refuses and we offer the three nearest free times instead. No double bookings.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { dayAndTime, money } from "../format.js";
import { Link, useApp, useLoad } from "../state.jsx";

const ukDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d); // YYYY-MM-DD
const clock12 = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).replace(" ", "").toLowerCase();

export default function Book() {
  const { restaurant, user } = useApp();
  const today = ukDate(new Date());
  const [day, setDay] = useState(today);
  const [guests, setGuests] = useState(2);
  const [time, setTime] = useState(null); // an availability row
  const [tableId, setTableId] = useState(null);
  const [f, setF] = useState({ name: user?.name || "", phone: user?.phone || "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alternatives, setAlternatives] = useState([]);
  const [done, setDone] = useState(null);

  useEffect(() => { if (user) setF((x) => ({ ...x, name: x.name || user.name, phone: x.phone || user.phone || "" })); }, [user]);

  const avail = useLoad(() => api("/bookings/availability", { query: { day, guests } }), [day, guests]);
  useEffect(() => { setTime(null); setTableId(null); setAlternatives([]); setError(""); }, [day, guests]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const deposit = restaurant ? (restaurant.booking_deposit_per_guest ? restaurant.booking_deposit_pence * guests : restaurant.booking_deposit_pence) : 0;
  // The server already leaves out past times; this also hides any that went past while the page was open.
  const rows = avail.data ? avail.data.filter((a) => new Date(a.start).getTime() > Date.now()) : null;
  const nothingToday = rows && rows.length > 0 && rows.every((a) => a.tables_left === 0);
  const tomorrow = ukDate(new Date(Date.now() + 86400000));

  function pick(a) {
    setTime(a);
    setTableId(null);
    setAlternatives([]);
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setAlternatives([]);
    try {
      const b = await api("/bookings", {
        method: "POST",
        body: { name: f.name.trim(), phone: f.phone.trim(), guests: Number(guests), booking_at: time.start, table_id: tableId, notes: f.notes.trim() },
      });
      setDone(b);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err.message);
      if (err.status === 409 && err.detail?.alternatives) {
        setAlternatives(err.detail.alternatives);
        setTime(null);
        avail.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const confirmed = done.status === "confirmed";
    return (
      <div className="page narrow">
        <div className={`booked-card ${confirmed ? "ok" : "wait"}`} role="status">
          <div className="booked-icon" aria-hidden="true">{confirmed ? "✓" : "…"}</div>
          <h1>{confirmed ? "Your table is booked!" : "Booking request sent"}</h1>
          <p className="lede">
            <b>Table {done.table_number}</b> for {done.guests} · {dayAndTime(done.booking_at)}
          </p>
          <p className="booking-ref">Booking number <b>#{done.id}</b></p>
          <p>We've sent a text to {done.phone}.{confirmed ? "" : " We'll confirm it shortly."}</p>
          {done.deposit_pence > 0 && <p className="notice">A deposit of {money(done.deposit_pence)} secures your table and comes off your bill. We'll contact you to take it.</p>}
          <p className="muted">When you arrive, tell us your name or booking number, then scan the QR code on your table to order from your phone. Need to change it? Call <a href="tel:01215547949">0121 554 7949</a>.</p>
          <div className="hero-ctas">
            <Link to="/" className="btn primary">See the menu</Link>
            <button className="btn ghost" onClick={() => { setDone(null); setTime(null); avail.reload(); }}>Make another booking</button>
          </div>
        </div>
      </div>
    );
  }

  if (restaurant && !restaurant.bookings_enabled) {
    return <div className="page narrow"><h1>Book a table</h1><p>Online booking is closed right now. Please call <a href="tel:01215547949">0121 554 7949</a>.</p></div>;
  }

  return (
    <form className="page narrow" onSubmit={submit}>
      <p className="eyebrow">Dine in</p>
      <h1>Book a table</h1>
      <p className="muted">Pick a day and a time with free tables. You'll get your table number straight away.</p>

      <section className="panel">
        <div className="row">
          <label className="field grow"><span className="field-label">Date</span>
            <input type="date" min={today} value={day} onChange={(e) => setDay(e.target.value || today)} required /></label>
          <label className="field grow"><span className="field-label">Guests</span>
            <select value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>)}
            </select></label>
        </div>

        <div className="field">
          <span className="field-label">Time</span>
          {avail.loading && !avail.data && <p className="muted">Checking free tables…</p>}
          {avail.error && <p className="error">{avail.error.message}</p>}
          {rows && rows.length === 0 && (day === today ? (
            <p className="notice">Bookings for today have finished (last booking is an hour before closing).{" "}
              <button type="button" className="linklike" onClick={() => setDay(tomorrow)}>Book for tomorrow</button></p>
          ) : <p className="muted">No booking times on this day. Try another date.</p>)}
          {nothingToday && <p className="notice">Every table for {guests} is booked on this day. Please try another date, or call us.</p>}
          <div className="slots" role="radiogroup" aria-label="Booking times">
            {(rows || []).map((a) => {
              const full = a.tables_left === 0;
              const on = time?.start === a.start;
              return (
                <button type="button" key={a.start} role="radio" aria-checked={on} disabled={full}
                  className={`slot ${full ? "booked" : a.tables_left <= 2 ? "few_left" : "free"} ${on ? "on" : ""}`} onClick={() => pick(a)}>
                  <b>{clock12(a.start)}</b>
                  <span>{full ? "Full" : `${a.tables_left} table${a.tables_left === 1 ? "" : "s"} left`}</span>
                </button>
              );
            })}
          </div>
        </div>

        {alternatives.length > 0 && (
          <div className="alts" role="alert">
            <p><b>{error || "That time just filled up."}</b></p>
            <div className="alt-row">
              {alternatives.map((iso) => {
                const row = (rows || []).find((a) => new Date(a.start).getTime() === new Date(iso).getTime());
                return (
                  <button type="button" key={iso} className="btn" onClick={() => row && pick(row)} disabled={!row}>
                    {clock12(iso)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {time && (
          <div className="field">
            <span className="field-label">Table at {clock12(time.start)}</span>
            <div className="table-pick" role="radiogroup" aria-label="Choose a table">
              <button type="button" role="radio" aria-checked={tableId === null} className={`table-chip ${tableId === null ? "on" : ""}`} onClick={() => setTableId(null)}>
                <b>Best table for {guests}</b><span>we choose</span>
              </button>
              {time.tables.map((t) => (
                <button type="button" key={t.id} role="radio" aria-checked={tableId === t.id} className={`table-chip ${tableId === t.id ? "on" : ""}`} onClick={() => setTableId(t.id)}>
                  <b>Table {t.number}</b><span>{t.seats} seats</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {time && (
        <section className="panel">
          <div className="row">
            <label className="field grow"><span className="field-label">Name</span><input value={f.name} onChange={set("name")} required autoComplete="name" /></label>
            <label className="field grow"><span className="field-label">Mobile</span><input type="tel" value={f.phone} onChange={set("phone")} required minLength={10} autoComplete="tel" /></label>
          </div>
          <label className="field"><span className="field-label">Anything we should know? (optional)</span>
            <input value={f.notes} onChange={set("notes")} placeholder="High chair, birthday, allergies…" /></label>
          {deposit > 0 && <p className="muted">Deposit: {money(deposit)}, taken off your final bill.</p>}
          {error && !alternatives.length && <p className="error" role="alert">{error}</p>}
          <button className="btn primary wide big" disabled={busy}>{busy ? "Booking…" : `Book for ${guests} at ${clock12(time.start)}`}</button>
        </section>
      )}
    </form>
  );
}
