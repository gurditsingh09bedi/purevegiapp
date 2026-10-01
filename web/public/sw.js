// Pure Vegi service worker: shows order and booking notifications, even when the site is closed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(m.title || "Pure Vegi", {
    body: m.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: m.url || "/" },
    tag: m.url || "pure-vegi",
    renotify: true,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === url && "focus" in w) return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
