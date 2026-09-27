import { useEffect, useState } from "react";

// --- Toasts -------------------------------------------------------------------------
let push = () => {};
export const toast = (text, kind = "ok") => push({ id: Math.random(), text, kind });

export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    push = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4000);
    };
    return () => { push = () => {}; };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

// Run an async action, show its error as a toast, return whether it worked.
export async function attempt(fn, okText) {
  try {
    const r = await fn();
    if (okText) toast(okText);
    return r ?? true;
  } catch (e) {
    toast(e.message || "Something went wrong", "err");
    return false;
  }
}

// --- Data loading -------------------------------------------------------------------
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function Loading({ state, children }) {
  if (state.error) return <p className="error">{state.error.message}</p>;
  if (state.loading && !state.data) return <p className="muted">Loading…</p>;
  return children(state.data);
}

// --- Form bits ----------------------------------------------------------------------
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
