import { useEffect, useState } from "react";
import { money } from "./format.js";
import { Link, navigate, openNow, useApp } from "./state.jsx";

export function Header() {
  const { count, setCartOpen, user, table, restaurant } = useApp();
  const open = openNow(restaurant);
  return (
    <header className="site-header">
      <Link to={table ? `/t/${table.token}` : "/"} className="logo">
        <img src="/logo.jpg" alt="" width="44" height="44" />
        <span>Pure Vegi</span>
      </Link>
      {table ? (
        <span className="table-pill">Ordering to table {table.number}</span>
      ) : (
        <nav className="main-nav" aria-label="Main">
          <a href="/#menu" onClick={(e) => { e.preventDefault(); navigate("/"); setTimeout(() => document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" }), 50); }}>Menu</a>
          <Link to="/book">Book a table</Link>
          <Link to="/account">{user ? "My orders" : "Log in"}</Link>
        </nav>
      )}
      <div className="header-right">
        {open !== null && !table && <span className={`open-dot ${open ? "on" : ""}`}>{open ? "Open now" : "Closed now"}</span>}
        <button className="cart-btn" onClick={() => setCartOpen(true)} aria-label={`Basket, ${count} items`}>
          <span aria-hidden="true">Basket</span>
          <span className="cart-count">{count}</span>
        </button>
      </div>
    </header>
  );
}

export function Modal({ onClose, label, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        {children}
      </div>
    </div>
  );
}

const SPICE = ["", "Mild", "Medium", "Hot"];

export function DishArt({ item, big }) {
  if (item.image_url) return <img className={`dish-img ${big ? "big" : ""}`} src={item.image_url} alt={item.name} loading="lazy" />;
  // No photo yet: a tasteful placeholder in brand colours with the dish's initials.
  const initials = item.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  const hue = [...item.name].reduce((h, ch) => (h + ch.charCodeAt(0)) % 4, 0);
  return <div className={`dish-img ph ph${hue} ${big ? "big" : ""}`} aria-hidden="true"><span>{initials}</span></div>;
}

export function DishCard({ item, onOpen }) {
  const sold = !item.is_available;
  return (
    <button className={`dish ${sold ? "sold" : ""}`} onClick={() => !sold && onOpen(item)} disabled={sold}
      aria-label={sold ? `${item.name}, sold out` : `${item.name}, ${money(item.price_pence)}. Add to basket`}>
      <DishArt item={item} />
      <div className="dish-body">
        <div className="dish-top">
          <h3>{item.name}</h3>
          <span className="price">{money(item.price_pence)}</span>
        </div>
        {item.description && <p className="dish-desc">{item.description}</p>}
        <div className="tags">
          {item.is_vegan && <span className="tag vegan">Vegan</span>}
          {item.spice_level > 0 && <span className="tag spice">{SPICE[item.spice_level]}</span>}
          {sold && <span className="tag sold">Sold out today</span>}
        </div>
      </div>
      {!sold && <span className="add-plus" aria-hidden="true">+</span>}
    </button>
  );
}

export function ItemModal({ item, onClose }) {
  const { add } = useApp();
  const [chosen, setChosen] = useState(() => {
    const init = {};
    item.option_groups.forEach((g) => {
      const first = g.options.find((o) => o.is_available);
      init[g.id] = g.min_choices >= 1 && g.max_choices === 1 && first ? [first.id] : [];
    });
    return init;
  });
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  const toggle = (g, o) => setChosen((c) => {
    const cur = c[g.id] || [];
    if (g.max_choices === 1) return { ...c, [g.id]: cur.includes(o.id) && g.min_choices === 0 ? [] : [o.id] };
    if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
    if (cur.length >= g.max_choices) return c;
    return { ...c, [g.id]: [...cur, o.id] };
  });

  const options = item.option_groups.flatMap((g) => g.options.filter((o) => (chosen[g.id] || []).includes(o.id)));
  const missing = item.option_groups.find((g) => (chosen[g.id] || []).length < g.min_choices);
  const unit = item.price_pence + options.reduce((s, o) => s + o.price_pence, 0);

  return (
    <Modal onClose={onClose} label={item.name}>
      <DishArt item={item} big />
      <h2>{item.name}</h2>
      {item.description && <p className="muted">{item.description}</p>}
      <div className="tags">
        {item.is_vegan && <span className="tag vegan">Vegan</span>}
        {item.spice_level > 0 && <span className="tag spice">{SPICE[item.spice_level]}</span>}
      </div>
      <p className="allergen-line">
        <b>Allergens:</b> {item.allergens.length ? item.allergens.join(", ") : "none listed"}.
        {" "}Please tell us about any allergy before ordering.
      </p>

      {item.option_groups.map((g) => (
        <fieldset key={g.id} className="opt-group">
          <legend>
            {g.name}
            <span className="muted"> · {g.min_choices ? "required" : "optional"}{g.max_choices > 1 ? `, up to ${g.max_choices}` : ""}</span>
          </legend>
          {g.options.map((o) => (
            <label key={o.id} className={`opt ${o.is_available ? "" : "off"}`}>
              <input type={g.max_choices === 1 ? "radio" : "checkbox"} name={`g${g.id}`} disabled={!o.is_available}
                checked={(chosen[g.id] || []).includes(o.id)} onChange={() => toggle(g, o)} />
              <span>{o.name}</span>
              <span className="muted">{o.price_pence ? `+${money(o.price_pence)}` : ""}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <label className="field">
        <span className="field-label">Note for the kitchen (optional)</span>
        <input maxLength="300" placeholder="e.g. no onion" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="modal-foot">
        <div className="qty" role="group" aria-label="Quantity">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="One less">−</button>
          <span aria-live="polite">{qty}</span>
          <button onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="One more">+</button>
        </div>
        <button className="btn primary grow" disabled={!!missing}
          onClick={() => { add(item, options, qty, notes.trim()); onClose(); }}>
          {missing ? `Choose ${missing.name}` : `Add ${qty} · ${money(unit * qty)}`}
        </button>
      </div>
    </Modal>
  );
}

export function CartDrawer() {
  const { cart, subtotal, setQty, cartOpen, setCartOpen, table } = useApp();
  if (!cartOpen) return null;
  return (
    <div className="drawer-back" onClick={() => setCartOpen(false)}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Your basket" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Your basket</h2>
          <button className="modal-x static" onClick={() => setCartOpen(false)} aria-label="Close basket">×</button>
        </div>
        {cart.length === 0 ? (
          <p className="muted">Your basket is empty. Add something tasty from the menu.</p>
        ) : (
          <>
            <ul className="lines">
              {cart.map((l) => (
                <li key={l.key}>
                  <div>
                    <b>{l.name}</b>
                    {l.optionNames.length > 0 && <div className="muted small">{l.optionNames.join(", ")}</div>}
                    {l.notes && <div className="muted small">“{l.notes}”</div>}
                  </div>
                  <div className="qty small-qty" role="group" aria-label={`Quantity of ${l.name}`}>
                    <button onClick={() => setQty(l.key, l.quantity - 1)} aria-label="One less">−</button>
                    <span>{l.quantity}</span>
                    <button onClick={() => setQty(l.key, l.quantity + 1)} aria-label="One more">+</button>
                  </div>
                  <span className="line-price">{money(l.unit * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="drawer-total"><span>Subtotal</span><b>{money(subtotal)}</b></div>
            <button className="btn primary wide" onClick={() => { setCartOpen(false); navigate(table ? "/t/checkout" : "/checkout"); }}>
              {table ? "Review and send to kitchen" : "Go to checkout"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

export function Footer() {
  const { restaurant } = useApp();
  return (
    <footer className="site-footer">
      <div>
        <img src="/logo.jpg" alt="Pure Vegi" width="72" height="72" className="foot-logo" />
        <p><b>Pure Vegi</b><br />{restaurant?.address || "324 Soho Rd, Handsworth, Birmingham B21 9NA"}</p>
        <p><a href={`tel:${(restaurant?.phone || "0121 554 7949").replace(/\s/g, "")}`}>{restaurant?.phone || "0121 554 7949"}</a></p>
      </div>
      <div>
        <p className="muted small">Vegetarian food with vegan options. Allergen information is on every dish; please tell us about any allergy before ordering.</p>
        <p className="muted small">© {new Date().getFullYear()} Pure Vegi</p>
      </div>
    </footer>
  );
}
