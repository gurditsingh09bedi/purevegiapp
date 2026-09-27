import { useState } from "react";
import { api, SITE_URL } from "../api.js";
import { attempt, Field, Loading, PageHead, useLoad } from "../ui.jsx";

export default function Tables() {
  const state = useLoad(() => api("/admin/tables"));
  const [number, setNumber] = useState("");
  const [seats, setSeats] = useState(4);

  async function add(e) {
    e.preventDefault();
    const ok = await attempt(() => api("/admin/tables", { method: "POST", body: { number: number.trim(), seats: Number(seats) } }), `Table ${number} added`);
    if (ok) { setNumber(""); state.reload(); }
  }

  const copy = (text) =>
    navigator.clipboard?.writeText(text).then(() => attempt(async () => true, "Link copied"), () => {});

  return (
    <>
      <PageHead title="Tables" sub="Each table has its own QR link. Guests scan it to open the menu and order to that table." />
      <form className="card inline" onSubmit={add}>
        <Field label="Table number"><input required value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label="Seats"><input type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        <button className="btn primary">Add table</button>
      </form>
      <Loading state={state}>
        {(tables) => (
          <table className="table card">
            <thead><tr><th>Table</th><th>Seats</th><th>QR link</th><th /></tr></thead>
            <tbody>
              {tables.map((t) => {
                const link = SITE_URL + t.qr_url;
                return (
                  <tr key={t.id}>
                    <td><b>{t.number}</b></td>
                    <td>{t.seats}</td>
                    <td className="small mono clamp">{link}</td>
                    <td><button className="btn ghost small" onClick={() => copy(link)}>Copy link</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Loading>
      <p className="muted">Turn each link into a QR code sticker for its table. Printable QR sheets come with the customer website.</p>
    </>
  );
}
