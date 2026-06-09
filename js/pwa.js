// Registers the service worker so the browser advertises the install prompt.
// Safe to import on every page; registration is idempotent.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}
