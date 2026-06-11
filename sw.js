// Service worker — passes through fetches AND handles Web Push notifications
// delivered by the send-push Appwrite Function.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // Only same-origin requests; cross-origin (Appwrite) go straight to the
  // network so CORS failures surface cleanly instead of as SW errors.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title: "New message", body: event.data?.text() || "" }; }
  const title = data.title || "New message";
  const options = {
    body: data.body || "",
    icon: data.icon || "./icon.svg",
    badge: data.badge || "./icon.svg",
    tag: data.tag,           // collapse same-conversation pushes
    renotify: true,
    data: data.data || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const otherUserId = event.notification.data?.otherUserId;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of list) {
      if (client.url.includes("/chat.html") || client.url.endsWith("/")) {
        await client.focus();
        client.postMessage({ type: "open-conversation", otherUserId });
        return;
      }
    }
    await self.clients.openWindow("./chat.html");
  })());
});
