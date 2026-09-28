// A veggie burger drawn in CSS 3D. It floats apart at the top of the page and
// assembles layer by layer as the visitor scrolls; it tilts toward the pointer.
// No 3D library needed; real dish models (.glb) can replace it later.
import { useEffect, useRef } from "react";

const LAYERS = [
  { cls: "bun-top", label: "Toasted brioche-style bun" },
  { cls: "lettuce", label: "" },
  { cls: "tomato", label: "" },
  { cls: "cheese", label: "" },
  { cls: "patty", label: "" },
  { cls: "onion", label: "" },
  { cls: "bun-bottom", label: "" },
];

// Sesame seeds: [left %, top %, rotation]
const SEEDS = [[30, 22, 20], [44, 14, -30], [58, 18, 45], [70, 30, -10], [36, 38, 60], [52, 32, 0],
  [64, 46, 30], [24, 44, -45], [46, 52, 15], [78, 50, -60], [56, 62, 80]];

export default function Hero3D() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let tiltX = 0;
    let tiltY = 0;
    const apply = () => {
      raf = 0;
      // 0 = exploded (top of page), 1 = assembled after ~45% of a screen of scrolling
      const p = reduce ? 1 : Math.min(window.scrollY / (window.innerHeight * 0.45), 1);
      el.style.setProperty("--p", p.toFixed(3));
      el.style.setProperty("--tx", `${tiltX}deg`);
      el.style.setProperty("--ty", `${tiltY}deg`);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const onMove = (e) => {
      if (reduce) return;
      const r = el.getBoundingClientRect();
      tiltY = ((e.clientX - (r.left + r.width / 2)) / r.width) * 18;
      tiltX = -((e.clientY - (r.top + r.height / 2)) / r.height) * 10;
      schedule();
    };
    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="burger-stage" ref={ref} role="img" aria-label="A veggie burger assembling layer by layer">
      <div className="burger">
        {LAYERS.map((l, i) => (
          <div key={l.cls} className={`layer ${l.cls}`} style={{ "--i": i, "--n": LAYERS.length }}>
            {l.cls === "bun-top" && (
              <>
                {SEEDS.map(([x, y, r], s) => <span key={s} className="seed" style={{ left: `${x}%`, top: `${y}%`, rotate: `${r}deg` }} />)}
              </>
            )}
          </div>
        ))}
        <div className="plate-shadow" />
      </div>
      {["leaf a", "leaf b", "slice c", "slice d", "pepper e", "leaf f"].map((c) => <span key={c} className={`floater ${c}`} aria-hidden="true" />)}
    </div>
  );
}
