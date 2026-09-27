import { useState } from "react";
import { api } from "../api.js";
import { dayAndTime, money, toPence } from "../format.js";
import { attempt, Field, Loading, PageHead, Toggle, useLoad } from "../ui.jsx";

const KIND_LABEL = { percent: "% off", amount: "£ off", free_delivery: "Free delivery" };
const blank = { name: "", code: "", kind: "percent", value: 10, min_spend_pence: 0, starts_at: "", ends_at: "", max_uses: "", is_active: true };

function describe(p) {
  if (p.kind === "percent") return `${p.value}% off`;
  if (p.kind === "amount") return `${money(p.value)} off`;
  return "Free delivery";
}

export default function Offers() {
  const state = useLoad(() => api("/admin/promotions"));
  const [f, setF] = useState(blank);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  async function create(e) {
    e.preventDefault();
    const body = {
      name: f.name.trim(),
      code: f.code.trim() || null,
      kind: f.kind,
      value: f.kind === "amount" ? toPence(f.value) : f.kind === "percent" ? Number(f.value) : 0,
      min_spend_pence: f.min_spend_pence,
      starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
      ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
      max_uses: f.max_uses ? Number(f.max_uses) : null,
      is_active: true,
    };
    const ok = await attempt(() => api("/admin/promotions", { method: "POST", body }), "Offer created");
    if (ok) { setF(blank); state.reload(); }
  }

  async function toggle(p) {
    const ok = await attempt(() => api(`/admin/promotions/${p.id}`, { method: "PUT", body: { ...p, is_active: !p.is_active } }),
      p.is_active ? "Offer switched off" : "Offer switched on");
    if (ok) state.reload();
  }

  return (
    <>
      <PageHead title="Offers" sub="With a code, customers type it at checkout. Without a code, the offer applies automatically." />
      <form className="card" onSubmit={create}>
        <h2>New offer</h2>
        <div className="grid3">
          <Field label="Name"><input required placeholder="First order 10% off" value={f.name} onChange={(e) => set("name")(e.target.value)} /></Field>
          <Field label="Code" hint="Leave empty for automatic"><input placeholder="WELCOME10" value={f.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} /></Field>
          <Field label="Type">
            <select value={f.kind} onChange={(e) => set("kind")(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {f.kind !== "free_delivery" && (
            <Field label={f.kind === "percent" ? "Percent off" : "Amount off (£)"}>
              <input type="number" min="0" step={f.kind === "amount" ? "0.01" : "1"} value={f.value} onChange={(e) => set("value")(e.target.value)} />
            </Field>
          )}
          <Field label="Minimum spend (£)"><input type="number" min="0" step="0.01" defaultValue="0" onChange={(e) => set("min_spend_pence")(toPence(e.target.value))} /></Field>
          <Field label="Max uses" hint="Empty = unlimited"><input type="number" min="1" value={f.max_uses} onChange={(e) => set("max_uses")(e.target.value)} /></Field>
          <Field label="Starts"><input type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at")(e.target.value)} /></Field>
          <Field label="Ends"><input type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at")(e.target.value)} /></Field>
        </div>
        <button className="btn primary">Create offer</button>
      </form>

      <Loading state={state}>
        {(list) =>
          list.length === 0 ? <p className="muted">No offers yet.</p> : (
            <table className="table card">
              <thead><tr><th>Offer</th><th>Code</th><th>Deal</th><th>Min spend</th><th>Runs</th><th>Used</th><th /></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className={p.is_active ? "" : "faded"}>
                    <td><b>{p.name}</b></td>
                    <td>{p.code || <span className="muted">Automatic</span>}</td>
                    <td>{describe(p)}</td>
                    <td>{p.min_spend_pence ? money(p.min_spend_pence) : "None"}</td>
                    <td className="small">{p.starts_at ? dayAndTime(p.starts_at) : "Now"} → {p.ends_at ? dayAndTime(p.ends_at) : "no end"}</td>
                    <td>{p.max_uses ? `${p.uses ?? 0} / ${p.max_uses}` : (p.uses ?? "")}</td>
                    <td><Toggle checked={p.is_active} onChange={() => toggle(p)} label={p.is_active ? "On" : "Off"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loading>
    </>
  );
}
