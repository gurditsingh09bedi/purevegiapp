import { useEffect, useState } from "react";
import { api } from "../api.js";
import { toPence, toPounds } from "../format.js";
import { attempt, Field, Loading, PageHead, Toggle, useLoad } from "../ui.jsx";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const hhmm = (t) => (t || "").slice(0, 5);

export default function Settings() {
  const state = useLoad(() => api("/admin/settings"));
  return (
    <>
      <Loading state={state}>{(s) => <SettingsForm initial={s} onSaved={state.reload} />}</Loading>
      <NotifySetup />
    </>
  );
}

// Which customer message channels are switched on (they're set in the server's .env), and a test.
function NotifySetup() {
  const st = useLoad(() => api("/admin/notify-status"));
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState(null);
  const c = st.data;
  const row = (on, name, how) => (
    <li className={on ? "ch-on" : "ch-off"}><b>{on ? "✓" : "○"} {name}</b><span className="muted"> {how}</span></li>
  );

  async function test(e) {
    e.preventDefault();
    const r = await attempt(() => api("/admin/notify-test", { method: "POST", body: { email: email || null, phone: phone || null } }));
    if (r) setResult(r);
  }

  return (
    <section className="card notify-setup">
      <h2>Customer messages</h2>
      {c && (
        <ul className="channels">
          {row(c.app_push, "Phone app notifications", "free, always on for customers using the Pure Vegi app")}
          {row(c.web_push, "Browser notifications", c.web_push ? "free, customers tap “Turn on notifications” on the website" : "needs PV_VAPID keys (Codespaces makes them; or run python -m app.vapid)")}
          {row(c.email, "Email", c.email ? "sent from your mailbox" : "add PV_SMTP_HOST, PV_SMTP_USER, PV_SMTP_PASSWORD (Gmail app password works)")}
          {row(!!c.sms, "SMS", c.sms === "android" ? "sent from the restaurant's Android phone (SMS Gate)" : c.sms === "twilio" ? "sent through Twilio" : "install SMS Gate on the restaurant's Android phone, then set PV_SMS_PROVIDER=android, PV_SMSGATE_USER, PV_SMSGATE_PASSWORD")}
          {row(true, "WhatsApp", "free: the green WhatsApp buttons on Bookings open a chat with the message ready")}
        </ul>
      )}
      <form className="row-form" onSubmit={test}>
        <Field label="Test email to"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
        <Field label="Test text to"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07…" /></Field>
        <button className="btn" disabled={!email && !phone}>Send test</button>
      </form>
      {result && (
        <p className="muted">
          {"email" in result && <>Email: {result.email ? "sent ✓" : "not sent (not set up, or the login was refused)"}. </>}
          {"sms" in result && <>Text: {result.sms ? "sent ✓" : "not sent (not set up, or the phone is offline)"}.</>}
        </p>
      )}
    </section>
  );
}

