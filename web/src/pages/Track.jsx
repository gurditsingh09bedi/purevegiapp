import { useCallback, useEffect, useRef, useState } from "react";
import { api, myOrderTokens, orderHeaders, orderSocket, store } from "../api.js";
import { NotifyCard } from "../components.jsx";
import { confetti } from "../fx.js";
import { clock, money } from "../format.js";
import { Link, useApp } from "../state.jsx";

const STEPS = {
  delivery: [
    ["placed", "Order received"], ["accepted", "Accepted by Pure Vegi"], ["preparing", "Chef is cooking"],
    ["ready", "Packed and ready"], ["out_for_delivery", "On its way"], ["delivered", "Delivered"],
  ],
  collection: [
    ["placed", "Order received"], ["accepted", "Accepted by Pure Vegi"], ["preparing", "Chef is cooking"],
    ["ready", "Ready to collect"], ["collected", "Collected"],
  ],
  dine_in: [
    ["placed", "Sent to the kitchen"], ["accepted", "Accepted"], ["preparing", "Chef is cooking"],
    ["ready", "Coming to your table"], ["served", "Served"],
  ],
};
const DONE = ["delivered", "collected", "served"];

export default function Track({ id }) {
  const { restaurant, table } = useApp();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [driver, setDriver] = useState(null);
  const [showReview, setShowReview] = useState(false);

  const first = useRef(true);

  // Just ordered? Celebrate once, when the order is confirmed as paid / sent to the kitchen.
  useEffect(() => {
    if (!order || order.status === "pending_payment") return;
    let flag = null;
    try { flag = sessionStorage.getItem("pv_celebrate"); } catch { /* ignore */ }
    if (flag === String(order.id)) {
      try { sessionStorage.removeItem("pv_celebrate"); } catch { /* ignore */ }
      setTimeout(() => confetti(), 250);
    }
  }, [order]);
  const load = useCallback(() => {
    const quiet = !first.current;
    first.current = false;
    api(`/orders/${id}`, { headers: orderHeaders(id), quiet })
      .then((o) => { setOrder(o); setError(""); })
      .catch((e) => setError(e.status === 404 ? "We can't find this order on this device. Log in, or open the link from the device you ordered on." : e.message));
  }, [id]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    const stop = orderSocket(id, (ev) => {
      if (ev.event === "driver_location") setDriver(ev);
      else load();
    });
    return () => { clearInterval(poll); stop(); };
  }, [id, load]);

  // Google review pop-up a few seconds after the order is placed and paid (once per order).
  // Asked of every customer with no reward, as Google's rules require.
  useEffect(() => {
    const paid = order && !["pending_payment", "rejected", "cancelled"].includes(order.status);
    if (!paid || !restaurant?.google_review_url) return;
    if (store.get(`pv_review_asked_${order.id}`, false)) return;
    const t = setTimeout(() => setShowReview(true), DONE.includes(order.status) ? 1500 : 4000);
    return () => clearTimeout(t);
  }, [order, restaurant]);

  const closeReview = () => { store.set(`pv_review_asked_${order.id}`, true); setShowReview(false); };

  if (error) return <div className="page narrow"><h1>Order #{id}</h1><p className="error">{error}</p><Link to="/" className="btn">Back to menu</Link></div>;
  if (!order) return <div className="page narrow"><p className="muted">Loading your order…</p></div>;

  const steps = STEPS[order.type];
  const current = steps.findIndex(([s]) => s === order.status);
  const stopped = ["rejected", "cancelled"].includes(order.status);
  const unpaid = order.status === "pending_payment";

  let headline = "";
  if (unpaid) headline = "Waiting for payment";
  else if (stopped) headline = order.status === "rejected" ? "Sorry, we couldn't take this order" : "Order cancelled";
  else if (order.type === "delivery" && order.slot_start && !DONE.includes(order.status)) headline = `Arriving ${clock(order.slot_start)}–${clock(order.slot_end)}`;
  else if (order.type === "delivery" && order.arrive_by && !DONE.includes(order.status)) headline = `Arriving around ${clock(order.arrive_by)}`;
  else if (!DONE.includes(order.status)) headline = `Ready around ${clock(order.ready_at)}`;
  else headline = "Enjoy your meal!";

  return (
    <div className="page narrow track">
      <p className="eyebrow">Order #{order.id}{order.table_number ? ` · Table ${order.table_number}` : ""}</p>
      <h1>{headline}</h1>
      {stopped && <p className="notice">{order.status === "rejected" ? "Any payment is refunded to your card automatically. " : ""}Questions? Call <a href="tel:01215547949">0121 554 7949</a>.</p>}
      {unpaid && <p className="muted">Finish paying to send this order to the kitchen.</p>}

      {!stopped && !unpaid && !DONE.includes(order.status) && (
        <NotifyCard follow={{ order_id: order.id, order_token: myOrderTokens.get(order.id) }} what="every step of your order" />
      )}

      {!stopped && !unpaid && (
        <ol className="steps" aria-label="Order progress">
          {steps.map(([s, label], i) => (
            <li key={s} className={i < current ? "done" : i === current ? "now" : ""} aria-current={i === current ? "step" : undefined}>
              <span className="dot" aria-hidden="true" />
              <span>{label}</span>
              {i === current && order.events.find((e) => e.status === s) && <span className="muted small"> · {clock(order.events.find((e) => e.status === s).at)}</span>}
            </li>
          ))}
        </ol>
      )}

      {order.status === "out_for_delivery" && (
        <div className="panel">
          <b>Your driver is on the way.</b>
          {driver ? (
            <p><a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${driver.lat},${driver.lng}`}>See where your driver is</a> <span className="muted small">(updated {clock(driver.at)})</span></p>
          ) : <p className="muted small">Live location appears here once the driver's app shares it.</p>}
        </div>
      )}

      <section className="panel">
        <h2>Your order</h2>
        <ul className="sum-lines">
          {order.items.map((it, i) => (
            <li key={i}><span>{it.quantity}× {it.name}{it.options.length ? <small className="muted"> ({it.options.map((o) => o.name).join(", ")})</small> : null}</span><span>{money(it.unit_price_pence * it.quantity)}</span></li>
          ))}
        </ul>
        {order.delivery_fee_pence > 0 && <div className="sum-row"><span>Delivery</span><span>{money(order.delivery_fee_pence)}</span></div>}
        {order.discount_pence > 0 && <div className="sum-row"><span>Offer</span><span>−{money(order.discount_pence)}</span></div>}
        {order.tip_pence > 0 && <div className="sum-row"><span>Tip</span><span>{money(order.tip_pence)}</span></div>}
        <div className="sum-row total"><span>Total</span><span>{money(order.total_pence)}</span></div>
        {order.type === "dine_in" && <p className="muted small">Pay at the end of your meal, at the counter or with your server.</p>}
        {order.address && <p className="muted small">Delivering to {order.address.line1}, {order.address.postcode}</p>}
      </section>

      {order.type === "dine_in" && !stopped && table && <Link to={`/t/${table.token}`} className="btn ghost">Order more for the table</Link>}
      {showReview && <ReviewPop url={restaurant.google_review_url} done={DONE.includes(order.status)} onClose={closeReview} />}
    </div>
  );
}

// The Google review ask: a happy little animation that makes people want to write a few kind words.
// Every customer is asked the same way and every star goes to Google (no reward, no filtering).
function ReviewPop({ url, done, onClose }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => { n += 1; setLit(n); if (n >= 5) clearInterval(t); }, 260);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  const go = () => { confetti({ count: 90, y: 0.4 }); setTimeout(() => { window.open(url, "_blank", "noopener"); onClose(); }, 450); };

  return (
    <div className="modal-back review-back">
      <div className="modal review-pop" role="dialog" aria-modal="true" aria-label="Leave a Google review">
        <div className="rp-hearts" aria-hidden="true">{["💚", "🧡", "💚", "🧡", "💚"].map((h, i) => <span key={i} style={{ "--i": i }}>{h}</span>)}</div>
        <div className="rp-buddy" aria-hidden="true"><img src="/loading-boy.svg" alt="" /></div>
        <h2>{done ? "Enjoyed your meal?" : "Thank you for your order!"}</h2>
        <p className="rp-sub">Your kind words help our little kitchen on Soho Road grow. It only takes 30 seconds 🙏</p>
        <div className="rp-stars" role="group" aria-label="Rate us on Google">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={`rp-star ${n <= lit ? "on" : ""}`} style={{ "--i": n }} onClick={go} aria-label={`${n} star${n > 1 ? "s" : ""}: write a Google review`}>★</button>
          ))}
        </div>
        <button className="btn primary wide big rp-cta" onClick={go}>✍️ Write a Google review</button>
        <button className="rp-later" onClick={onClose}>Maybe later</button>
      </div>
    </div>
  );
}
