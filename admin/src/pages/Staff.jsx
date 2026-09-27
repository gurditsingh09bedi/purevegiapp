import { useState } from "react";
import { api } from "../api.js";
import { attempt, Field, Loading, PageHead, useLoad } from "../ui.jsx";

const ROLES = [
  ["kitchen", "Kitchen", "Kitchen screen: accept, cook, ready"],
  ["waiter", "Waiter", "Kitchen screen and serving tables"],
  ["driver", "Driver", "Driver app only"],
  ["manager", "Manager", "Everything except the owner's account"],
];

export default function Staff({ user }) {
  const state = useLoad(() => api("/admin/staff"));
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", role: "kitchen" });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function add(e) {
    e.preventDefault();
    const ok = await attempt(() => api("/admin/staff", { method: "POST", body: { ...f, phone: f.phone || null } }), `${f.name} can now log in`);
    if (ok) { setF({ name: "", email: "", phone: "", password: "", role: "kitchen" }); state.reload(); }
  }

  async function setActive(u, active) {
    const ok = await attempt(() => api(`/admin/staff/${u.id}/active`, { method: "POST", query: { active } }),
      active ? `${u.name} switched on` : `${u.name} can no longer log in`);
    if (ok) state.reload();
  }

  return (
    <>
      <PageHead title="Staff" sub="Each person gets their own login; switch it off when they leave." />
      <form className="card" onSubmit={add}>
        <h2>Add a staff login</h2>
        <div className="grid3">
          <Field label="Name"><input required value={f.name} onChange={set("name")} /></Field>
          <Field label="Email"><input required type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Password" hint="At least 8 characters"><input required minLength="8" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
          <Field label="Role">
            <select value={f.role} onChange={set("role")}>
              {ROLES.filter(([r]) => r !== "manager" || user.role === "owner").map(([r, l]) => <option key={r} value={r}>{l}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted">{ROLES.find(([r]) => r === f.role)?.[2]}</p>
        <button className="btn primary">Add staff</button>
      </form>
      <Loading state={state}>
        {(list) => (
          <table className="table card">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Login</th></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className={u.is_active ? "" : "faded"}>
                  <td><b>{u.name}</b></td>
                  <td>{u.email}</td>
                  <td className="cap">{u.role}</td>
                  <td>
                    {u.role === "owner" ? <span className="muted">Owner</span> : (
                      <button className={`btn small ${u.is_active ? "ghost" : ""}`} onClick={() => setActive(u, !u.is_active)}>
                        {u.is_active ? "Active · switch off" : "Off · switch on"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loading>
    </>
  );
}
