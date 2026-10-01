// Home page film, made from Pure Vegi's own footage.
// 1. A full-screen hero reel (best shots: pizza cut, wok fire, noodles, burger, sizzler, shopfront).
// 2. A scroll-driven "3D movie": five chapters, cooking -> eating -> dining. A tall section pins a
//    stage to the screen; as you scroll, each chapter's video card flies in from depth, turns,
//    settles, then swings away while the next arrives. Only the chapter on screen plays.
// Respects reduced motion and data saver (posters only, tap to play). Plain CSS 3D, no library.
import { useEffect, useRef, useState } from "react";
import { Link } from "./state.jsx";

const M = "/media/";
const CHAPTERS = [
  {
    id: "pizza", kicker: "Made by hand", title: "Pizza, from the dough up",
    text: "Stretched by hand, sauced, loaded with peppers, paneer and cheese, then baked hot and cut to order.",
    video: "pizza", photo: { src: "photo-oven", alt: "Two Pure Vegi pizzas fresh out of the oven" }, menu: "pizza", cta: "See the pizzas",
  },
  {
    id: "wok", kicker: "Fire in the wok", title: "Noodles & stir fry, flame-tossed",
    text: "Hakka noodles, fried rice and chilli paneer, tossed over a roaring flame and plated in seconds.",
    video: "wok", menu: "noodle", cta: "See noodles & stir fry",
  },
  {
    id: "grill", kicker: "Stacked high", title: "Burgers, skewers & sizzlers",
    text: "Double-stacked veggie burgers, paneer tikka skewers and sizzling platters, made fresh when you order.",
    video: "grill", menu: "burger", cta: "See the burgers",
  },
  {
    id: "digin", kicker: "Dig in", title: "Made for sharing",
    text: "Saucy noodles, loaded fries, chana and warm breads. Pull up a chair, tear, dip and dig in.",
    video: "digin", vertical: true, photo: { src: "photo-signature", alt: "Paneer tikka pizza in front of the glowing Pure Vegi logo" },
    menu: "", cta: "Order now",
  },
  {
    id: "dine", kicker: "Come sit with us", title: "324 Soho Road, Handsworth",
    text: "A bright, comfy dining room, open every day from 12pm. Book your table online and we'll have it ready.",
    video: "dine", book: true,
  },
];

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);

function calmMode() {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData;
  return Boolean(reduced || saveData);
}

// Ask the menu to jump to a category (the menu listens for this).
export function showMenu(category = "") {
  window.dispatchEvent(new CustomEvent("pv:menu", { detail: category }));
  document.getElementById("menu")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// WebM (smaller; Chrome, Firefox, Edge, Android) first, MP4 for Safari / iPhone.
function Sources({ name }) {
  return (
    <>
      <source src={`${M}${name}.webm`} type="video/webm" />
      <source src={`${M}${name}.mp4`} type="video/mp4" />
    </>
  );
}

function play(v) {
  if (!v) return;
  if (v.paused) v.play().catch(() => {});
}

export default function FoodFilm() {
  const [calm] = useState(calmMode);
  return (
    <>
      <Hero calm={calm} />
      {calm ? <StillStory /> : <ScrollStory />}
    </>
  );
}

function Hero({ calm }) {
  const video = useRef(null);
  const [mobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [paused, setPaused] = useState(calm);
  const name = mobile ? "hero-m" : "hero";

  // Pause the hero when it scrolls away, to save battery.
  useEffect(() => {
    const v = video.current;
    if (!v || calm) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !paused) play(v); else v.pause(); }, { threshold: 0.15 });
    io.observe(v);
    return () => io.disconnect();
  }, [calm, paused]);

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) { play(v); setPaused(false); } else { v.pause(); setPaused(true); }
  }

  return (
    <section className="ff-hero" aria-label="Pure Vegi">
      <video ref={video} className="ff-hero-video" poster={`${M}${name}.jpg`}
        muted loop playsInline autoPlay={!calm} preload={calm ? "none" : "auto"} aria-hidden="true">
        <Sources name={name} />
      </video>
      <div className="ff-hero-shade" />
      <div className="ff-hero-copy">
        <p className="ff-eyebrow">100% vegetarian · vegan options · Handsworth, Birmingham</p>
        <h1>Thinking vegi?<span>Think Pure Vegi.</span></h1>
        <p className="ff-lede">Hand-stretched pizza, flame-tossed noodles, stacked burgers and sizzlers. Delivered, collected, or at our table.</p>
        <div className="ff-ctas">
          <button className="btn primary big" onClick={() => showMenu()}>Order now</button>
          <Link to="/book" className="btn ghost big">Book a table</Link>
        </div>
      </div>
      <button className="ff-pause" onClick={toggle} aria-label={paused ? "Play video" : "Pause video"}>
        {paused ? "▶" : "❚❚"}
      </button>
      {!calm && <div className="ff-scroll-cue" aria-hidden="true"><span>Scroll for the kitchen tour</span><i /></div>}
    </section>
  );
}

