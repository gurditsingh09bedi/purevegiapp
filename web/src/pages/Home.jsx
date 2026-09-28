import { useEffect, useState } from "react";
import { api } from "../api.js";
import { DishCard, ItemModal } from "../components.jsx";
import { money } from "../format.js";
import Cinema from "../Cinema.jsx";
import { openNow, useApp, useLoad } from "../state.jsx";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const t12 = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

export function MenuSection({ heading = "Our menu" }) {
  const menu = useLoad(() => api("/menu"));
  const [open, setOpen] = useState(null);
  const [active, setActive] = useState(null);
  const [veganOnly, setVeganOnly] = useState(false);

  useEffect(() => {
    if (menu.data?.length && active === null) setActive(menu.data[0].id);
  }, [menu.data, active]);

  const jump = (id) => {
    setActive(id);
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section id="menu" className="menu-section">
      <div className="menu-head">
        <h2>{heading}</h2>
        <label className="switch">
          <input type="checkbox" checked={veganOnly} onChange={(e) => setVeganOnly(e.target.checked)} />
          <span>Vegan only</span>
        </label>
      </div>
      {menu.error && <p className="error">{menu.error.message}</p>}
      {menu.loading && !menu.data && <div className="skeleton-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {menu.data && (
        <>
          <nav className="cat-tabs" aria-label="Menu categories">
            {menu.data.map((c) => (
              <button key={c.id} className={active === c.id ? "on" : ""} onClick={() => jump(c.id)}>{c.name}</button>
            ))}
          </nav>
          {menu.data.map((c) => {
            const items = c.items.filter((i) => !veganOnly || i.is_vegan);
            if (!items.length) return null;
            return (
              <div key={c.id} id={`cat-${c.id}`} className="cat-block">
                <h3 className="cat-title">{c.name}</h3>
                <div className="dish-grid">
                  {items.map((i) => <DishCard key={i.id} item={i} onOpen={setOpen} />)}
                </div>
              </div>
            );
          })}
          {menu.data.length === 0 && <p className="muted">The menu is being updated. Please check back soon.</p>}
        </>
      )}
      {open && <ItemModal item={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export default function Home() {
  const { restaurant, count, setCartOpen } = useApp();
  const open = openNow(restaurant);
  const d = restaurant?.delivery;
  const todayName = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(new Date()).toLowerCase();
  const today = restaurant?.opening_hours?.[todayName];
  const todayText = !today ? "" : today.closed ? "Closed today" : `Today ${t12(today.opens.slice(0, 5))}–${t12(today.closes.slice(0, 5))}`;

  return (
    <>
      <Cinema />
      {restaurant?.online_orders_paused && <p className="notice paused-banner">We're very busy right now and have paused online orders for a few minutes. Please try again shortly.</p>}

      <section className="facts" aria-label="Opening and delivery">
        <div className="fact"><b>{open === null ? "Opening hours" : open ? "Open now" : "Closed now"}</b><span>{todayText}</span></div>
        {d?.enabled && <div className="fact"><b>Delivery {t12(d.hours[0].slice(0, 5))}–{t12(d.hours[1].slice(0, 5))}</b><span>Pick a 15-minute slot</span></div>}
        {d && <div className="fact"><b>Free delivery within {d.free_radius_miles} miles</b><span>{money(d.fee_beyond_free_pence)} beyond that</span></div>}
        <div className="fact"><b>Collection</b><span>Ready when you arrive</span></div>
      </section>

      <MenuSection />

      <section className="visit">
        <div>
          <h2>Visit us</h2>
          <p>{restaurant?.address || "324 Soho Rd, Handsworth, Birmingham B21 9NA"}</p>
          <p><a href="tel:01215547949">{restaurant?.phone || "0121 554 7949"}</a></p>
          <p><a className="btn ghost" target="_blank" rel="noreferrer" href="https://www.google.com/maps/search/?api=1&query=Pure+Vegi+324+Soho+Rd+Birmingham+B21+9NA">Get directions</a></p>
        </div>
        <div>
          <h3>Opening hours</h3>
          <table className="hours">
            <tbody>
              {restaurant && DAYS.map((day) => {
                const h = restaurant.opening_hours[day];
                return (
                  <tr key={day}>
                    <td className="cap">{day}</td>
                    <td>{h.closed ? "Closed" : `${t12(h.opens.slice(0, 5))} – ${t12(h.closes.slice(0, 5))}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {count > 0 && (
        <button className="float-cart" onClick={() => setCartOpen(true)}>View basket · {count} item{count > 1 ? "s" : ""}</button>
      )}
    </>
  );
}
