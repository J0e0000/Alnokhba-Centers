/* ============================================================
   Alnokhba Managment — Service Worker
   النطاق متعمّد ضيق: تدعيم الحضور أوفلاين + إشعارات Web Push.
   - pre-cache للهيكل (shell) عشان التطبيق يفتح من غير نت
   - الـ API مش بيتكاش أبداً (الداتا لازم تكون حية)
   - مفيش أي دعم لأي عملية دفع أوفلاين — ده قرار أمان متعمد
============================================================ */

const CACHE = "nokhba-shell-v11";
const SHELL = [
  "/",
  "/portal",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/logo.png",
  "/fonts/cairo-arabic.woff2",
  "/fonts/cairo-latin.woff2",
  "/fonts/cairo-latin-ext.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // الـ API عمره ما يتكاش — محتاج داتا حية دايمًا
  if (url.pathname.startsWith("/api/")) return;

  // Shell + static: cache-first مع تحديث في الخلفية
  // المطابقة بالـ pathname فقط — عشان نسخ اللوجو اللي عليها ?v= تلاقي نسختها في الكاش
  if (SHELL.includes(url.pathname) || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(url.pathname).then((cached) => {
        const fetched = fetch(event.request)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(url.pathname, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
  }
});

/* ============================= Web Push (بورتال الطالب) ============================= */
/* نمط فيسبوك/إنستجرام:
   - الصفحة ظاهرة على الشاشة؟ → بوب-أب جوّه الصفحة نفسها (postMessage) + صوت من الصفحة
   - الصفحة في الخلفية/مقفولة؟ → إشعار نظام حقيقي بصوت واهتزاز
*/
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch (e) { payload = { title: "Alnokhba Managment", body: event.data.text() }; }
  const title = payload.title || "Alnokhba Managment";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    dir: "rtl",
    lang: "ar",
    tag: payload.tag || "nokhba",
    data: { url: payload.url || "/portal" },
    // صوت النظام (silent: false = الافتراضي — أندرويد بيشغّل صوت التنبيه) + اهتزاز دينج-دينج
    silent: false,
    vibrate: [120, 60, 120],
    renotify: true, // نفس الـ tag وصل تاني؟ زعّق تاني زي الرسايل
    requireInteraction: false,
  };
  event.waitUntil((async () => {
    // لو فيه صفحة بورتال ظاهرة وفوكسة دلوقتي → اعرضها جوّه الصفحة (بوب-أب + صوت من المتصفح)
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = clientList.find((c) => c.visibilityState === "visible" && c.focused);
    if (visible && "postMessage" in visible) {
      visible.postMessage({ type: "nk-push", payload });
      return;
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/portal";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          // لو الصفحة مفتوحة على تاب تانية — وجّهها للهدف
          if ("postMessage" in client) client.postMessage({ type: "nk-navigate", url });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

/* الرسايل من الصفحة نفسها (مثلاً: تنبيه وصل أثناء التصفح) */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "nk-show-notification") {
    const { title, body, url, tag } = event.data.payload || {};
    event.waitUntil && event.waitUntil(
      self.registration.showNotification(title || "Alnokhba Managment", {
        body: body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        dir: "rtl", lang: "ar",
        tag: tag || "nokhba",
        data: { url: url || "/portal" },
        silent: false,
        vibrate: [120, 60, 120],
        renotify: true,
      })
    );
  }
});
