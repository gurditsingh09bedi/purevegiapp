// Dine-in: the QR code on each table opens /t/<token>. Guests order from their phone,
// rounds go straight to the kitchen, and the bill is paid at the end of the meal.
import { useEffect, useState } from "react";
import { api, myOrderTokens } from "../api.js";
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
        <p className="muted small center">No payment now. Pay at the end of your meal.</p>
      </section>
    </div>
  );
}
