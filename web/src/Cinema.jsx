// Scroll-driven "3D movie" for the home page. A tall section pins a stage to the screen;
// scrolling moves a camera through four scenes laid out in depth. Each scene holds still
// while its own animation plays (burger builds, wok tosses, scooter rides, phone orders),
// then the camera flies on to the next. Layers sit at different depths, so they parallax.
// Plain CSS 3D and SVG: no 3D library, light enough for phones.
import { useEffect, useRef, useState } from "react";
import { Link } from "./state.jsx";

const SCENES = 4;
const HOLD = 0.62; // share of each scene's time spent holding still (its animation plays)
const TRAVEL = 0.38; // camera flight to the next scene
const TOTAL = SCENES * HOLD + (SCENES - 1) * TRAVEL;
const DEPTH = 1500; // px between scenes along the camera path

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// Camera position (0..3) and each scene's own progress (0..1) for scroll progress p.
function timeline(p) {
  const u = p * TOTAL;
  let cam = 0;
  const local = [];
  for (let i = 0; i < SCENES; i++) {
    const start = i * (HOLD + TRAVEL);
    local.push(clamp((u - start) / HOLD));
    if (u >= start + HOLD && i < SCENES - 1) cam = i + clamp((u - start - HOLD) / TRAVEL);
    if (u >= start && u < start + HOLD) cam = i;
  }
  if (u >= TOTAL - HOLD) cam = SCENES - 1;
  return { cam, local };
}

