// Tables: add, rename, change seats or remove a table; see which tables are eating right now and
// take payment when they're done (card or cash at the till). Each table has its own QR code.
import { useEffect, useState } from "react";
import { api, kitchenSocket, SITE_URL } from "../api.js";
import { money } from "../format.js";
import { attempt, Field, Loading, PageHead, useLoad } from "../ui.jsx";

// Where guests' phones open the menu. In a test setup (Codespaces / this computer) that's the
// customer website next to this staff app; when live it's the real website address.
export function customerSite() {
  const { protocol, host } = window.location;
  if (/-3000\.app\.github\.dev$/.test(host)) return `${protocol}//${host.replace(/-3000\./, "-5173.")}`;
  if (/^(localhost|127\.0\.0\.1):3000$/.test(host)) return `${protocol}//${host.replace(":3000", ":5173")}`;
  return SITE_URL;
}

const qrImage = (link, size = 220) => `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(link)}`;

export default function Tables() {
  const state = useLoad(() => api("/admin/tables"));
  const tabs = useLoad(() => api("/till/tables"));
  const [number, setNumber] = useState("");
  const [seats, setSeats] = useState(4);
  const [editing, setEditing] = useState(null); // {id, number, seats}
  const [showQr, setShowQr] = useState(null);
  const site = customerSite();

  useEffect(() => {
    const t = setInterval(tabs.reload, 15000);
    const stop = kitchenSocket(() => tabs.reload());
    return () => { clearInterval(t); stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e) {
    e.preventDefault();
    const ok = await attempt(() => api("/admin/tables", { method: "POST", body: { number: number.trim(), seats: Number(seats) } }), `Table ${number} added`);
    if (ok) { setNumber(""); state.reload(); }
  }

  async function save(e) {
    e.preventDefault();
    const ok = await attempt(() => api(`/admin/tables/${editing.id}`, { method: "PUT", body: { number: editing.number.trim(), seats: Number(editing.seats) } }), "Table saved");
    if (ok) { setEditing(null); state.reload(); tabs.reload(); }
  }

  async function remove(t) {
    if (!window.confirm(`Remove table ${t.number}? Its QR code will stop working.`)) return;
    const ok = await attempt(() => api(`/admin/tables/${t.id}`, { method: "DELETE" }), `Table ${t.number} removed`);
    if (ok) state.reload();
  }

  async function paid(tab, method) {
    const ok = await attempt(() => api(`/tables/sessions/${tab.table_session_id}/paid`, { method: "POST", body: { payment_method: method } }),
      method === "closed" ? `Table ${tab.table_number} is free again` : `Table ${tab.table_number} paid by ${method}, table is free again`);
    if (ok) tabs.reload();
  }

  const copy = (text) => navigator.clipboard?.writeText(text).then(() => attempt(async () => true, "Link copied"), () => {});
  const tabFor = (t) => (tabs.data || []).find((x) => x.table_number === t.number);

  return (
    <>
      <PageHead title="Tables" sub="Guests scan the QR code on their table, order from their phone and pay online or at the till." />
      <form className="card inline" onSubmit={add}>
        <Field label="New table number or name"><input required value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 11 or Window" /></Field>
        <Field label="Seats"><input type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        <button className="btn primary">Add table</button>
      </form>
      <Loading state={state}>
        {(tables) => (
          <table className="table card tables-list">
            <thead><tr><th>Table</th><th>Seats</th><th>Right now</th><th>QR code</th><th /></tr></thead>
            <tbody>
              {tables.map((t) => {
                const link = site + t.qr_url;
                const tab = tabFor(t);
                return editing?.id === t.id ? (
                  <tr key={t.id}>
                    <td colSpan="5">
                      <form className="inline" onSubmit={save}>
                        <Field label="Number or name"><input required value={editing.number} onChange={(e) => setEditing({ ...editing, number: e.target.value })} /></Field>
                        <Field label="Seats"><input type="number" min="1" value={editing.seats} onChange={(e) => setEditing({ ...editing, seats: e.target.value })} /></Field>
                        <button className="btn primary">Save</button>
                        <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id} className={tab ? "busy-row" : ""}>
                    <td><b className="table-no">{t.number}</b></td>
                    <td>{t.seats}</td>
                    <td>
                      {tab ? (
                        <div className="tab-now">
                          <span className={`badge ${tab.pay_at_till ? "warn" : "ok"}`}>{tab.pay_at_till ? "🔔 Wants to pay" : "Eating"}</span>
                          <span>{tab.orders} order{tab.orders > 1 ? "s" : ""} · {tab.due_pence > 0 ? <b>{money(tab.due_pence)} to pay</b> : <>{money(tab.total_pence)} paid</>}</span>
                          <span className="b-actions">
                            {tab.due_pence > 0 ? (
                              <>
                                <button className="btn ghost small" onClick={() => paid(tab, "card")}>Card paid</button>
                                <button className="btn ghost small" onClick={() => paid(tab, "cash")}>Cash paid</button>
                              </>
                            ) : <button className="btn ghost small" onClick={() => paid(tab, "closed")}>Guests left · free table</button>}
                          </span>
                        </div>
                      ) : <span className="muted">Free</span>}
                    </td>
                    <td className="b-actions">
                      <button className="btn ghost small" onClick={() => setShowQr({ t, link })}>Show QR</button>
                      <a className="btn ghost small" href={link} target="_blank" rel="noreferrer">Test</a>
                      <button className="btn ghost small" onClick={() => copy(link)}>Copy link</button>
                    </td>
                    <td className="b-actions">
                      <button className="btn ghost small" onClick={() => setEditing({ id: t.id, number: t.number, seats: t.seats })}>Edit</button>
                      <button className="btn ghost small danger-text" onClick={() => remove(t)} disabled={!!tab}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Loading>
      <p className="muted small">QR codes open {site}. {site === SITE_URL ? "" : "That's the test website: print the QR codes once the website is live, so they open purevegi.co.uk."}</p>

      {showQr && (
        <div className="modal-back" onClick={() => setShowQr(null)}>
          <div className="modal qr-card" onClick={(e) => e.stopPropagation()}>
            <h2>Table {showQr.t.number}</h2>
            <img src={qrImage(showQr.link, 320)} alt={`QR code for table ${showQr.t.number}`} width="320" height="320" />
            <p className="muted small">Scan to see the menu and order to table {showQr.t.number}</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowQr(null)}>Close</button>
              <button className="btn primary" onClick={() => window.print()}>Print</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