function Media({ c, videoRef, preload = "none", controls = false }) {
  return (
    <div className={`ff-media ${c.vertical ? "vertical" : ""}`}>
      <video ref={videoRef} poster={`${M}${c.video}.jpg`} muted loop playsInline
        preload={preload} controls={controls} aria-label={`${c.title}: video from the Pure Vegi kitchen`}>
        <Sources name={c.video} />
      </video>
    </div>
  );
}

function Photo({ p, className = "" }) {
  return (
    <picture className={`ff-photo ${className}`}>
      <source media="(max-width: 760px)" srcSet={`${M}${p.src}-sm.webp`} />
      <img src={`${M}${p.src}.webp`} alt={p.alt} loading="lazy" decoding="async" />
    </picture>
  );
}

function ChapterCopy({ c, i }) {
  return (
    <>
      <p className="ff-kicker"><span>{String(i + 1).padStart(2, "0")}</span>{c.kicker}</p>
      <h2>{c.title}</h2>
      <p className="ff-text">{c.text}</p>
      <div className="ff-ctas">
        {c.book
          ? <><Link to="/book" className="btn primary">Book a table</Link><button className="btn ghost" onClick={() => showMenu()}>Order online</button></>
          : <button className="btn primary" onClick={() => showMenu(c.menu)}>{c.cta}</button>}
      </div>
    </>
  );
}

