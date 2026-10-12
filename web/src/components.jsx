import { useEffect, useRef, useState } from "react";
import { busy, enableWebPush, webPushState } from "./api.js";
import { buzz, flyToCart, tiltProps } from "./fx.js";
import { money, whenOpen } from "./format.js";
import { Link, navigate, openNow, useApp } from "./state.jsx";

// Shown while we're closed: you can still order, for later.
export function ClosedBanner({ compact = false }) {
  const { restaurant, table } = useApp();
  if (!restaurant || table) return null;
  const closed = typeof restaurant.open_now === "boolean" ? !restaurant.open_now : openNow(restaurant) === false;
  if (!closed) return null;
  return (
    <div className={`closed-banner ${compact ? "compact" : ""}`} role="status">
      <span className="closed-moon" aria-hidden="true">🌙</span>
      <div>
        <b>We're closed right now{restaurant.next_open ? `. We open ${whenOpen(restaurant.next_open)}` : ""}.</b>
        <p>{compact ? "You can still order for later: pick a time at checkout." : "Order now for later: choose a delivery slot or collection time at checkout, and it'll be fresh and ready on time."}</p>
      </div>
    </div>
  );
}

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
    <button className={`dish reveal ${sold ? "sold" : ""}`} onClick={() => !sold && onOpen(item)} disabled={sold} {...(sold ? {} : tiltProps())}
      aria-label={sold ? `${item.name}, sold out` : `${item.name}, ${money(item.price_pence)}. Add to basket`}>
      <DishArt item={item} />
      <div className="dish-body">
        <div className="dish-top">
          <h3>{item.name}</h3>
          <span className="price">{item.option_groups.some((g) => g.min_choices && g.options.some((o) => o.price_pence > 0)) ? "from " : ""}{money(item.price_pence)}</span>
        </div>
        {item.description && <p className="dish-desc">{item.description}</p>}
        <div className="tags">
          {item.is_vegan && <span className="tag vegan">Vegan</span>}
          {item.spice_level > 0 && <span className="tag spice">{SPICE[item.spice_level]}</span>}
          {sold && <span className="tag sold">Sold out today</span>}
        </div>
      </div>
      {!sold && <span className="add-plus" aria-hidden="true">+</span>}
      <span className="dish-glare" aria-hidden="true" />
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
  const art = useRef(null);

  const toggle = (g, o) => setChosen((c) => {
    const cur = c[g.id] || [];
    if (g.max_choices === 1) return { ...c, [g.id]: cur.includes(o.id) && g.min_choices === 0 ? [] : [o.id] };
    if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
    if (cur.length >= g.max_choices) return c;
    return { ...c, [g.id]: [...cur, o.id] };
  });

  // Some groups only apply after a choice elsewhere (pizza toppings priced by size, "choose your can" with a meal).
  const picked = (groups) => groups.flatMap((g) => g.options.filter((o) => (chosen[g.id] || []).includes(o.id)));
  const pickedNames = new Set(picked(item.option_groups.filter((g) => !g.shown_if)).map((o) => o.name));
  const visible = item.option_groups.filter((g) => !g.shown_if || pickedNames.has(g.shown_if));
  const options = picked(visible);
  const missing = visible.find((g) => (chosen[g.id] || []).length < g.min_choices);
  const unit = item.price_pence + options.reduce((s, o) => s + o.price_pence, 0);

  return (
    <Modal onClose={onClose} label={item.name}>
      <div ref={art}><DishArt item={item} big /></div>
      <h2>{item.name}</h2>
      {item.description && <p className="muted">{item.description}</p>}
      <div className="tags">
        {item.is_vegan && <span className="tag vegan">Vegan</span>}
        {item.spice_level > 0 && <span className="tag spice">{SPICE[item.spice_level]}</span>}
      </div>
      <p className="allergen-line">
        {item.allergens.length
          ? <><b>Allergens:</b> {item.allergens.join(", ")}. Please tell us about any allergy before ordering.</>
          : <><b>Allergies?</b> Please ask us about ingredients before ordering: call 0121 554 7949 or add a note.</>}
      </p>

      {visible.map((g) => (
        <fieldset key={g.id} className={`opt-group ${g.shown_if ? "opt-follow" : ""}`}>
          <legend>
            {g.name}
            <span className="muted"> · {g.min_choices > 1 && g.min_choices === g.max_choices ? `choose ${g.min_choices}`
              : `${g.min_choices ? "required" : "optional"}${g.max_choices > 1 && g.max_choices < g.options.length ? `, up to ${g.max_choices}` : ""}`}</span>
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
          onClick={() => { add(item, options, qty, notes.trim()); flyToCart(art.current?.firstElementChild); onClose(); }}>
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
        <ClosedBanner compact />
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

// The loading circle: a spinning ring around the little Sikh boy eating Pure Vegi pizza
// (photo at /boy-photo.png, falling back to the animated drawing /loading-boy.svg). It only appears while
// something is really loading: after 250 ms of waiting, and it stays at least 700 ms so it
// never flickers. The first page load uses the same animation from index.html.
export function BusyOverlay() {
  const [show, setShow] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    let showTimer;
    let hideTimer;
    const boot = document.getElementById("boot-loader");
    const finishBoot = () => {
      if (!boot || boot.classList.contains("gone")) return;
      const wait = Number(boot.dataset.until || 0) - Date.now(); // the app splash plays for a moment first
      if (wait > 0) { setTimeout(finishBoot, wait); return; }
      boot.classList.add("gone");
      setTimeout(() => boot.remove(), 500);
    };
    const onChange = (n) => {
      if (n > 0 && boot && !boot.classList.contains("gone")) return; // the first-load animation is already showing
      if (n > 0) {
        clearTimeout(hideTimer);
        if (!showTimer && !shownAt.current) showTimer = setTimeout(() => { shownAt.current = Date.now(); setShow(true); showTimer = null; }, 250);
      } else {
        clearTimeout(showTimer);
        showTimer = null;
        finishBoot();
        if (shownAt.current) {
          const wait = Math.max(0, 700 - (Date.now() - shownAt.current));
          hideTimer = setTimeout(() => { shownAt.current = 0; setShow(false); }, wait);
        }
      }
    };
    const unsub = busy.subscribe(onChange);
    // The first requests start as the page mounts; if none are pending shortly after, the page is ready.
    const first = setTimeout(() => busy.count() === 0 && finishBoot(), 400);
    return () => { unsub(); clearTimeout(showTimer); clearTimeout(hideTimer); clearTimeout(first); };
  }, []);
  if (!show) return null;
  return (
    <div className="busy" role="status" aria-live="polite">
      <div className="busy-card">
        <div className="pv-spinner small">
          <img src="/boy-photo.png" alt="" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/loading-boy.svg"; }} />
        </div>
        <p>Just a moment…</p>
      </div>
    </div>
  );
}

// "Get updates on this device": browser notifications for an order or a booking.
// Already allowed -> subscribes quietly. Hidden inside the phone app (it has its own push).
export function NotifyCard({ follow, what = "updates" }) {
  const [state, setState] = useState(() => webPushState());
  const [working, setWorking] = useState(false);
  const key = JSON.stringify(follow);

  useEffect(() => {
    if (webPushState() === "granted") enableWebPush(follow, { ask: false }).then(setState).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (state === "app" || state === "unsupported" || state === "off") return null;
  if (state === "granted") return <p className="notify-card on">🔔 Notifications are on for this device.</p>;
  if (state === "denied") return <p className="notify-card muted small">Notifications are blocked in your browser settings. We'll still text you.</p>;
  if (state === "ios-home-screen") {
    return <p className="notify-card muted small">On iPhone: tap Share → “Add to Home Screen”, open Pure Vegi from there, and you can turn on notifications.</p>;
  }
  return (
    <div className="notify-card">
      <span>🔔 Get {what} on this device, even when this page is closed.</span>
      <button className="btn small primary" disabled={working} onClick={async () => {
        setWorking(true);
        try { setState(await enableWebPush(follow)); } catch { setState(webPushState()); } finally { setWorking(false); }
      }}>{working ? "…" : "Turn on notifications"}</button>
    </div>
  );
}

// Phone-style tab bar at the bottom (phones and the Pure Vegi app). Hidden on table QR pages.
const ICON = {
  menu: "M4 6h16M4 12h16M4 18h10",
  book: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 9h3v3H8z",
  orders: "M6 3h12l1 4H5l1-4Zm-1 4h14v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7Zm4 4h6M9 15h4",
  basket: "M3 9h18l-2 11H5L3 9Zm4 0 3-6m7 6-3-6M9 13v4m6-4v4",
};
function TabIcon({ d }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function TabBar({ path }) {
  const { count, setCartOpen, user } = useApp();
  const tab = (key, label, active, onClick, badge) => (
    <button key={key} className={`tab ${active ? "on" : ""}`} aria-current={active ? "page" : undefined}
      onClick={() => { buzz(8); onClick(); }}>
      <span className="tab-ico"><TabIcon d={ICON[key]} />{badge > 0 && <span className="tab-badge">{badge}</span>}</span>
      <span>{label}</span>
    </button>
  );
  const onHome = path === "/" || path === "";
  return (
    <nav className="tabbar" aria-label="App">
      {tab("menu", "Menu", onHome, () => { if (!onHome) navigate("/"); setTimeout(() => document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" }), onHome ? 0 : 120); })}
      {tab("book", "Book", path === "/book" || path.startsWith("/booking/"), () => navigate("/book"))}
      {tab("orders", user ? "My orders" : "Orders", path === "/account" || path.startsWith("/order/"), () => navigate("/account"))}
      {tab("basket", "Basket", false, () => setCartOpen(true), count)}
    </nav>
  );
}