export default function Cinema() {
  const section = useRef(null);
  const scenes = useRef([]);
  const captions = useRef([]);
  const bar = useRef(null);
  const [reduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    const frame = () => {
      raf = 0;
      const el = section.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = clamp(-r.top / (r.height - window.innerHeight));
      const { cam, local } = timeline(p);
      scenes.current.forEach((s, i) => {
        if (!s) return;
        const t = cam - i; // <0: scene is ahead of the camera, >0: camera has flown past it
        const z = t * DEPTH;
        const op = t < 0 ? clamp(1 + t / 0.85) : clamp(1 - t / 0.32);
        s.style.opacity = op.toFixed(3);
        s.style.visibility = op <= 0.001 ? "hidden" : "visible";
        s.style.transform = `translate3d(0,0,${z.toFixed(1)}px) rotateY(${(t * -14 + ty).toFixed(2)}deg) rotateX(${(tx - t * 4).toFixed(2)}deg)`;
        const lp = local[i];
        s.style.setProperty("--lp", lp.toFixed(4));
        s.style.setProperty("--toss", Math.abs(Math.sin(lp * Math.PI * 3)).toFixed(4));
        if (i === 0) s.style.setProperty("--p", clamp(lp * 1.4).toFixed(4)); // burger builds
      });
      captions.current.forEach((c, i) => {
        if (!c) return;
        const d = Math.abs(cam - i);
        const op = clamp(1 - (d - 0.12) / 0.25);
        c.style.opacity = op.toFixed(3);
        c.style.transform = `translateY(${((cam - i) * -40).toFixed(1)}px)`;
        c.style.visibility = op <= 0.001 ? "hidden" : "visible";
      });
      el.style.setProperty("--prog", p.toFixed(4));
      if (bar.current) bar.current.style.transform = `scaleX(${p.toFixed(4)})`;
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const onMove = (e) => {
      ty = ((e.clientX / window.innerWidth) - 0.5) * 8;
      tx = -((e.clientY / window.innerHeight) - 0.5) * 5;
      schedule();
    };
    frame();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const toMenu = (e) => {
    e?.preventDefault();
    document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" });
  };

  const CAPTIONS = [
    <>
      <p className="eyebrow">Handsworth · Soho Road · newly refurbished</p>
      <h1>Fresh veggie food, <span>built your way.</span></h1>
      <p className="lede">Burgers, wraps, noodles and stir fry, with vegan options. Scroll to see how it gets to you.</p>
      <div className="hero-ctas">
        <a className="btn primary big" href="#menu" onClick={toMenu}>Order now</a>
        <Link to="/book" className="btn ghost big">Book a table</Link>
      </div>
    </>,
    <>
      <p className="eyebrow">Step 1 · The kitchen</p>
      <h2>Cooked fresh the moment you order</h2>
      <p className="lede">Your order lands on our kitchen screen as soon as you pay. We tell you when the chef starts cooking.</p>
    </>,
    <>
      <p className="eyebrow">Step 2 · Delivery</p>
      <h2>Right on time, in your 15-minute slot</h2>
      <p className="lede">Free within 2 miles. Pick your slot, then follow your driver live.</p>
    </>,
    <>
      <p className="eyebrow">Or eat in</p>
      <h2>Scan, order, enjoy at your table</h2>
      <p className="lede">Book a table, scan the QR code when you sit down, and pay at the end.</p>
      <div className="hero-ctas">
        <a className="btn primary big" href="#menu" onClick={toMenu}>See the menu</a>
        <Link to="/book" className="btn ghost big">Book a table</Link>
      </div>
    </>,
  ];

  return (
    <section ref={section} className={`cinema ${reduced ? "still" : ""}`} aria-label="How Pure Vegi works">
      <div className="cine-sticky">
        <div className="cine-stage">
          <div className="cine-world">
            {[BurgerScene, KitchenScene, DeliveryScene, TableScene].map((Scene, i) => (
              <div key={i} className={`scene scene-${i}`} ref={(el) => (scenes.current[i] = el)} aria-hidden="true">
                <Scene />
              </div>
            ))}
          </div>
        </div>
        <div className="cine-captions">
          {CAPTIONS.map((c, i) => (
            <div key={i} className={`caption caption-${i}`} ref={(el) => (captions.current[i] = el)}>{c}</div>
          ))}
        </div>
        {!reduced && (
          <>
            <div className="cine-progress" aria-hidden="true"><div ref={bar} /></div>
            <a className="skip-movie" href="#menu" onClick={toMenu}>Skip to menu ↓</a>
            <div className="scroll-hint" aria-hidden="true"><span />Scroll</div>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------- Scene 1: the burger builds itself ---------------- */
const SEEDS = [[30, 22, 20], [44, 14, -30], [58, 18, 45], [70, 30, -10], [36, 38, 60], [52, 32, 0],
  [64, 46, 30], [24, 44, -45], [46, 52, 15], [78, 50, -60], [56, 62, 80]];
const LAYERS = ["bun-top", "lettuce", "tomato", "cheese", "patty", "onion", "bun-bottom"];

function BurgerScene() {
  return (
    <div className="scene-box burger-scene">
      <div className="layer-z" style={{ "--z": "-260px" }}>
        <div className="glow-disc" />
      </div>
      <div className="burger-stage">
        <div className="burger">
          {LAYERS.map((cls, i) => (
            <div key={cls} className={`layer ${cls}`} style={{ "--i": i }}>
              {cls === "bun-top" && SEEDS.map(([x, y, r], s) => <span key={s} className="seed" style={{ left: `${x}%`, top: `${y}%`, rotate: `${r}deg` }} />)}
            </div>
          ))}
          <div className="plate-shadow" />
        </div>
      </div>
      <div className="layer-z" style={{ "--z": "220px" }}>
        {["leaf a", "slice c", "pepper e", "leaf f", "slice d", "leaf b"].map((c) => <span key={c} className={`floater ${c}`} />)}
      </div>
    </div>
  );
}

/* ---------------- Scene 2: the kitchen, wok tossing ---------------- */
function KitchenScene() {
  return (
    <div className="scene-box kitchen">
      <svg className="layer-z" style={{ "--z": "-320px" }} viewBox="0 0 900 560" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="tiles" width="60" height="40" patternUnits="userSpaceOnUse">
            <rect width="60" height="40" fill="#f3ead6" />
            <path d="M0 0H60M0 20H60M0 40H60M30 0V20M0 20V40M60 20V40" stroke="#e0d3b6" strokeWidth="2" />
          </pattern>
          <radialGradient id="lampGlow"><stop offset="0" stopColor="#ffe3a3" stopOpacity=".9" /><stop offset="1" stopColor="#ffe3a3" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width="900" height="560" fill="url(#tiles)" />
        <rect x="80" y="90" width="220" height="10" rx="4" fill="#8a5a33" />
        <rect x="600" y="90" width="220" height="10" rx="4" fill="#8a5a33" />
        {[100, 150, 200, 250].map((x, i) => <rect key={x} x={x} y={52} width="34" height="38" rx="6" fill={["#e2442c", "#f2b72a", "#74bd3f", "#f09630"][i]} opacity=".85" />)}
        {[620, 680, 740].map((x) => <circle key={x} cx={x + 20} cy="70" r="20" fill="#2d6a4f" opacity=".8" />)}
        <circle cx="450" cy="120" r="160" fill="url(#lampGlow)" />
        <path d="M450 0V60" stroke="#333" strokeWidth="3" />
        <path d="M420 60H480L470 86H430Z" fill="#023e32" />
      </svg>
      <svg className="layer-z" style={{ "--z": "0px" }} viewBox="0 0 900 560">
        <rect x="120" y="400" width="660" height="160" rx="14" fill="#2e3b36" />
        <rect x="120" y="392" width="660" height="20" rx="8" fill="#56645e" />
        <g className="flames">
          {[380, 420, 460, 500].map((x, i) => (
            <path key={x} className={`flame f${i}`} d={`M${x} 396 C${x - 18} 370 ${x - 4} 350 ${x + 6} 330 C${x + 10} 352 ${x + 26} 368 ${x + 12} 396 Z`} fill={i % 2 ? "#ffb02e" : "#ff6a2b"} />
          ))}
        </g>
        <g className="wok">
          <path d="M300 330 Q450 430 600 330 Z" fill="#1d1d1d" />
          <path d="M300 330 Q450 420 600 330" fill="none" stroke="#444" strokeWidth="6" />
          <path d="M596 334 L700 300" stroke="#6b4a2b" strokeWidth="14" strokeLinecap="round" />
          <g className="noodles" fill="none" stroke="#f5cf6a" strokeWidth="6" strokeLinecap="round">
            <path d="M350 340 q20 -26 40 0 t40 0 t40 0 t40 0 t40 0" />
            <path d="M360 352 q20 -20 40 0 t40 0 t40 0 t40 0 t30 0" />
          </g>
        </g>
      </svg>
      <div className="layer-z toss" style={{ "--z": "200px" }}>
        <span className="veg broccoli" style={{ left: "40%", "--h": "210px" }} />
        <span className="veg pepper" style={{ left: "50%", "--h": "260px" }} />
        <span className="veg carrot" style={{ left: "58%", "--h": "190px" }} />
        <span className="veg pepper y" style={{ left: "46%", "--h": "300px" }} />
        <span className="veg noodle" style={{ left: "54%", "--h": "240px" }} />
        <span className="steam s1" /><span className="steam s2" /><span className="steam s3" />
      </div>
    </div>
  );
}

/* ---------------- Scene 3: delivery ride through the streets ---------------- */
function DeliveryScene() {
  const houses = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div className="scene-box delivery">
      <svg className="layer-z" style={{ "--z": "-400px" }} viewBox="0 0 900 560" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d3b4f" /><stop offset=".6" stopColor="#e7875a" /><stop offset="1" stopColor="#f6c178" /></linearGradient>
        </defs>
        <rect width="900" height="560" fill="url(#dusk)" />
        <circle cx="720" cy="110" r="34" fill="#fff4d8" opacity=".9" />
        <path d="M0 380 V300 h60 v-60 h40 v60 h50 v-120 h70 v120 h40 v-80 h36 v80 h60 v-150 a40 40 0 0 1 80 0 v150 h50 v-90 h60 v90 h70 v-70 h60 v70 h50 v-110 h60 v110 h64 V380 Z" fill="#23384a" opacity=".85" />
      </svg>
      <div className="layer-z slide houses" style={{ "--z": "-150px", "--dist": "-620px" }}>
        <svg viewBox="0 0 2100 300" width="2100" height="300">
          {houses.map((i) => (
            <g key={i} transform={`translate(${i * 150} 0)`}>
              <rect x="0" y="90" width="150" height="210" fill={["#9b4a32", "#a85a3c", "#8e4430"][i % 3]} />
              <path d="M-4 92 L75 30 L154 92 Z" fill="#3b2a24" />
              <rect x="20" y="130" width="40" height="46" fill={i % 4 === 1 ? "#ffd98e" : "#2b3a45"} stroke="#f3ead6" strokeWidth="4" />
              <rect x="90" y="130" width="40" height="46" fill={i % 3 === 0 ? "#ffd98e" : "#2b3a45"} stroke="#f3ead6" strokeWidth="4" />
              <rect x="56" y="210" width="38" height="90" rx="4" fill={["#023e32", "#1d4e89", "#7a1f2b"][i % 3]} />
              <rect x="0" y="200" width="150" height="6" fill="#f3ead6" opacity=".7" />
            </g>
          ))}
        </svg>
      </div>
      <div className="layer-z" style={{ "--z": "0px" }}>
        <div className="road"><div className="road-lines" /></div>
        <div className="scooter">
          <svg viewBox="0 0 220 170" width="220" height="170">
            <rect x="40" y="18" width="62" height="54" rx="8" fill="#023e32" />
            <text x="71" y="52" textAnchor="middle" fontFamily="Rubik, Arial" fontWeight="800" fontSize="18" fill="#f6f1e4">PV</text>
            <path d="M104 60 q20 -40 44 -26 l6 20 q-14 10 -30 8 z" fill="#f2a65a" />
            <circle cx="134" cy="26" r="17" fill="#f6f1e4" /><path d="M120 26 h28" stroke="#023e32" strokeWidth="6" />
            <path d="M118 62 l-4 30 h30" fill="none" stroke="#1f2937" strokeWidth="10" strokeLinecap="round" />
            <path d="M40 98 h120 q26 0 36 -30 l6 -16" fill="none" stroke="#e2442c" strokeWidth="14" strokeLinecap="round" />
            <path d="M40 90 h70 v20 h-70 z" fill="#e2442c" />
            <g className="wheel" style={{ transformOrigin: "52px 132px" }}><circle cx="52" cy="132" r="24" fill="#1f2937" /><circle cx="52" cy="132" r="9" fill="#cbd5e1" /><path d="M52 110v44M30 132h44" stroke="#475569" strokeWidth="3" /></g>
            <g className="wheel" style={{ transformOrigin: "176px 132px" }}><circle cx="176" cy="132" r="24" fill="#1f2937" /><circle cx="176" cy="132" r="9" fill="#cbd5e1" /><path d="M176 110v44M154 132h44" stroke="#475569" strokeWidth="3" /></g>
            <circle cx="206" cy="58" r="6" fill="#ffe08a" />
          </svg>
        </div>
      </div>
      <div className="layer-z slide lamps" style={{ "--z": "240px", "--dist": "-1500px" }}>
        {Array.from({ length: 8 }, (_, i) => <span key={i} className="lamp" style={{ left: `${i * 420}px` }} />)}
      </div>
    </div>
  );
}

/* ---------------- Scene 4: table, phone scans the QR ---------------- */
function TableScene() {
  return (
    <div className="scene-box table-scene">
      <div className="layer-z wall" style={{ "--z": "-320px" }}>
        <div className="frame"><img src="/logo.jpg" alt="" /></div>
        <span className="pendant a" /><span className="pendant b" />
      </div>
      <svg className="layer-z" style={{ "--z": "0px" }} viewBox="0 0 900 560">
        <ellipse cx="450" cy="470" rx="420" ry="110" fill="#8a5a33" />
        <ellipse cx="450" cy="455" rx="420" ry="100" fill="#a8703f" />
        <g className="plate p1"><ellipse cx="300" cy="440" rx="90" ry="30" fill="#fffdf7" /><ellipse cx="300" cy="428" rx="54" ry="22" fill="#e4a24c" /><rect x="252" y="428" width="96" height="10" rx="5" fill="#74bd3f" /><ellipse cx="300" cy="444" rx="50" ry="14" fill="#c77a26" /></g>
        <g className="plate p2"><ellipse cx="600" cy="440" rx="90" ry="30" fill="#fffdf7" /><path d="M540 432 Q600 470 660 432 Z" fill="#023e32" /><path d="M560 432 q10 -14 20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="#f5cf6a" strokeWidth="5" /></g>
        <rect x="430" y="380" width="26" height="60" rx="8" fill="#cfe8f2" opacity=".85" />
      </svg>
      <div className="layer-z" style={{ "--z": "180px" }}>
        <div className="phone">
          <div className="phone-screen">
            <b>Table 7</b>
            <div className="qr" />
            <span className="sent">Order sent to kitchen</span>
          </div>
        </div>
      </div>
    </div>
  );
}