function ScrollStory() {
  const section = useRef(null);
  const cards = useRef([]);
  const copies = useRef([]);
  const photos = useRef([]);
  const videos = useRef([]);
  const dots = useRef([]);
  const bar = useRef(null);
  const active = useRef(-1);
  const visible = useRef(false);
  const N = CHAPTERS.length;

  useEffect(() => {
    let raf = 0;
    const mobile = () => window.innerWidth <= 760;
    const frame = () => {
      raf = 0;
      const el = section.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = clamp(-r.top / span) * (N - 1); // 0 .. N-1
      const m = mobile();
      if (bar.current) bar.current.style.transform = `scaleX(${(p / (N - 1)).toFixed(4)})`;
      let now = 0;
      CHAPTERS.forEach((c, i) => {
        const t = p - i; // -1: arriving, 0: centred, +1: gone
        const card = cards.current[i];
        const copy = copies.current[i];
        if (!card || !copy) return;
        const side = i % 2 === 0 ? 1 : -1; // media alternates right / left on desktop
        // Each chapter holds flat for most of its scroll (-0.2..0.3). Between two chapters the old
        // card turns out towards its own side while the new one turns in from its side, together,
        // like a page turn, so the screen is never empty.
        let u; let arriving = false;
        if (t < -0.2) { u = smooth(clamp((-0.2 - t) / 0.5)); arriving = true; } else u = smooth(clamp((t - 0.3) / 0.5));
        const dir = arriving ? 1 : -1;
        const tf = m
          ? `translate3d(0, ${(dir * u * 32).toFixed(2)}vh, ${(-u * 260).toFixed(1)}px) rotateX(${(-dir * u * 16).toFixed(2)}deg)`
          : `translate3d(${(side * u * 26).toFixed(2)}vw, 0, ${(-u * 320).toFixed(1)}px) rotateY(${(side * u * 30).toFixed(2)}deg)`;
        const op = clamp(1 - u * 1.1);
        const cop = clamp(1 - u * 3.2);
        const cy = dir * u * 36;
        card.style.transform = tf;
        card.style.opacity = op.toFixed(3);
        card.style.visibility = op < 0.01 ? "hidden" : "visible";
        copy.style.opacity = cop.toFixed(3);
        copy.style.transform = `translate3d(0, ${cy.toFixed(1)}px, 0)`;
        copy.style.visibility = cop < 0.01 ? "hidden" : "visible";
        copy.style.pointerEvents = cop > 0.6 ? "auto" : "none";
        const ph = photos.current[i];
        if (ph) ph.style.transform = `translate3d(0, ${(-t * 8).toFixed(2)}vh, 90px) rotate(${(side * 5 - t * 5).toFixed(2)}deg)`;
        dots.current[i]?.classList.toggle("on", i === Math.round(p));
      });
      now = Math.round(p);
      if (visible.current && now !== active.current) {
        active.current = now;
        videos.current.forEach((v, i) => {
          if (!v) return;
          if (i === now) play(v);
          else v.pause();
          if (Math.abs(i - now) === 1 && v.preload === "none") v.preload = "auto"; // warm up the neighbours
        });
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
    // Only animate (and play) while the story is on screen.
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      if (!e.isIntersecting) { videos.current.forEach((v) => v?.pause()); active.current = -1; }
      else onScroll();
    });
    if (section.current) io.observe(section.current);
    frame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [N]);

  function jumpTo(i) {
    const el = section.current;
    const span = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: el.offsetTop + (span * i) / (N - 1) + 2, behavior: "smooth" });
  }

  return (
    <section ref={section} className="ff-story" style={{ height: `${N * 100}vh` }} aria-label="Inside the Pure Vegi kitchen">
      <div className="ff-sticky">
        <div className="ff-progress"><div ref={bar} /></div>
        <div className="ff-stage">
          {CHAPTERS.map((c, i) => (
            <div key={c.id} className={`ff-chapter ${i % 2 ? "media-left" : "media-right"}`}>
              <div className="ff-world">
                <div className="ff-card" ref={(el) => { cards.current[i] = el; }}>
                  <Media c={c} videoRef={(el) => { videos.current[i] = el; }} preload={i === 0 ? "auto" : "none"} />
                  {c.photo && <div className="ff-photo-wrap" ref={(el) => { photos.current[i] = el; }}><Photo p={c.photo} /></div>}
                </div>
              </div>
              <div className="ff-copy" ref={(el) => { copies.current[i] = el; }}>
                <ChapterCopy c={c} i={i} />
              </div>
            </div>
          ))}
        </div>
        <nav className="ff-dots" aria-label="Kitchen tour chapters">
          {CHAPTERS.map((c, i) => (
            <button key={c.id} ref={(el) => { dots.current[i] = el; }} onClick={() => jumpTo(i)}>
              <span>{c.kicker}</span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}

// Reduced motion / data saver: the same chapters as calm sections; videos play only when tapped.
function StillStory() {
  return (
    <section className="ff-still" aria-label="Inside the Pure Vegi kitchen">
      {CHAPTERS.map((c, i) => (
        <article key={c.id} className={`ff-still-row ${i % 2 ? "media-left" : ""}`}>
          <Media c={c} controls />
          <div className="ff-copy static"><ChapterCopy c={c} i={i} /></div>
        </article>
      ))}
    </section>
  );
}

export { Photo };
