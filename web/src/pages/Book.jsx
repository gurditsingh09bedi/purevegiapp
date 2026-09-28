import { useMemo, useState } from "react";
import { api } from "../api.js";
import { dayAndTime, money } from "../format.js";
import { useApp } from "../state.jsx";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function localDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Booking times for a date: every N minutes from opening until an hour before closing.
function timesFor(dateStr, restaurant) {
  if (!dateStr || !restaurant) return [];
  const day = DAYS[new Date(`${dateStr}T12:00:00`).getDay()];
  const h = restaurant.opening_hours[day];
  if (!h || h.closed) return [];
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const step = restaurant.booking_slot_minutes || 30;
  const out = [];
  for (let m = toMin(h.opens); m <= toMin(h.closes) - 60; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

// "YYYY-MM-DD" + "HH:MM" in UK time → ISO string with the right offset (GMT or BST).
function ukIso(dateStr, time) {
  const guess = new Date(`${dateStr}T${time}:00Z`);
  const ukHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(guess));
  const offset = (ukHour - guess.getUTCHours() + 24) % 24; // 0 in winter, 1 in summer
  return `${dateStr}T${time}:00+0${offset}:00`;
}

export default function Book() {
  const { restaurant, user } = useApp();
  const today = localDateString(new Date());
  const [f, setF] = useState({ name: user?.name || "", phone: user?.phone || "", guests: 2, date: today, time: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const times = useMemo(() => timesFor(f.date, restaurant), [f.date, restaurant]);
  const deposit = restaurant ? (restaurant.booking_deposit_per_guest ? restaurant.booking_deposit_pence * f.guests : restaurant.booking_deposit_pence) : 0;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const b = await api("/bookings", {
        method: "POST",
        body: { name: f.name.trim(), phone: f.phone.trim(), guests: Number(f.guests), booking_at: ukIso(f.date, f.time), notes: f.notes.trim() },
      });
      setDone(b);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="page narrow">
        <h1>{done.status === "confirmed" ? "You're booked in!" : "Booking received"}</h1>
        <p className="lede">Table for {done.guests}, {dayAndTime(done.booking_at)}.</p>
        {done.deposit_pence > 0 && (
          <p className="notice">A deposit of {money(done.deposit_pence)} secures your table and comes off your bill. We'll contact you on {f.phone} to take it.</p>
        )}
        <p>When you arrive, scan the QR code on your table to order from your phone.</p>
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
      <p className="muted">Order from your table on your phone, then pay at the end of the meal.</p>
      <section className="panel">
        <div className="row">
          <label className="field grow"><span className="field-label">Date</span>
            <input type="date" min={today} value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value, time: "" }))} required /></label>
          <label className="field grow"><span className="field-label">Guests</span>
            <select value={f.guests} onChange={set("guests")}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>)}
            </select></label>
        </div>
        <div className="field">
          <span className="field-label">Time</span>
          {times.length === 0 ? <p className="muted">We're closed that day.</p> : (
            <div className="slots">
              {times.map((t) => (
                <button type="button" key={t} className={`slot free ${f.time === t ? "on" : ""}`} aria-pressed={f.time === t} onClick={() => setF((x) => ({ ...x, time: t }))}>
                  <b>{Number(t.slice(0, 2)) % 12 || 12}:{t.slice(3)}{Number(t.slice(0, 2)) < 12 ? "am" : "pm"}</b>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="row">
          <label className="field grow"><span className="field-label">Name</span><input value={f.name} onChange={set("name")} required autoComplete="name" /></label>
          <label className="field grow"><span className="field-label">Mobile</span><input type="tel" value={f.phone} onChange={set("phone")} required autoComplete="tel" /></label>
        </div>
        <label className="field"><span className="field-label">Anything we should know? (optional)</span>
          <input value={f.notes} onChange={set("notes")} placeholder="High chair, birthday, allergies…" /></label>
        {deposit > 0 && <p className="muted">Deposit: {money(deposit)}, taken off your final bill.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary wide big" disabled={busy || !f.time}>{busy ? "Booking…" : "Book table"}</button>
      </section>
    </form>
  );
}
