// Dine-in: the QR code on each table opens /t/<token>. Guests order from their phone,
// rounds go straight to the kitchen, and the bill is paid at the end of the meal.
import { useEffect, useRef, useState } from "react";
import { api, myOrderTokens, STRIPE_PK } from "../api.js";
import { confetti } from "../fx.js";
import { loadStripe } from "./Checkout.jsx";
import { money, whenOpen } from "../format.js";
import { Link, native, navigate, openNow, useApp } from "../state.jsx";
import { MenuSection } from "./Home.jsx";

export function TableMenu({ token }) {
  const { table, setTable, count, setCartOpen, restaurant } = useApp();
  const kitchenClosed = restaurant && (typeof restaurant.open_now === "boolean" ? !restaurant.open_now : openNow(restaurant) === false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (table?.token === token) return;
    api(`/tables/qr/${encodeURIComponent(token)}`)
      .then((t) => setTable({ token, number: t.table_number }))
      .catch((e) => setError(e.message));
  }, [token, table, setTable]);

  if (error) return <div className="page narrow"><h1>Table ordering</h1><p className="error">{error}</p></div>;
  if (!table) return <div className="page narrow"><p className="muted">Finding your table…</p></div>;

  return (
    <>
      <section className="table-hero">
        <img src="/logo.jpg" alt="" width="64" height="64" />
        <div>
          <p className="eyebrow">Welcome to Pure Vegi</p>
          <h1>Table {table.number}</h1>
          <p className="muted">Order from your phone. Food comes to your table and you pay at the end.</p>
        </div>
      </section>
      {kitchenClosed && (
        <div className="closed-wrap"><div className="closed-banner" role="status"><span className="closed-moon" aria-hidden="true">🌙</span>
          <div><b>The kitchen is closed right now{restaurant.next_open ? `. We open ${whenOpen(restaurant.next_open)}` : ""}.</b>
            <p>Table orders start again when we open. Have a look at the menu in the meantime.</p></div></div></div>
      )}
      <TableBill token={token} number={table.number} />
      <MenuSection heading="What would you like?" />
      <p className="center small"><button className="linklike" onClick={() => { setTable(null); navigate("/"); }}>Not at the restaurant? Order for delivery or collection</button></p>
      {count > 0 && <button className="float-cart" onClick={() => setCartOpen(true)}>View order · {count} item{count > 1 ? "s" : ""}</button>}
    </>
  );
}

