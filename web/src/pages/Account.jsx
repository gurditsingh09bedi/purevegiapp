import { useState } from "react";
import { api, auth } from "../api.js";
import { dayAndTime, money, STATUS_LABEL, TYPE_LABEL } from "../format.js";
import { Link, useApp, useLoad } from "../state.jsx";

export default function Account() {
  const { user, setUser, logout } = useApp();
  return user ? <MyOrders user={user} logout={logout} /> : <SignIn onUser={setUser} />;
}

function SignIn({ onUser }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", marketing_opt_in: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const t = mode === "login"
        ? await api("/auth/login", { method: "POST", body: { email: f.email, password: f.password } })
        : await api("/auth/register", { method: "POST", body: { ...f, phone: f.phone || null } });
      auth.set(t.access_token);
      onUser(await api("/auth/me"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="page narrow" onSubmit={submit}>
      <h1>{mode === "login" ? "Log in" : "Create your account"}</h1>
      <p className="muted">Save your details, see past orders and reorder in one tap. You can also order as a guest.</p>
      <section className="panel">
        {mode === "register" && (
          <>
            <label className="field"><span className="field-label">Name</span><input value={f.name} onChange={set("name")} required autoComplete="name" /></label>
            <label className="field"><span className="field-label">Mobile</span><input type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></label>
          </>
        )}
        <label className="field"><span className="field-label">Email</span><input type="email" value={f.email} onChange={set("email")} required autoComplete="email" /></label>
        <label className="field"><span className="field-label">Password</span>
          <input type="password" value={f.password} onChange={set("password")} required minLength={mode === "register" ? 8 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
        {mode === "register" && (
          <label className="check"><input type="checkbox" checked={f.marketing_opt_in} onChange={set("marketing_opt_in")} /> Send me Pure Vegi offers (you can stop any time)</label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary wide big" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
        <p className="center small">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button type="button" className="linklike" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      </section>
    </form>
  );
}

function MyOrders({ user, logout }) {
  const orders = useLoad(() => api("/me/orders"));
  const bookings = useLoad(() => api("/me/bookings"));
  const upcoming = (bookings.data || []).filter((b) => ["pending", "confirmed"].includes(b.status) && new Date(b.booking_at) > new Date());
  return (
    <div className="page narrow">
      <h1>Hi {user.name.split(" ")[0]}</h1>
      <p className="muted">{user.loyalty_points} loyalty points · <button className="linklike" onClick={logout}>Log out</button></p>
      {upcoming.length > 0 && (
        <>
          <h2>Your table bookings</h2>
          <ul className="order-list">
            {upcoming.map((b) => (
              <li key={b.id}>
                <div className="booking-line">
                  <span><b>#{b.id}</b> · Table {b.table_number} for {b.guests}</span>
                  <span>{dayAndTime(b.booking_at)}</span>
                  <span className="pill">{b.status === "confirmed" ? "Confirmed" : "Waiting for confirmation"}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>Your orders</h2>
      {orders.error && <p className="error">{orders.error.message}</p>}
      {orders.data?.length === 0 && <p className="muted">No orders yet. <Link to="/">Browse the menu</Link></p>}
      <ul className="order-list">
        {(orders.data || []).map((o) => (
          <li key={o.id}>
            <Link to={`/order/${o.id}`}>
              <span><b>#{o.id}</b> · {TYPE_LABEL[o.type]} · {dayAndTime(o.created_at)}</span>
              <span className="muted">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
              <span className="order-meta"><span className="pill">{STATUS_LABEL[o.status]}</span> {money(o.total_pence)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
