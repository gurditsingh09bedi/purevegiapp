import { Fragment, useState } from "react";
import { api } from "../api.js";
import { clock, dayAndTime, money, STATUS_LABEL, TYPE_LABEL } from "../format.js";
import { Loading, PageHead, useLoad } from "../ui.jsx";

const FILTERS = ["", "pending_payment", "placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "collected", "served", "rejected", "cancelled"];

export default function Orders() {
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(null);
  const state = useLoad(() => api("/admin/orders", { query: { status: status || undefined, limit: 200 } }), [status]);
  const takings = useLoad(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    return api("/admin/reports/payments", { query: { start: start.toISOString(), end: end.toISOString() } });
  });
  const by = Object.fromEntries((takings.data || []).map((r) => [r.method, r]));

  return (
    <>
      <PageHead title="Orders" sub="Newest first. Tap an order for its items and timeline.">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          {FILTERS.map((f) => <option key={f} value={f}>{f ? STATUS_LABEL[f] : "All orders"}</option>)}
        </select>
        <button className="btn ghost" onClick={state.reload}>Refresh</button>
      </PageHead>
      {takings.data && (
        <section className="cards takings" aria-label="Today's takings">
          {[["card", "💳 Card (till)"], ["cash", "💷 Cash (till)"], ["online", "🌐 Online"]].map(([k, label]) => (
            <div key={k} className="card stat"><span className="muted">{label}</span><b>{money(by[k]?.total_pence || 0)}</b><span className="muted small">{by[k]?.orders || 0} sales today</span></div>
          ))}
        </section>
      )}
      <Loading state={state}>
        {(orders) =>
          orders.length === 0 ? <p className="muted">No orders yet.</p> : (
            <table className="table card">
              <thead><tr><th>#</th><th>Placed</th><th>Type</th><th>Customer</th><th>When</th><th>Status</th><th>Paid</th><th className="num">Total</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <Fragment key={o.id}>
                    <tr className="click" onClick={() => setOpen(open === o.id ? null : o.id)}>
                      <td>{o.id}</td>
                      <td>{dayAndTime(o.created_at)}</td>
                      <td>{o.channel === "till" ? `Till · ${o.service === "eat_in" ? "eat in" : "takeaway"}` : TYPE_LABEL[o.type]}</td>
                      <td>{o.customer_name || (o.table_number ? `Table ${o.table_number}` : "Guest")}</td>
                      <td>{o.slot_start ? `${clock(o.slot_start)}–${clock(o.slot_end)}` : clock(o.arrive_by || o.ready_at)}</td>
                      <td><span className={`badge s-${o.status}`}>{STATUS_LABEL[o.status]}</span></td>
                      <td>{o.paid_at ? (o.payment_method || "online") : "—"}</td>
                      <td className="num">{money(o.total_pence)}</td>
                    </tr>
                    {open === o.id && (
                      <tr className="detail">
                        <td colSpan="8">
                          <div className="grid2">
                            <div>
                              <h3>Items</h3>
                              <ul>{o.items.map((it, i) => <li key={i}>{it.quantity}× {it.name} — {money(it.unit_price_pence * it.quantity)}</li>)}</ul>
                              <p className="muted">
                                Subtotal {money(o.subtotal_pence)} · Delivery {money(o.delivery_fee_pence)} · Discount −{money(o.discount_pence)} · Tip {money(o.tip_pence)}
                              </p>
                              {o.address && <p>Deliver to: {o.address.line1}, {o.address.postcode}{o.address.notes ? ` (${o.address.notes})` : ""}</p>}
                            </div>
                            <div>
                              <h3>Timeline</h3>
                              <ol>{o.events.map((ev, i) => <li key={i}>{clock(ev.at)} · {STATUS_LABEL[ev.status]}{ev.note ? ` (${ev.note})` : ""}</li>)}</ol>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )
        }
      </Loading>
    </>
  );
}
