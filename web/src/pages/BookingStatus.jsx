// Live status of a table booking request. Refreshes by itself, so the customer sees the
// moment the restaurant accepts or declines, and any message staff send (e.g. about a cake).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, bookingHeaders, myBookingTokens } from "../api.js";
import { dayAndTime, money } from "../format.js";
import { Link, navigate, useApp } from "../state.jsx";

const VIEW = {
  pending: { icon: "⏳", cls: "wait", title: "Request sent", lede: "Waiting for Pure Vegi to confirm your table." },
  confirmed: { icon: "✓", cls: "ok", title: "Your table is confirmed!", lede: "See you soon." },
  declined: { icon: "✕", cls: "no", title: "Sorry, we can't take this booking", lede: "Please pick another time, or give us a call." },
  cancelled: { icon: "✕", cls: "no", title: "Booking cancelled", lede: "" },
  no_show: { icon: "✕", cls: "no", title: "Booking closed", lede: "We missed you this time." },
  seated: { icon: "🍽", cls: "ok", title: "Enjoy your meal!", lede: "Scan the QR code on your table to order from your phone." },
};

export default function BookingStatus({ id }) {
  const { restaurant } = useApp();
  const [b, setB] = useState(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const first = useRef(true);

  // A link from a text message carries the token as ?t=..., keep it for next time.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t) {
      myBookingTokens.add(id, t);
      window.history.replaceState({}, "", `/booking/${id}`);
    }
  }, [id]);

  const load = useCallback(() => {
    const quiet = !first.current;
    first.current = false;
    api(`/bookings/${id}`, { headers: bookingHeaders(id), quiet })
      .then((x) => { setB(x); setError(""); })
      .catch((e) => setError(e.status === 404 ? "We can't find this booking on this device. Open the link from your text message, or log in." : e.message));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function cancel() {
    setCancelling(true);
    try {
      setB(await api(`/bookings/${id}/cancel`, { method: "POST", headers: bookingHeaders(id) }));
    } catch (e) {
      setError(e.message);
    } finally {
      setCancelling(false);
    }
  }

  if (!b) {
    return <div className="page narrow">{error ? <p className="error">{error}</p> : <p className="muted">Loading your booking…</p>}</div>;
  }

  const v = VIEW[b.status] || VIEW.pending;
  const phone = restaurant?.phone || "0121 554 7949";
  return (
    <div className="page narrow">
      <div className={`booked-card ${v.cls}`} role="status" aria-live="polite">
        <div className="booked-icon" aria-hidden="true">{v.icon}</div>
        <p className="eyebrow">Booking #{b.id}</p>
        <h1>{v.title}</h1>
        <p className="lede">
          {b.status === "confirmed" || b.status === "seated" ? <><b>Table {b.table_number}</b> for {b.guests}</> : <>Table for {b.guests}</>}
          {" · "}{dayAndTime(b.booking_at)}
        </p>

        <ol className="b-steps" aria-label="Progress">
          <li className="done">Request sent</li>
          <li className={b.status === "pending" ? "now" : ["declined", "cancelled", "no_show"].includes(b.status) ? "bad" : "done"}>
            {b.status === "pending" ? "Restaurant checking" : b.status === "declined" ? "Not accepted" : b.status === "cancelled" ? "Cancelled" : "Confirmed"}
          </li>
          <li className={b.status === "seated" ? "done" : ""}>At your table</li>
        </ol>

        {b.staff_message && (
          <div className="staff-msg">
            <span className="staff-msg-from">Message from Pure Vegi</span>
            <p>{b.staff_message}</p>
          </div>
        )}

        {b.notes && (
          <div className="your-req">
            <span>Your request</span>
            <p>“{b.notes}”</p>
            {b.status === "pending" && <small>The restaurant will reply about this when they confirm.</small>}
          </div>
        )}

        {v.lede && <p>{v.lede}</p>}
        {b.status === "pending" && (
          <p className="muted small">This page updates by itself. We'll also text {b.phone} as soon as they reply.</p>
        )}
        {b.deposit_pence > 0 && ["pending", "confirmed"].includes(b.status) && (
          <p className="notice">Deposit {money(b.deposit_pence)}, taken off your final bill.</p>
        )}
        {error && <p className="error">{error}</p>}

        <div className="hero-ctas">
          {b.status === "declined" || b.status === "cancelled"
            ? <button className="btn primary" onClick={() => navigate("/book")}>Pick another time</button>
            : <Link to="/" className="btn primary">See the menu</Link>}
          {["pending", "confirmed"].includes(b.status) && (
            <button className="btn ghost" onClick={cancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel booking"}</button>
          )}
        </div>
        <p className="muted small">Questions? Call <a href={`tel:${phone.replace(/\s/g, "")}`}>{phone}</a>.</p>
      </div>
    </div>
  );
}
