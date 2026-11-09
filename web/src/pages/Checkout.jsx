import { useEffect, useRef, useState } from "react";
import { api, lookupPostcode, myOrderTokens, orderHeaders, STRIPE_PK } from "../api.js";
import { money, whenOpen } from "../format.js";
import { BusyMeter, useKitchenLoad } from "../extras.jsx";
import { Link, native, navigate, openNow, useApp } from "../state.jsx";

const TIPS = [0, 100, 200, 300];

export default function Checkout() {
  const { cart, subtotal, restaurant, user, clear } = useApp();
  const d = restaurant?.delivery;
  const [type, setType] = useState("delivery");
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [email, setEmail] = useState(user?.email || "");
  const [postcode, setPostcode] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [addrNotes, setAddrNotes] = useState("");
  const [geo, setGeo] = useState(null); // {postcode, lat, lng}
  const [quote, setQuote] = useState(null);
  const [checking, setChecking] = useState(false);
  const load = useKitchenLoad();
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

  // Delivery runs on set days/hours (Fri-Sun 5-10pm); collection while the restaurant is open.
  const deliveryOpen = d?.enabled && (load?.delivery_open ?? d?.open_now) !== false;
  const shopOpen = restaurant ? (typeof restaurant.open_now === "boolean" ? restaurant.open_now : openNow(restaurant) !== false) : true;
  const collectionOn = restaurant?.collection_enabled !== false;
  const canOrder = type === "delivery" ? deliveryOpen : collectionOn && shopOpen;
  const deliveryMins = load?.delivery_minutes || d?.minutes || 45;
  const collectMins = load?.wait_minutes || restaurant?.default_prep_minutes || 20;
  useEffect(() => {
    // Delivery closed but collection open (e.g. Tuesday lunchtime): start on collection.
    if (restaurant && d && !d.open_now && collectionOn && shopOpen) setType("collection");
  }, [restaurant]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const ready = canOrder && name.trim() && phone.trim().length >= 10 &&
    (type === "collection" ? true : quote && line1.trim() && !belowMin);

  async function placeOrder(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = {
      type,
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      customer_email: email.trim() || null,
      notes: notes.trim(),
      tip_pence: tip,
      promo_code: promo.trim() || null,
      push_token: native()?.pushToken || null,
      items: cart.map((l) => ({ menu_item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds, notes: l.notes || "" })),
    };
    if (type === "delivery") {
      body.address = { line1: line1.trim(), line2: line2.trim(), postcode: geo.postcode, lat: geo.lat, lng: geo.lng, notes: addrNotes.trim() };
    }
    try {
      const order = await api("/orders", { method: "POST", body });
      if (order.view_token) myOrderTokens.add(order.id, order.view_token);
      clear();
      setPlaced(order);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="page checkout" onSubmit={placeOrder}>
      <h1>Checkout</h1>
      {!canOrder && (
        <div className="closed-banner" role="status">
          <span className="closed-moon" aria-hidden="true">🌙</span>
          <div>
            {type === "delivery" ? (
              <>
                <b>{d?.enabled ? "We're not delivering right now." : "Delivery is switched off for now."}</b>
                <p>{d?.hours_text || "We deliver Friday to Sunday, 5pm to 10pm."}{collectionOn && shopOpen ? " Collection is open now." : ""}</p>
              </>
            ) : (
              <>
                <b>{collectionOn ? `We're closed right now${restaurant?.next_open ? `, and open again ${whenOpen(restaurant.next_open)}` : ""}.` : "Collection isn't available."}</b>
                <p>You can look through the menu now and order when we're open.</p>
              </>
            )}
          </div>
        </div>
      )}
      <div className="checkout-grid">
        <div className="checkout-main">
          <section className="panel">
            <h2>How would you like it?</h2>
            <div className="seg" role="radiogroup" aria-label="Order type">
              {d?.enabled && <button type="button" role="radio" aria-checked={type === "delivery"} className={type === "delivery" ? "on" : ""} onClick={() => setType("delivery")}>Delivery</button>}
              {restaurant?.collection_enabled !== false && <button type="button" role="radio" aria-checked={type === "collection"} className={type === "collection" ? "on" : ""} onClick={() => setType("collection")}>Collection</button>}
            </div>
            <BusyMeter compact />
          </section>

          {canOrder && (
            <section className="panel eta-panel">
              <span className="eta-icon" aria-hidden="true">{type === "delivery" ? "🛵" : "🥡"}</span>
              <div>
                <b>{type === "delivery" ? `Delivered in about ${deliveryMins} minutes` : `Ready to collect in about ${collectMins} minutes`}</b>
                <p className="muted small">
                  {type === "delivery"
                    ? "Straight to your door as soon as it's cooked. If we get busy we'll text you a new time."
                    : `From ${restaurant?.address || "324 Soho Rd, Handsworth"}. We'll text you when it's ready.`}
                </p>
              </div>
            </section>
          )}

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

          <section className="panel">
            <h2>Your details</h2>
            <div className="row">
              <label className="field grow"><span className="field-label">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
              <label className="field grow"><span className="field-label">Mobile number</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="07…" required /></label>
            </div>
            <label className="field"><span className="field-label">Email (optional, for your receipt and updates)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></label>
            <p className="muted small">We send order updates as notifications, by text and by email. {!user && <><Link to="/account">Log in</Link> to save your details and earn points.</>}</p>
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
          {!ready && !busy && <p className="muted small center">{!canOrder ? (type === "delivery" ? "Delivery is closed right now." : "We're closed right now.") : type === "delivery" && !quote ? "Check your postcode to continue." : "Fill in your details to continue."}</p>}
        </aside>
      </div>
    </form>
  );
}

export function loadStripe() {
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
    try { sessionStorage.setItem("pv_celebrate", String(order.id)); } catch { /* ignore */ }
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/order/${order.id}` } });
    if (error) setState((s) => ({ ...s, error: error.message }));
    setPaying(false);
  }

  async function payTest() {
    setPaying(true);
    try {
      await api(`/orders/${order.id}/test-pay`, { method: "POST", headers: orderHeaders(order.id) });
      try { sessionStorage.setItem("pv_celebrate", String(order.id)); } catch { /* ignore */ }
      navigate(`/order/${order.id}`);
    } catch (e) {
      setState((s) => ({ ...s, error: e.message }));
      setPaying(false);
    }
  }

  return (
    <div className="page narrow">
      <h1>Pay for order #{order.id}</h1>
      {order.arrive_by && <p className="muted">Delivered in about {order.promised_minutes} minutes once you've paid.</p>}
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
