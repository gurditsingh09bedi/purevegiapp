// Home page extras: the kitchen busy meter, today's special and the Google reviews strip.
import { useEffect, useState } from "react";
import { api } from "./api.js";
import { DishArt } from "./components.jsx";
import { money } from "./format.js";
import { openNow, useApp } from "./state.jsx";

const LEVEL = {
  quiet: { word: "Nice and quiet", bars: 1 },
  busy: { word: "Busy", bars: 2 },
  very_busy: { word: "Very busy", bars: 3 },
};

// Live kitchen load, refreshed every minute. Shows nothing while we're closed.
export function useKitchenLoad() {
  const { restaurant } = useApp();
  const [load, setLoad] = useState(restaurant?.busy || null);
  useEffect(() => { if (restaurant?.busy) setLoad(restaurant.busy); }, [restaurant]);
  useEffect(() => {
    let live = true;
    const get = () => api("/restaurant/busy", { quiet: true }).then((x) => live && setLoad(x)).catch(() => {});
    const t = setInterval(get, 60000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return load;
}

export function BusyMeter({ compact = false }) {
  const { restaurant, table } = useApp();
  const load = useKitchenLoad();
  if (!load || !restaurant || table) return null;
  const closed = typeof load.open_now === "boolean" ? !load.open_now : openNow(restaurant) === false;
  if (closed) return null;
  const l = LEVEL[load.level] || LEVEL.quiet;
  return (
    <div className={`busy-meter lvl-${load.level} ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <span className="busy-bars" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= l.bars ? "on" : ""} />)}</span>
      <span className="busy-text">
        <b>{load.paused ? "Online orders paused" : `Kitchen: ${l.word}`}</b>
        {!load.paused && restaurant.delivery?.enabled && <span>Delivery within about {load.delivery_minutes || 45} min</span>}
      </span>
    </div>
  );
}

// "Today's special" card at the top of the menu; tapping it opens the dish to add it.
export function TodaysSpecial({ menu, onOpen }) {
  const { restaurant } = useApp();
  const sp = restaurant?.special;
  const item = sp && menu?.flatMap((c) => c.items).find((i) => i.id === sp.item_id);
  if (!item || !item.is_available) return null;
  return (
    <button className="special-card" onClick={() => onOpen(item)} aria-label={`Today's special: ${item.name}, ${money(item.price_pence)}. Tap to add`}>
      <div className="special-art"><DishArt item={item} big /></div>
      <div className="special-body">
        <span className="special-tag">★ Today's special</span>
        <h3>{item.name}</h3>
        {sp.note ? <p className="special-note">{sp.note}</p> : item.description && <p>{item.description}</p>}
        <span className="special-cta">Add to basket · {money(item.price_pence)}</span>
      </div>
      <span className="special-shine" aria-hidden="true" />
    </button>
  );
}

const MAPS = "https://www.google.com/maps/search/?api=1&query=Pure+Vegi+324+Soho+Rd+Birmingham+B21+9NA";
const stars = (n) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);

// Real reviews, copied from Google by staff (Admin > Settings > Google reviews).
export function ReviewsStrip() {
  const { restaurant } = useApp();
  const reviews = restaurant?.reviews || [];
  const writeUrl = restaurant?.google_review_url;
  if (!reviews.length && !writeUrl) return null;
  const rating = restaurant?.google_rating;
  const count = restaurant?.google_review_count;
  const loop = reviews.length >= 3 ? [...reviews, ...reviews] : reviews; // seamless scroll
  return (
    <section className="reviews" aria-label="What customers say">
      <div className="reviews-head">
        <div>
          <p className="eyebrow">What customers say</p>
          <h2>{rating ? <><span className="rev-big">{rating.toFixed(1)}</span> <span className="rev-stars" aria-label={`${rating} out of 5`}>{stars(Math.round(rating))}</span> on Google</> : "Loved by Handsworth"}</h2>
          {count ? <p className="muted">from {count} Google reviews</p> : null}
        </div>
        <div className="reviews-ctas">
          <a className="btn ghost" href={MAPS} target="_blank" rel="noreferrer">Read all on Google</a>
          {writeUrl && <a className="btn primary" href={writeUrl} target="_blank" rel="noreferrer">Write a review</a>}
        </div>
      </div>
      {reviews.length > 0 && (
        <div className={`rev-track ${loop.length > reviews.length ? "moving" : ""}`} style={{ "--n": reviews.length }}>
          <div className="rev-row">
            {loop.map((r, i) => (
              <figure key={i} className="rev-card" aria-hidden={i >= reviews.length ? "true" : undefined}>
                <div className="rev-stars small" aria-label={`${r.rating} out of 5`}>{stars(r.rating)}</div>
                <blockquote>“{r.text}”</blockquote>
                <figcaption><span className="rev-avatar" aria-hidden="true">{r.name[0]}</span><b>{r.name}</b>{r.when && <span className="muted"> · {r.when}</span>}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
