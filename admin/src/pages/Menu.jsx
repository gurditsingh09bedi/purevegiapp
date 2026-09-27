import { useState } from "react";
import { api } from "../api.js";
import { ALLERGENS, money, toPence, toPounds } from "../format.js";
import { attempt, Field, Loading, PageHead, Toggle, useLoad } from "../ui.jsx";

const blankItem = (category_id) => ({
  category_id, name: "", description: "", price_pence: 0, image_url: "", model_3d_url: "",
  is_vegan: false, spice_level: 0, allergens: [], is_available: true, sort_order: 0, option_groups: [],
});

export default function Menu() {
  const state = useLoad(() => api("/admin/menu"));
  const [editing, setEditing] = useState(null);
  const [newCat, setNewCat] = useState("");

  async function addCategory(e) {
    e.preventDefault();
    const ok = await attempt(() => api("/admin/categories", { method: "POST", body: { name: newCat.trim(), sort_order: (state.data || []).length } }), "Category added");
    if (ok) { setNewCat(""); state.reload(); }
  }

  async function toggleSoldOut(item) {
    const ok = await attempt(
      () => api(`/admin/items/${item.id}/availability`, { method: "POST", query: { available: !item.is_available } }),
      item.is_available ? `${item.name} marked sold out everywhere` : `${item.name} back on sale`,
    );
    if (ok) state.reload();
  }

  async function toggleCategory(c) {
    const ok = await attempt(() => api(`/admin/categories/${c.id}`, { method: "PUT", body: { name: c.name, sort_order: c.sort_order, is_active: !c.is_active } }));
    if (ok) state.reload();
  }

  return (
    <>
      <PageHead title="Menu" sub="Prices in pounds. Sold out hides a dish from ordering on every channel at once.">
        <form className="inline" onSubmit={addCategory}>
          <input placeholder="New category, e.g. Burgers" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="New category name" />
          <button className="btn" disabled={!newCat.trim()}>Add category</button>
        </form>
      </PageHead>

      <Loading state={state}>
        {(cats) =>
          cats.length === 0 ? (
            <p className="muted">No categories yet. Add one above, then add dishes to it.</p>
          ) : (
            cats.map((c) => (
              <section key={c.id} className={`card ${c.is_active ? "" : "faded"}`}>
                <div className="card-head">
                  <h2>{c.name}{!c.is_active && <span className="badge off">Hidden</span>}</h2>
                  <div className="page-actions">
                    <button className="btn ghost small" onClick={() => toggleCategory(c)}>{c.is_active ? "Hide category" : "Show category"}</button>
                    <button className="btn small" onClick={() => setEditing(blankItem(c.id))}>Add dish</button>
                  </div>
                </div>
                {c.items.length === 0 ? (
                  <p className="muted">No dishes yet.</p>
                ) : (
                  <table className="table">
                    <thead><tr><th>Dish</th><th>Price</th><th>Tags</th><th>Allergens</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {c.items.map((it) => (
                        <tr key={it.id} className={it.is_available ? "" : "faded"}>
                          <td><b>{it.name}</b><div className="muted clamp">{it.description}</div></td>
                          <td>{money(it.price_pence)}</td>
                          <td>{it.is_vegan && <span className="badge vegan">Vegan</span>}{it.spice_level > 0 && <span className="badge">{"Spice " + it.spice_level}</span>}</td>
                          <td className="small">{it.allergens.join(", ") || "None listed"}</td>
                          <td>
                            <button className={`btn small ${it.is_available ? "ghost" : "danger"}`} onClick={() => toggleSoldOut(it)}>
                              {it.is_available ? "On sale · mark sold out" : "Sold out · put back"}
                            </button>
                          </td>
                          <td><button className="btn ghost small" onClick={() => setEditing(it)}>Edit</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))
          )
        }
      </Loading>

      {editing && <ItemEditor item={editing} cats={state.data || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload(); }} />}
    </>
  );
}

function ItemEditor({ item, cats, onClose, onSaved }) {
  const [f, setF] = useState({ ...item, image_url: item.image_url || "", model_3d_url: item.model_3d_url || "" });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const toggleAllergen = (a) => setF((x) => ({ ...x, allergens: x.allergens.includes(a) ? x.allergens.filter((y) => y !== a) : [...x.allergens, a] }));

  async function save(e) {
    e.preventDefault();
    const body = {
      category_id: Number(f.category_id), name: f.name.trim(), description: f.description, price_pence: f.price_pence,
      image_url: f.image_url || null, model_3d_url: f.model_3d_url || null, is_vegan: f.is_vegan,
      spice_level: Number(f.spice_level), allergens: f.allergens, is_available: f.is_available,
      sort_order: Number(f.sort_order) || 0,
      option_groups: f.option_groups, // kept as they are; option editing comes next
    };
    const ok = await attempt(
      () => (f.id ? api(`/admin/items/${f.id}`, { method: "PUT", body }) : api("/admin/items", { method: "POST", body })),
      f.id ? "Dish updated" : "Dish added",
    );
    if (ok) onSaved();
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{f.id ? `Edit ${item.name}` : "New dish"}</h2>
        <div className="grid2">
          <Field label="Name"><input required value={f.name} onChange={(e) => set("name")(e.target.value)} /></Field>
          <Field label="Price (£)"><input required type="number" step="0.01" min="0" defaultValue={f.id ? toPounds(f.price_pence) : ""} onChange={(e) => set("price_pence")(toPence(e.target.value))} /></Field>
          <Field label="Category">
            <select value={f.category_id} onChange={(e) => set("category_id")(e.target.value)}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Spice level">
            <select value={f.spice_level} onChange={(e) => set("spice_level")(e.target.value)}>
              <option value="0">None</option><option value="1">Mild</option><option value="2">Medium</option><option value="3">Hot</option>
            </select>
          </Field>
        </div>
        <Field label="Description"><textarea rows="2" value={f.description} onChange={(e) => set("description")(e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Photo link"><input type="url" value={f.image_url} onChange={(e) => set("image_url")(e.target.value)} /></Field>
          <Field label="3D model link (.glb)" hint="Optional, for the 3D dish viewer"><input type="url" value={f.model_3d_url} onChange={(e) => set("model_3d_url")(e.target.value)} /></Field>
        </div>
        <Toggle checked={f.is_vegan} onChange={set("is_vegan")} label="Vegan" />
        <Toggle checked={f.is_available} onChange={set("is_available")} label="On sale" />
        <fieldset className="allergens">
          <legend>Allergens (UK 14)</legend>
          {ALLERGENS.map((a) => (
            <label key={a} className="chip-check">
              <input type="checkbox" checked={f.allergens.includes(a)} onChange={() => toggleAllergen(a)} /> {a}
            </label>
          ))}
        </fieldset>
        {f.option_groups.length > 0 && (
          <p className="muted">Options: {f.option_groups.map((g) => `${g.name} (${g.options.length})`).join(", ")}</p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">{f.id ? "Save dish" : "Add dish"}</button>
        </div>
      </form>
    </div>
  );
}
