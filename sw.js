const CACHE_NAME = "mbg-pwa-v55-sppg-smart";
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin-penerimaan.html",
  "./admin-pwa.webmanifest",
  "./barang.html",
  "./barang.html?jenis=operasional",
  "./master-barang.html",
  "./menu.html",
  "./limbah.html",
  "./user.html",
  "./supplier.html",
  "./pm.html",
  "./dokumen.html",
  "./surat.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon-192.svg",
  "./assets/icon-512.svg",
  "./landing-page/index.html",
  "./landing-page/console.html",
  "./landing-page/admin.html",
  "./landing-page/styles.css",
  "./landing-page/firebase.js",
  "./landing-page/landing.js",
  "./landing-page/console.js",
  "./landing-page/admin.js",
  "./landing-page/assets/sppg-smart.svg",
  "./landing-page/assets/sppg-smart-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match("./index.html")),
      ),
  );
});
