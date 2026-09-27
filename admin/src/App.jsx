import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import { ToastHost } from "./ui.jsx";
import Login from "./pages/Login.jsx";
import Kitchen from "./pages/Kitchen.jsx";
import Orders from "./pages/Orders.jsx";
import Menu from "./pages/Menu.jsx";
import Settings from "./pages/Settings.jsx";
import Offers from "./pages/Offers.jsx";
import Tables from "./pages/Tables.jsx";
import Staff from "./pages/Staff.jsx";

const ADMIN = ["owner", "manager"];
const PAGES = [
  { id: "kitchen", label: "Kitchen", roles: ["owner", "manager", "kitchen", "waiter"], el: Kitchen },
  { id: "orders", label: "Orders", roles: ADMIN, el: Orders },
  { id: "menu", label: "Menu", roles: ADMIN, el: Menu },
  { id: "offers", label: "Offers", roles: ADMIN, el: Offers },
  { id: "tables", label: "Tables", roles: ADMIN, el: Tables },
  { id: "staff", label: "Staff", roles: ADMIN, el: Staff },
  { id: "settings", label: "Settings", roles: ADMIN, el: Settings },
];

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(2));
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(2));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const hash = useHash();

  useEffect(() => {
    if (!getToken()) return;
    api("/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  if (user.role === "customer" || user.role === "driver") {
    return (
      <div className="center">
        <p>{user.role === "driver" ? "Drivers use the Pure Vegi app on their phone." : "This screen is for Pure Vegi staff."}</p>
        <button className="btn" onClick={() => { setToken(null); setUser(null); }}>Log out</button>
      </div>
    );
  }

  const allowed = PAGES.filter((p) => p.roles.includes(user.role));
  const page = allowed.find((p) => p.id === hash) || allowed[0];
  const Page = page.el;

  return (
    <div className={`shell ${page.id === "kitchen" ? "shell-kitchen" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#/kitchen">
          <span className="brand-mark" aria-hidden="true">PV</span>
          <span>Pure Vegi</span>
        </a>
        <nav className="nav">
          {allowed.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={p.id === page.id ? "active" : ""}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="who">
          <span className="muted">{user.name} · {user.role}</span>
          <button className="btn ghost small" onClick={() => { setToken(null); setUser(null); }}>
            Log out
          </button>
        </div>
      </header>
      <main className="content">
        <Page user={user} />
      </main>
      <ToastHost />
    </div>
  );
}
