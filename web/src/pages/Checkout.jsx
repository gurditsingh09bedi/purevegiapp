import { useEffect, useRef, useState } from "react";
import { api, lookupPostcode, myOrderTokens, orderHeaders, STRIPE_PK } from "../api.js";
import { clock, money } from "../format.js";
import { Link, native, navigate, openNow, useApp, useLoad } from "../state.jsx";

const TIPS = [0, 100, 200, 300];

export default function Checkout() {
  const { cart, subtotal, restaurant, user, clear } = useApp();
  const d = restaurant?.delivery;
  const [type, setType] = useState("delivery");
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [postcode, setPostcode] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [addrNotes, setAddrNotes] = useState("");
  const [geo, setGeo] = useState(null); // {postcode, lat, lng}
  const [quote, setQuote] = useState(null);
  const [checking, setChecking] = useState(false);
  const [slot, setSlot] = useState(null);
  const [promo, setPromo] = useState("");
  const [tip, setTip] = useState(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState(null);

  useEffect(() => { if (user) { setName((n) => n || user.name); setPhone((p) => p || user.phone || ""); } }, [user]);
  useEffect(() => {
    if (restaurant && !restaurant.delivery?.enabled && restaurant.collection_enabled) setType("collection");
  }, [restaurant]);

  const slots = useLoad(() => (type === "delivery" ? api("/delivery/slots") : Promise.resolve([])), [type]);

  if (placed) return <PayStep order={placed} />;

  if (!cart.length) {
    return (
      <div className="page narrow">
        <h1>Checkout</h1>
        <p className="muted">Your basket is empty.</p>
        <Link to="/" className="btn primary">Back to the menu</Link>
      </div>
    );
  }

  async function checkPostcode() {
    setError("");
    setChecking(true);
    setQuote(null);
    try {
      const g = await lookupPostcode(postcode);
      setGeo(g);
      setPostcode(g.postcode);
      setQuote(await api("/delivery/quote", { method: "POST", body: { lat: g.lat, lng: g.lng } }));
    } catch (e) {
      setGeo(null);
      setError(e.message);
    } finally {
      setChecking(false);
    }
  }

  const fee = type === "delivery" && quote ? quote.fee_pence : 0;
  const total = subtotal + fee + tip;
  const belowMin = type === "delivery" && d && subtotal < d.min_order_pence;
  const collectionClosed = type === "collection" && openNow(restaurant) === false;
  const ready = name.trim() && phone.trim().length >= 10 &&
    (type === "collection" ? !collectionClosed : quote && slot && line1.trim() && !belowMin);

  async function placeOrder(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = {
      type,
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      notes: notes.trim(),
      tip_pence: tip,
      promo_code: promo.trim() || null,
      push_token: native()?.pushToken || null,
      items: cart.map((l) => ({ menu_item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds, notes: l.notes || "" })),
    };
    if (type === "delivery") {
      body.slot_start = slot.start;
      body.address = { line1: line1.trim(), line2: line2.trim(), postcode: geo.postcode, lat: geo.lat, lng: geo.lng, notes: addrNotes.trim() };
    }
    try {
      const order = await api("/orders", { method: "POST", body });
      if (order.view_token) myOrderTokens.add(order.id, order.view_token);
      clear();
      setPlaced(order);
    } catch (err) {
      setError(err.message);
      if (err.status === 409) slots.reload(); // slot just filled up
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="page checkout" onSubmit={placeOrder}>
      <h1>Checkout</h1>
      <div className="checkout-grid">
        <div className="checkout-main">
          <section className="panel">
            <h2>How would you like it?</h2>
            <div className="seg" role="radiogroup" aria-label="Order type">
              {d?.enabled && <button type="button" role="radio" aria-checked={type === "delivery"} className={type === "delivery" ? "on" : ""} onClick={() => setType("delivery")}>Delivery</button>}
              {restaurant?.collection_enabled !== false && <button type="button" role="radio" aria-checked={type === "collection"} className={type === "collection" ? "on" : ""} onClick={() => setType("collection")}>Collection</button>}
            </div>
            {collectionClosed && <p className="notice">We're closed right now, so collection orders open again at 12pm.</p>}
          </section>

          {type === "delivery" && (
            <section className="panel">
              <h2>Delivery address</h2>
              <div className="row">
                <label className="field grow">
                  <span className="field-label">Postcode</span>
                  <input value={postcode} onChange={(e) => { setPostcode(e.target.value.toUpperCase()); setQuote(null); }} autoComplete="postal-code" placeholder="B21 9NA" />
                </label>
                <button type="button" className="btn" onClick={checkPostcode} disabled={checking || !postcode.trim()}>{checking ? "Checking…" : "Check"}</button>
              </div>
              {quote && (
                <p className={`quote ${quote.is_free ? "free" : ""}`}>
                  {quote.distance_miles.toFixed(1)} miles away · {quote.is_free ? "Free delivery" : `Delivery ${money(quote.fee_pence)}`}
                </p>
              )}
              {quote && (
                <>
                  <label className="field"><span className="field-label">House number and street</span>
                    <input value={line1} onChange={(e) => setLine1(e.target.value)} autoComplete="address-line1" required /></label>
                  <label className="field"><span className="field-label">Flat, building (optional)</span>
                    <input value={line2} onChange={(e) => setLine2(e.target.value)} autoComplete="address-line2" /></label>
                  <label className="field"><span className="field-label">Note for the driver (optional)</span>
                    <input value={addrNotes} onChange={(e) => setAddrNotes(e.target.value)} placeholder="e.g. side door, ring twice" /></label>
                </>
              )}
            </section>
          )}

          {type === "delivery" && (
            <section className="panel">
              <h2>Choose a delivery time</h2>
              <p className="muted small">Each 15-minute slot takes a limited number of orders. Booked slots can't be picked.</p>
              {slots.error && <p className="error">{slots.error.message}</p>}
              {slots.data && slots.data.length === 0 && <p className="notice">No delivery slots are left today. Collection may still be open.</p>}
              <div className="slots" role="radiogroup" aria-label="Delivery slots">
                {(slots.data || []).map((s) => {
                  const booked = s.status === "booked";
                  const on = slot?.start === s.start;
                  return (
                    <button type="button" key={s.start} role="radio" aria-checked={on} disabled={booked}
                      className={`slot ${s.status} ${on ? "on" : ""}`} onClick={() => setSlot(s)}>
                      <b>{clock(s.start)}</b>
                      <span>{booked ? "Booked" : s.status === "few_left" ? "1 left" : "Free"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="panel">
            <h2>Your details</h2>
            <div className="row">
              <label className="field grow"><span className="field-label">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
              <label className="field grow"><span className="field-label">Mobile number</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="07…" required /></label>
            </div>
            <p className="muted small">We text you order updates. {!user && <><Link to="/account">Log in</Link> to save your details and earn points.</>}</p>
            <label className="field"><span className="field-label">Note for the kitchen (optional)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength="500" /></label>
          </section>
        </div>

        <aside className="panel summary">
          <h2>Your order</h2>
          <ul className="sum-lines">
            {cart.map((l) => (
              <li key={l.key}><span>{l.quantity}× {l.name}{l.optionNames.length ? <small className="muted"> ({l.optionNames.join(", ")})</small> : null}</span><span>{money(l.unit * l.quantity)}</span></li>
            ))}
          </ul>
          <label className="field"><span className="field-label">Offer code</span>
            <input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="Optional" /></label>
          <div className="field">
            <span className="field-label">Tip {type === "delivery" ? "for your driver" : "for the team"}</span>
            <div className="seg small">
              {TIPS.map((t) => <button type="button" key={t} className={tip === t ? "on" : ""} onClick={() => setTip(t)}>{t ? money(t) : "No tip"}</button>)}
            </div>
          </div>
          <div className="sum-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          {type === "delivery" && <div className="sum-row"><span>Delivery</span><span>{quote ? (fee ? money(fee) : "Free") : "Enter postcode"}</span></div>}
          {tip > 0 && <div className="sum-row"><span>Tip</span><span>{money(tip)}</span></div>}
          <div className="sum-row total"><span>Total</span><span>{money(total)}</span></div>
          {promo && <p className="muted small">Your offer is applied when you place the order.</p>}
          {belowMin && <p className="notice">Minimum order for delivery is {money(d.min_order_pence)}.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary wide big" disabled={!ready || busy}>{busy ? "Placing order…" : "Place order and pay"}</button>
          {!ready && !busy && <p className="muted small center">{type === "delivery" && !slot ? "Check your postcode and pick a slot to continue." : "Fill in your details to continue."}</p>}
        </aside>
      </div>
    </form>
  );
}

function loadStripe() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => resolve(window.Stripe);
    s.onerror = () => reject(new Error("Couldn't load secure payments. Please try again."));
    document.head.appendChild(s);
  });
}

export function PayStep({ order }) {
  const [state, setState] = useState({ loading: true });
  const [paying, setPaying] = useState(false);
  const mount = useRef(null);
  const stripeRef = useRef(null);

  useEffect(() => {
    let live = true;
    api(`/orders/${order.id}/pay`, { method: "POST", headers: orderHeaders(order.id) })
      .then(async (p) => {
        if (!live) return;
        if (p.dev_mode) return setState({ dev: true, amount: p.amount_pence });
        if (!STRIPE_PK) return setState({ error: "Card payments aren't set up yet. Please call us to complete this order." });
        const Stripe = await loadStripe();
        const stripe = Stripe(STRIPE_PK);
        const elements = stripe.elements({ clientSecret: p.client_secret, appearance: { theme: "stripe", variables: { colorPrimary: "#023E32" } } });
        stripeRef.current = { stripe, elements };
        setState({ amount: p.amount_pence });
        setTimeout(() => elements.create("payment").mount(mount.current), 0);
      })
      .catch((e) => live && setState({ error: e.message }));
    return () => { live = false; };
  }, [order.id]);

  async function payReal() {
    setPaying(true);
    const { stripe, elements } = stripeRef.current;
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/order/${order.id}` } });
    if (error) setState((s) => ({ ...s, error: error.message }));
    setPaying(false);
  }

  async function payTest() {
    setPaying(true);
    try {
      await api(`/orders/${order.id}/test-pay`, { method: "POST", headers: orderHeaders(order.id) });
      navigate(`/order/${order.id}`);
    } catch (e) {
      setState((s) => ({ ...s, error: e.message }));
      setPaying(false);
    }
  }

  return (
    <div className="page narrow">
      <h1>Pay for order #{order.id}</h1>
      {order.slot_start && <p className="muted">Your {clock(order.slot_start)}–{clock(order.slot_end)} slot is held for a few minutes while you pay.</p>}
      {order.discount_pence > 0 && <p className="quote free">Offer applied: −{money(order.discount_pence)}</p>}
      <p className="pay-total">Total <b>{money(order.total_pence)}</b></p>
      {state.loading && <p className="muted">Preparing secure payment…</p>}
      {state.dev && (
        <div className="panel test-pay">
          <p><b>Test mode.</b> No real card is charged. This button is replaced by card, Apple Pay and Google Pay once Stripe is connected.</p>
          <button className="btn primary wide big" onClick={payTest} disabled={paying}>{paying ? "Confirming…" : `Pay ${money(order.total_pence)} (test)`}</button>
        </div>
      )}
      {!state.dev && !state.loading && !state.error?.startsWith("Card payments") && (
        <div className="panel">
          <div ref={mount} className="stripe-mount" />
          <button className="btn primary wide big" onClick={payReal} disabled={paying || !stripeRef.current}>{paying ? "Paying…" : `Pay ${money(order.total_pence)}`}</button>
        </div>
      )}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <p className="muted small">Card details go straight to Stripe; Pure Vegi never sees or stores them.</p>
    </div>
  );
}
