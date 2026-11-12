// Front-counter till: build the order, take the money on the card machine or in cash,
// then complete the sale. It goes straight to the kitchen screen, already paid.
// Tables that are ready to pay (from their phone: "Pay at the till") are listed too.
import { useEffect, useMemo, useState } from "react";
import { api, kitchenSocket } from "../api.js";
import { money } from "../format.js";
import { attempt, toast, useLoad } from "../ui.jsx";

const NOTES = [500, 1000, 2000, 5000];

export default function Till() {
  const menu = useLoad(() => api("/menu"));
  const [cat, setCat] = useState(null);
  const [lines, setLines] = useState([]); // {key, item, options, quantity}
  const [service, setService] = useState("takeaway");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(null); // item being customised
  const [paying, setPaying] = useState(null); // "card" | "cash"
  const tables = useLoad(() => api("/till/tables"));
  const waiting = useLoad(() => api("/till/waiting"));
  const [code, setCode] = useState("");
  const [codeOrder, setCodeOrder] = useState(null); // a table order found by its pay code
  const [codePaying, setCodePaying] = useState(null); // "card" | "cash"

  useEffect(() => {
    const t = setInterval(() => { tables.reload(); waiting.reload(); }, 10000);
    const stop = kitchenSocket(() => { tables.reload(); waiting.reload(); });
    return () => { clearInterval(t); stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = menu.data || [];
  const current = cats.find((c) => c.id === cat) || cats[0];
  const total = lines.reduce((s, l) => s + l.unit * l.quantity, 0);

  function add(item, options = []) {
    const optionIds = options.map((o) => o.id).sort((a, b) => a - b);
    const key = `${item.id}|${optionIds.join(",")}`;
    const unit = item.price_pence + options.reduce((s, o) => s + o.price_pence, 0);
    setLines((ls) => {
      const found = ls.find((l) => l.key === key);
      if (found) return ls.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { key, item, options, optionIds, unit, quantity: 1 }];
    });
  }
  const setQty = (key, q) => setLines((ls) => (q <= 0 ? ls.filter((l) => l.key !== key) : ls.map((l) => (l.key === key ? { ...l, quantity: q } : l))));

  function tap(item) {
    if (!item.is_available) return;
    if (item.option_groups.length) setPicking(item);
    else add(item);
  }

  async function complete(method, cashGiven) {
    const sale = await attempt(() => api("/till/orders", {
      method: "POST",
      body: {
        items: lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.quantity, option_ids: l.optionIds })),
        service, payment_method: method, customer_name: name.trim(), notes: note.trim(),
        cash_given_pence: method === "cash" ? cashGiven : null,
      },
    }));
    if (!sale) return;
    toast(`Sale #${sale.id} complete (${method}) and sent to the kitchen`);
    setLines([]); setName(""); setNote(""); setPaying(null);
  }

  // A guest shows their 4-digit code (a QR scanner types it in and presses Enter).
  async function findCode(e) {
    e?.preventDefault();
    const c = code.replace(/\D/g, "").slice(-4);
    if (c.length !== 4) return;
    const o = await attempt(() => api(`/till/pay-code/${c}`));
    if (o) setCodeOrder(o);
    setCode("");
  }

  async function codePaid(method) {
    const o = await attempt(() => api(`/till/pay-code/${codeOrder.pay_code}/paid`, { method: "POST", body: { payment_method: method } }),
      `Table ${codeOrder.table_number} paid by ${method}: order sent to the kitchen`);
    if (o) { setCodeOrder(null); setCodePaying(null); waiting.reload(); tables.reload(); }
  }

  async function tablePaid(t, method) {
    const ok = await attempt(() => api(`/tables/sessions/${t.table_session_id}/paid`, { method: "POST", body: { payment_method: method } }),
      method === "closed" ? `Table ${t.table_number} is free again` : `Table ${t.table_number} paid by ${method}`);
    if (ok) tables.reload();
  }

  return (
    <div className="till">
      <section className="till-menu">
        <nav className="till-cats" aria-label="Menu categories">
          {cats.map((c) => (
            <button key={c.id} className={current?.id === c.id ? "on" : ""} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </nav>
        {menu.loading && !menu.data && <p className="muted">Loading menu…</p>}
        <div className="till-grid">
          {(current?.items || []).map((i) => (
            <button key={i.id} className={`till-item ${i.is_available ? "" : "sold"}`} onClick={() => tap(i)} disabled={!i.is_available}>
              <b>{i.name}</b>
              <span>{i.is_available ? money(i.price_pence) : "Sold out"}{i.option_groups.length ? " +" : ""}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="till-side">
        <div className="card till-basket">
          <div className="seg" role="radiogroup" aria-label="Takeaway or eat in">
            {[["takeaway", "Takeaway"], ["eat_in", "Eat in"]].map(([k, label]) => (
              <button key={k} role="radio" aria-checked={service === k} className={service === k ? "on" : ""} onClick={() => setService(k)}>{label}</button>
            ))}
          </div>
          {lines.length === 0 ? <p className="muted">Tap dishes to add them.</p> : (
            <ul className="till-lines">
              {lines.map((l) => (
                <li key={l.key}>
                  <div><b>{l.item.name}</b>{l.options.length > 0 && <div className="muted small">{l.options.map((o) => o.name).join(", ")}</div>}</div>
                  <div className="qty">
                    <button onClick={() => setQty(l.key, l.quantity - 1)} aria-label="One less">−</button>
                    <span>{l.quantity}</span>
                    <button onClick={() => setQty(l.key, l.quantity + 1)} aria-label="One more">+</button>
                  </div>
                  <span className="num">{money(l.unit * l.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Customer name" />
          <input placeholder="Note for the kitchen (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the kitchen" />
          <div className="till-total"><span>Total</span><b>{money(total)}</b></div>
          <div className="till-pay">
            <button className="btn primary big" disabled={!lines.length} onClick={() => setPaying("card")}>💳 Card</button>
            <button className="btn primary big" disabled={!lines.length} onClick={() => setPaying("cash")}>💷 Cash</button>
          </div>
          {lines.length > 0 && <button className="btn ghost small" onClick={() => setLines([])}>Clear</button>}
        </div>

        <div className="card till-code">
          <h2>Table pay code</h2>
          <form className="row-form" onSubmit={findCode}>
            <input autoFocus inputMode="numeric" placeholder="4-digit code or scan QR" value={code}
              onChange={(e) => setCode(e.target.value)} aria-label="Pay code" />
            <button className="btn primary" disabled={code.replace(/\D/g, "").length < 4}>Find</button>
          </form>
          {(waiting.data || []).length > 0 && (
            <ul className="till-waiting">
              {waiting.data.map((o) => (
                <li key={o.id}>
                  <button className="chip" onClick={() => setCodeOrder(o)}>
                    <b>{o.pay_code}</b> · Table {o.table_number} · {money(o.total_pence)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card till-tables">
          <h2>Tables to pay</h2>
          {!tables.data?.length ? <p className="muted">No open tables.</p> : tables.data.map((t) => (
            <div key={t.table_session_id} className={`till-table ${t.pay_at_till ? "asked" : ""}`}>
              <div>
                <b>Table {t.table_number}</b> · {money(t.due_pence)}
                {t.pay_at_till && <div className="asked-tag">🔔 Wants to pay at the till</div>}
                {t.due_pence === 0 && <div className="muted small">All paid · eating</div>}
              </div>
              <div className="b-actions">
                {t.due_pence > 0 ? (
                  <>
                    <button className="btn ghost small" onClick={() => tablePaid(t, "card")}>Card paid</button>
                    <button className="btn ghost small" onClick={() => tablePaid(t, "cash")}>Cash paid</button>
                  </>
                ) : <button className="btn ghost small" onClick={() => tablePaid(t, "closed")}>Guests left · free table</button>}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {codeOrder && !codePaying && (
        <div className="modal-back" onClick={() => setCodeOrder(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Table {codeOrder.table_number} · code {codeOrder.pay_code}</h2>
            <ul className="till-lines">
              {codeOrder.items.map((it, i) => (
                <li key={i}><div><b>{it.quantity}× {it.name}</b>{it.options.length > 0 && <div className="muted small">{it.options.map((x) => x.name).join(", ")}</div>}</div><span /><span className="num">{money(it.unit_price_pence * it.quantity)}</span></li>
              ))}
            </ul>
            <div className="till-total"><span>To pay</span><b>{money(codeOrder.total_pence)}</b></div>
            <div className="till-pay">
              <button className="btn primary big" onClick={() => setCodePaying("card")}>💳 Card</button>
              <button className="btn primary big" onClick={() => setCodePaying("cash")}>💷 Cash</button>
            </div>
          </div>
        </div>
      )}
      {codeOrder && codePaying && <PayModal method={codePaying} total={codeOrder.total_pence} onClose={() => setCodePaying(null)} onDone={() => codePaid(codePaying)} />}
      {picking && <OptionPicker item={picking} onClose={() => setPicking(null)} onAdd={(opts) => { add(picking, opts); setPicking(null); }} />}
      {paying && <PayModal method={paying} total={total} onClose={() => setPaying(null)} onDone={(cash) => complete(paying, cash)} />}
    </div>
  );
}

function OptionPicker({ item, onClose, onAdd }) {
  const [chosen, setChosen] = useState(() => {
    const init = {};
    item.option_groups.forEach((g) => {
      const first = g.options.find((o) => o.is_available);
      init[g.id] = g.min_choices >= 1 && g.max_choices === 1 && first ? [first.id] : [];
    });
    return init;
  });
  const all = useMemo(() => item.option_groups.flatMap((g) => g.options), [item]);
  const names = new Set(Object.values(chosen).flat().map((id) => all.find((o) => o.id === id)?.name));
  const visible = item.option_groups.filter((g) => !g.shown_if || names.has(g.shown_if));
  const problems = visible.filter((g) => (chosen[g.id] || []).length < g.min_choices);

  function toggle(g, o) {
    setChosen((c) => {
      const cur = c[g.id] || [];
      if (g.max_choices === 1) return { ...c, [g.id]: cur.includes(o.id) && g.min_choices === 0 ? [] : [o.id] };
      if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
      if (cur.length >= g.max_choices) return c;
      return { ...c, [g.id]: [...cur, o.id] };
    });
  }

  const picked = visible.flatMap((g) => (chosen[g.id] || []).map((id) => g.options.find((o) => o.id === id))).filter(Boolean);
  const price = item.price_pence + picked.reduce((s, o) => s + o.price_pence, 0);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal till-picker" onClick={(e) => e.stopPropagation()}>
        <h2>{item.name}</h2>
        {visible.map((g) => (
          <fieldset key={g.id} className="till-group">
            <legend>{g.name} <span className="muted small">{g.min_choices ? `choose ${g.min_choices === g.max_choices ? g.min_choices : `${g.min_choices}–${g.max_choices}`}` : `optional, up to ${g.max_choices}`}</span></legend>
            <div className="till-opts">
              {g.options.map((o) => {
                const on = (chosen[g.id] || []).includes(o.id);
                return (
                  <button key={o.id} type="button" className={`chip ${on ? "on" : ""}`} disabled={!o.is_available} onClick={() => toggle(g, o)}>
                    {o.name}{o.price_pence ? ` +${money(o.price_pence)}` : ""}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={problems.length > 0} onClick={() => onAdd(picked)}>
            Add · {money(price)}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayModal({ method, total, onClose, onDone }) {
  const [given, setGiven] = useState("");
  const [busy, setBusy] = useState(false);
  const givenPence = Math.round(parseFloat(given || "0") * 100);
  const change = givenPence - total;
  const go = async (cash) => { setBusy(true); await onDone(cash); setBusy(false); };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal till-paymodal" onClick={(e) => e.stopPropagation()}>
        {method === "card" ? (
          <>
            <h2>💳 Card payment</h2>
            <p className="till-amount">{money(total)}</p>
            <p>Enter <b>{money(total)}</b> on the card machine and take the payment. When the machine says it's approved, complete the sale.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary big" disabled={busy} onClick={() => go(null)}>✓ Payment approved · complete sale</button>
            </div>
          </>
        ) : (
          <>
            <h2>💷 Cash payment</h2>
            <p className="till-amount">{money(total)}</p>
            <label className="field"><span className="field-label">Cash given (£)</span>
              <input type="number" step="0.01" min="0" inputMode="decimal" autoFocus value={given} onChange={(e) => setGiven(e.target.value)} /></label>
            <div className="till-opts">
              <button className="chip" onClick={() => setGiven((total / 100).toFixed(2))}>Exact</button>
              {NOTES.filter((n) => n >= total).slice(0, 3).map((n) => (
                <button key={n} className="chip" onClick={() => setGiven((n / 100).toFixed(2))}>{money(n)}</button>
              ))}
            </div>
            {given && <p className={`till-change ${change < 0 ? "short" : ""}`}>{change < 0 ? `${money(-change)} still to pay` : `Change: ${money(change)}`}</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary big" disabled={busy || !given || change < 0} onClick={() => go(givenPence)}>✓ Cash taken · complete sale</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
