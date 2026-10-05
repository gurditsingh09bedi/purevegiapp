// Little moments of delight, all plain DOM + Web Animations (no libraries):
//  - flyToCart: the dish flies in an arc into the basket, which bounces; phones give a tiny buzz
//  - tilt: menu cards lean towards the pointer in 3D with a soft glare
//  - reveal: elements float up as they scroll into view
//  - confetti: a burst in brand colours (order placed, booking confirmed)
//  - pageTransition: smooth cross-fade between pages where the browser supports it
// Everything is skipped for people who ask their device for reduced motion.

export const calm = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Haptics. In the Pure Vegi app the phone's own haptic engine is used (iPhone + Android);
// on the website, Android Chrome vibrates briefly. kind: a number (ms) or "success".
export function buzz(kind = 12) {
  if (window.ReactNativeWebView) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "haptic", kind: kind === "success" ? "success" : kind >= 15 ? "medium" : "light" })); } catch { /* ignore */ }
    return;
  }
  // Phones only allow vibration after the person has tapped the page.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(kind === "success" ? [20, 40, 20] : kind); } catch { /* not supported (iPhone Safari) */ }
}

export function flyToCart(fromEl) {
  const cart = document.querySelector(".cart-btn");
  if (!cart) return;
  const bounce = () => {
    cart.classList.remove("cart-bump");
    void cart.offsetWidth; // restart the animation
    cart.classList.add("cart-bump");
  };
  buzz();
  if (calm() || !fromEl) { bounce(); return; }
  const a = fromEl.getBoundingClientRect();
  const b = cart.getBoundingClientRect();
  const ghost = fromEl.cloneNode(true);
  const size = Math.min(140, a.width);
  Object.assign(ghost.style, {
    position: "fixed", left: `${a.left + a.width / 2 - size / 2}px`, top: `${a.top + a.height / 2 - size / 2}px`,
    width: `${size}px`, height: `${size}px`, margin: 0, borderRadius: "50%", objectFit: "cover", overflow: "hidden",
    zIndex: 9999, pointerEvents: "none", boxShadow: "0 18px 40px rgba(0,0,0,.35)",
  });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate([
    { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 140}px) scale(.7) rotate(-120deg)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(-300deg)`, opacity: 0.6 },
  ], { duration: 780, easing: "cubic-bezier(.45,.05,.55,.95)" });
  anim.onfinish = () => { ghost.remove(); bounce(); };
}

// 3D tilt towards the pointer (mouse / pen only, so scrolling on phones is untouched).
export function tiltProps() {
  if (calm()) return {};
  return {
    onPointerMove(e) {
      if (e.pointerType === "touch") return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg) translateY(-4px)`;
      el.style.setProperty("--gx", `${(x + 0.5) * 100}%`);
      el.style.setProperty("--gy", `${(y + 0.5) * 100}%`);
    },
    onPointerLeave(e) { e.currentTarget.style.transform = ""; },
  };
}

// Float elements up as they enter the screen. Returns a cleanup function.
export function reveal(root = document, selector = ".reveal") {
  const els = [...root.querySelectorAll(selector)];
  if (calm() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return () => {}; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { rootMargin: "0px 0px -8% 0px" });
  els.forEach((e, i) => { e.style.setProperty("--d", `${(i % 6) * 60}ms`); io.observe(e); });
  return () => io.disconnect();
}

const COLOURS = ["#f2a65a", "#023e32", "#0b5a48", "#f6f1e4", "#e85d3a", "#8bc34a"];
export function confetti({ count = 140, y = 0.35 } = {}) {
  if (calm()) return;
  const c = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  Object.assign(c.style, { position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 9998 });
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * y,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 5, g: 0.32 + Math.random() * 0.1,
    w: 6 + Math.random() * 7, h: 8 + Math.random() * 10, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    col: COLOURS[(Math.random() * COLOURS.length) | 0], round: Math.random() < 0.3,
  }));
  const start = performance.now();
  const step = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const life = (t - start) / 2600;
    parts.forEach((p) => {
      p.vy += p.g; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - life * life);
      ctx.fillStyle = p.col;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.cos(t / 120 + p.r));
      ctx.restore();
    });
    if (life < 1) requestAnimationFrame(step); else c.remove();
  };
  requestAnimationFrame(step);
  buzz("success");
}

// Cross-fade pages (Chrome, Edge, Safari 18+). Elsewhere the page just changes, as before.
export function pageTransition(update) {
  if (calm() || !document.startViewTransition) { update(); return; }
  document.startViewTransition(update);
}
