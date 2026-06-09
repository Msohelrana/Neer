// Minimal pass-through service worker.
// Its only purpose is to satisfy Chrome's "must have a fetch handler"
// installability criterion. It does not cache anything.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