export function TableCheckout() {
  const { cart, subtotal, table, clear } = useApp();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!table) return <div className="page narrow"><p>Scan the QR code on your table to order.</p><Link to="/" className="btn">Go to the menu</Link></div>;
  if (!cart.length) return <div className="page narrow"><p className="muted">Nothing added yet.</p><Link to={`/t/${table.token}`} className="btn primary">Back to the menu</Link></div>;

  async function send() {
    setBusy(true);
    setError("");
    try {
      const o = await api("/orders", {
        method: "POST",
        body: {
          type: "dine_in", table_token: table.token, customer_name: name.trim(), notes: notes.trim(),
          push_token: native()?.pushToken || null,
          items: cart.map((l) => ({ menu_item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds, notes: l.notes || "" })),
        },
      });
      if (o.view_token) myOrderTokens.add(o.id, o.view_token);
      clear();
      try { sessionStorage.setItem("pv_celebrate", String(o.id)); } catch { /* ignore */ }
      navigate(`/order/${o.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <p className="eyebrow">Table {table.number}</p>
      <h1>Check your order</h1>
      <section className="panel">
        <ul className="sum-lines">
          {cart.map((l) => <li key={l.key}><span>{l.quantity}× {l.name}{l.optionNames.length ? <small className="muted"> ({l.optionNames.join(", ")})</small> : null}</span><span>{money(l.unit * l.quantity)}</span></li>)}
        </ul>
        <div className="sum-row total"><span>This round</span><span>{money(subtotal)}</span></div>
        <label className="field"><span className="field-label">Your name (optional)</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="field-label">Note for the kitchen (optional)</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, spice level…" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary wide big" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send to kitchen"}</button>
        <p className="muted small center">No payment now. At the end, pay from your phone or at the till.</p>
      </section>
    </div>
  );
}

// The bill at the end of the meal: pay from the phone, or tell staff you'll pay at the till.
function TableBill({ token, number }) {
  const [bill, setBill] = useState(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({}); // {paying, done, till, error, stripe}
  const mount = useRef(null);
  const stripeRef = useRef(null);
  const t = encodeURIComponent(token);

  const load = () => api(`/tables/qr/${t}/bill`, { quiet: true }).then(setBill).catch(() => setBill(null));
  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.done) {
    return (
      <section className="panel table-bill done" role="status">
        <h2>Thank you! Your bill is paid.</h2>
        <p className="muted">Enjoy the rest of your evening at Pure Vegi.</p>
      </section>
    );
  }
  if (!bill || !bill.orders?.length) return null;

  async function payOnline() {
    setState({ paying: true });
    try {
      const p = await api(`/tables/qr/${t}/pay`, { method: "POST" });
      if (p.dev_mode) {
        await api(`/tables/qr/${t}/test-pay`, { method: "POST" });
        confetti();
        setState({ done: true });
        return;
      }
      if (!STRIPE_PK) throw new Error("Card payments aren't set up yet. Please pay at the till.");
      const Stripe = await loadStripe();
      const stripe = Stripe(STRIPE_PK);
      const elements = stripe.elements({ clientSecret: p.client_secret, appearance: { theme: "stripe", variables: { colorPrimary: "#023E32" } } });
      stripeRef.current = { stripe, elements };
      setState({ stripe: true });
      setTimeout(() => elements.create("payment").mount(mount.current), 0);
    } catch (e) {
      setState({ error: e.message });
    }
  }

  async function confirmCard() {
    setState((x) => ({ ...x, paying: true }));
    const { stripe, elements } = stripeRef.current;
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/t/${t}` }, redirect: "if_required" });
    if (error) setState((x) => ({ ...x, paying: false, error: error.message }));
    else { confetti(); setState({ done: true }); }
  }

  async function payAtTill() {
    try {
      setBill(await api(`/tables/qr/${t}/pay-at-till`, { method: "POST" }));
      setState({ till: true });
    } catch (e) {
      setState({ error: e.message });
    }
  }

  return (
    <section className="panel table-bill">
      <button className="bill-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b>Your bill</b> · table {number}</span>
        <span className="bill-total">{money(bill.due_pence)} <span aria-hidden="true">{open ? "▴" : "▾"}</span></span>
      </button>
      {open && (
        <ul className="sum-lines">
          {bill.orders.flatMap((o) => o.items.map((it, i) => (
            <li key={`${o.id}-${i}`}><span>{it.quantity}× {it.name}{it.options.length ? <small className="muted"> ({it.options.map((x) => x.name).join(", ")})</small> : null}</span><span>{money(it.unit_price_pence * it.quantity)}</span></li>
          )))}
          {bill.deposit_pence > 0 && <li><span>Deposit paid</span><span>−{money(bill.deposit_pence)}</span></li>}
        </ul>
      )}
      {bill.pay_at_till || state.till ? (
        <p className="notice">Please pay at the till, by card or cash. Our staff know table {number} is ready to pay.</p>
      ) : state.stripe ? (
        <>
          <div ref={mount} className="stripe-mount" />
          <button className="btn primary wide big" onClick={confirmCard} disabled={state.paying}>{state.paying ? "Paying…" : `Pay ${money(bill.due_pence)}`}</button>
        </>
      ) : (
        <div className="bill-actions">
          <button className="btn primary big" onClick={payOnline} disabled={state.paying}>{state.paying ? "One moment…" : "Pay online now"}</button>
          <button className="btn ghost big" onClick={payAtTill}>Pay at the till</button>
        </div>
      )}
      {state.error && <p className="error" role="alert">{state.error}</p>}
    </section>
  );
}