function SettingsForm({ initial, onSaved }) {
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setS(initial), [initial]);

  const set = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const num = (k) => (e) => set(k)(e.target.value === "" ? "" : Number(e.target.value));
  const money = (k) => (e) => set(k)(toPence(e.target.value));
  const setDay = (day, k, v) => setS((x) => ({ ...x, opening_hours: { ...x.opening_hours, [day]: { ...x.opening_hours[day], [k]: v } } }));

  const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k])));
  const dirty = Object.keys(changed).length > 0;

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const ok = await attempt(() => api("/admin/settings", { method: "PATCH", body: changed }), "Settings saved");
    setSaving(false);
    if (ok) onSaved();
  }

  return (
    <form onSubmit={save}>
      <PageHead title="Settings" sub="Every change here applies straight away on the website, app and kitchen screen.">
        <button className="btn ghost" type="button" disabled={!dirty} onClick={() => setS(initial)}>Undo changes</button>
        <button className="btn primary" disabled={!dirty || saving}>{saving ? "Saving…" : "Save settings"}</button>
      </PageHead>

      <div className="cards">
        <section className="card">
          <h2>Delivery</h2>
          <Toggle checked={s.delivery_enabled} onChange={set("delivery_enabled")} label="Take delivery orders" />
          <table className="table">
            <thead><tr><th>Delivery</th><th>From</th><th>Last orders</th><th>No delivery</th></tr></thead>
            <tbody>
              {DAYS.map((d) => {
                const h = (s.delivery_hours || {})[d] || { opens: "18:00", closes: "22:00", closed: false };
                const setD = (k, v) => setS((x) => ({ ...x, delivery_hours: { ...x.delivery_hours, [d]: { ...h, [k]: v } } }));
                return (
                  <tr key={d}>
                    <td className="cap">{d}</td>
                    <td><input type="time" value={hhmm(h.opens)} disabled={h.closed} onChange={(e) => setD("opens", e.target.value)} aria-label={`${d} delivery from`} /></td>
                    <td><input type="time" value={hhmm(h.closes)} disabled={h.closed} onChange={(e) => setD("closes", e.target.value)} aria-label={`${d} last delivery orders`} /></td>
                    <td><input type="checkbox" checked={h.closed} onChange={(e) => setD("closed", e.target.checked)} aria-label={`${d} no delivery`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid2">
            <Field label="Delivered within (minutes)" hint="What customers are told, e.g. 45"><input type="number" min="10" max="180" value={s.delivery_minutes} onChange={num("delivery_minutes")} /></Field>
            <Field label="Busy-night extra now (minutes)" hint="The kitchen screen's +5 / +10 buttons change this"><input type="number" min="0" max="180" value={s.busy_extra_minutes} onChange={num("busy_extra_minutes")} /></Field>
            <Field label="'Busy' buttons on the kitchen screen" hint="Comma separated, e.g. 5, 10, 15, 20, 30">
              <input value={(s.delay_choices || []).join(", ")} onChange={(e) => set("delay_choices")(e.target.value.split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0))} />
            </Field>
          </div>
          <p className="muted">Orders are delivered as soon as possible: no time slots. Customers are told about {Number(s.delivery_minutes || 0) + Number(s.busy_extra_minutes || 0)} minutes.</p>
        </section>

        <section className="card">
          <h2>Delivery area and fees</h2>
          <div className="grid2">
            <Field label="Free delivery within (miles)"><input type="number" step="0.1" min="0" value={s.free_radius_miles} onChange={num("free_radius_miles")} /></Field>
            <Field label="Fee beyond that (£)"><input type="number" step="0.01" min="0" defaultValue={toPounds(s.fee_beyond_free_pence)} key={`fee${initial.fee_beyond_free_pence}`} onChange={money("fee_beyond_free_pence")} /></Field>
            <Field label="Deliver up to (miles)"><input type="number" step="0.1" min="0.1" value={s.max_radius_miles} onChange={num("max_radius_miles")} /></Field>
            <Field label="Minimum order (£)"><input type="number" step="0.01" min="0" defaultValue={toPounds(s.min_order_pence)} key={`min${initial.min_order_pence}`} onChange={money("min_order_pence")} /></Field>
          </div>
          <Toggle checked={s.collection_enabled} onChange={set("collection_enabled")} label="Take collection orders" />
        </section>

        <section className="card">
          <h2>Kitchen</h2>
          <Toggle checked={s.auto_accept} onChange={set("auto_accept")} label="Auto-accept paid orders (otherwise staff accept each one)" />
          <Toggle checked={s.online_orders_paused} onChange={set("online_orders_paused")} label="Online orders paused" />
          <div className="grid2">
            <Field label="Default prep time (minutes)"><input type="number" min="1" value={s.default_prep_minutes} onChange={num("default_prep_minutes")} /></Field>
            <Field label="Prep time buttons" hint="Comma separated, e.g. 10, 15, 20, 30">
              <input value={(s.prep_minute_choices || []).join(", ")} onChange={(e) => set("prep_minute_choices")(e.target.value.split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0))} />
            </Field>
            <Field label="Ticket turns amber after (min)"><input type="number" min="1" value={s.ticket_amber_minutes} onChange={num("ticket_amber_minutes")} /></Field>
            <Field label="Ticket turns red after (min)"><input type="number" min="1" value={s.ticket_red_minutes} onChange={num("ticket_red_minutes")} /></Field>
          </div>
          <h3>Busy meter on the website</h3>
          <div className="grid2">
            <Field label="“Busy” from (orders on the go)"><input type="number" min="1" value={s.busy_orders} onChange={num("busy_orders")} /></Field>
            <Field label="“Very busy” from (orders)"><input type="number" min="2" value={s.very_busy_orders} onChange={num("very_busy_orders")} /></Field>
            <Field label="Extra minutes per order" hint="Added to the prep time for each order beyond two"><input type="number" min="0" value={s.minutes_per_extra_order} onChange={num("minutes_per_extra_order")} /></Field>
          </div>
        </section>

        <section className="card">
          <h2>Table bookings</h2>
          <Toggle checked={s.bookings_enabled} onChange={set("bookings_enabled")} label="Take table bookings online" />
          <Toggle checked={s.booking_auto_confirm} onChange={set("booking_auto_confirm")} label="Confirm online bookings automatically (otherwise staff accept or decline each request)" />
          <div className="grid2">
            <Field label="Booking deposit (£)"><input type="number" step="0.01" min="0" defaultValue={toPounds(s.booking_deposit_pence)} key={`dep${initial.booking_deposit_pence}`} onChange={money("booking_deposit_pence")} /></Field>
            <Field label="Full refund if cancelled (hours before)"><input type="number" min="0" value={s.booking_refund_hours} onChange={num("booking_refund_hours")} /></Field>
            <Field label="Booking times every (minutes)"><input type="number" min="15" value={s.booking_slot_minutes} onChange={num("booking_slot_minutes")} /></Field>
            <Field label="Largest group online"><input type="number" min="1" value={s.booking_max_guests} onChange={num("booking_max_guests")} /></Field>
          </div>
          <Toggle checked={s.booking_deposit_per_guest} onChange={set("booking_deposit_per_guest")} label="Deposit is per guest (otherwise per booking)" />
        </section>

        <section className="card">
          <h2>Google reviews</h2>
          <Field label="Google review link" hint='From Google Business Profile: "Ask for reviews". Leave empty to switch the pop-up off.'>
            <input type="url" placeholder="https://g.page/r/…/review" value={s.google_review_url || ""} onChange={(e) => set("google_review_url")(e.target.value || null)} />
          </Field>
          <Field label="Show the review pop-up after (minutes)"><input type="number" min="0" value={s.review_prompt_delay_minutes} onChange={num("review_prompt_delay_minutes")} /></Field>
          <p className="muted">Sent to every customer with no reward attached, as Google's rules require.</p>
          <h3>Reviews on the home page</h3>
          <div className="grid2">
            <Field label="Google star rating" hint="As shown on Google, e.g. 4.8"><input type="number" step="0.1" min="1" max="5" value={s.google_rating ?? ""} onChange={(e) => set("google_rating")(e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Number of Google reviews"><input type="number" min="0" value={s.google_review_count ?? ""} onChange={(e) => set("google_review_count")(e.target.value === "" ? null : Number(e.target.value))} /></Field>
          </div>
          <ReviewsEditor list={s.reviews || []} onChange={set("reviews")} />
        </section>

        <section className="card">
          <h2>Opening hours</h2>
          <table className="table">
            <thead><tr><th>Day</th><th>Opens</th><th>Closes</th><th>Closed</th></tr></thead>
            <tbody>
              {DAYS.map((d) => {
                const h = s.opening_hours[d];
                return (
                  <tr key={d}>
                    <td className="cap">{d}</td>
                    <td><input type="time" value={hhmm(h.opens)} disabled={h.closed} onChange={(e) => setDay(d, "opens", e.target.value)} aria-label={`${d} opens`} /></td>
                    <td><input type="time" value={hhmm(h.closes)} disabled={h.closed} onChange={(e) => setDay(d, "closes", e.target.value)} aria-label={`${d} closes`} /></td>
                    <td><input type="checkbox" checked={h.closed} onChange={(e) => setDay(d, "closed", e.target.checked)} aria-label={`${d} closed`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </form>
  );
}

// Real reviews copied from Google (name, stars, words). Up to 12, shown as a moving strip.
function ReviewsEditor({ list, onChange }) {
  const upd = (i, k, v) => onChange(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="reviews-editor">
      {list.length === 0 && <p className="muted">No reviews yet. Copy your favourite real reviews from Google here, word for word.</p>}
      {list.map((r, i) => (
        <div key={i} className="review-row">
          <div className="grid2">
            <Field label="Name"><input value={r.name} maxLength="60" onChange={(e) => upd(i, "name", e.target.value)} /></Field>
            <Field label="Stars">
              <select value={r.rating} onChange={(e) => upd(i, "rating", Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Review"><textarea rows="2" maxLength="400" value={r.text} onChange={(e) => upd(i, "text", e.target.value)} /></Field>
          <div className="row-form">
            <Field label="When (optional)"><input value={r.when || ""} maxLength="40" placeholder="2 weeks ago" onChange={(e) => upd(i, "when", e.target.value)} /></Field>
            <button type="button" className="btn ghost small" onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      {list.length < 12 && <button type="button" className="btn small" onClick={() => onChange([...list, { name: "", rating: 5, text: "", when: "" }])}>+ Add a review</button>}
    </div>
  );
}
