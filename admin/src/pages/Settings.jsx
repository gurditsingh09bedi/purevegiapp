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
          <h2>Delivery slots</h2>
          <Toggle checked={s.delivery_enabled} onChange={set("delivery_enabled")} label="Take delivery orders" />
          <div className="grid2">
            <Field label="Deliveries from"><input type="time" value={hhmm(s.delivery_start)} onChange={(e) => set("delivery_start")(e.target.value)} /></Field>
            <Field label="Last slot ends"><input type="time" value={hhmm(s.delivery_end)} onChange={(e) => set("delivery_end")(e.target.value)} /></Field>
            <Field label="Slot length (minutes)"><input type="number" min="5" max="120" value={s.slot_minutes} onChange={num("slot_minutes")} /></Field>
            <Field label="Drivers on shift"><input type="number" min="0" value={s.drivers_on_shift} onChange={num("drivers_on_shift")} /></Field>
            <Field label="Orders per driver per slot"><input type="number" min="1" value={s.orders_per_driver_per_slot} onChange={num("orders_per_driver_per_slot")} /></Field>
            <Field label="Earliest slot (minutes from now)"><input type="number" min="0" value={s.min_lead_minutes} onChange={num("min_lead_minutes")} /></Field>
            <Field label="Hold slot while paying (minutes)"><input type="number" min="1" value={s.slot_hold_minutes} onChange={num("slot_hold_minutes")} /></Field>
            <Field label="Book days ahead" hint="0 = today only"><input type="number" min="0" max="14" value={s.max_days_ahead} onChange={num("max_days_ahead")} /></Field>
          </div>
          <p className="muted">Each slot takes {Number(s.drivers_on_shift || 0) * Number(s.orders_per_driver_per_slot || 0)} orders. When full it shows as booked.</p>
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
