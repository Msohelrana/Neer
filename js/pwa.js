// Registers the service worker so the browser advertises the install prompt.
// Safe to import on every page; registration is idempotent.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}

// Block pinch zoom on iOS, which ignores user-scalable=no in the viewport meta.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("touchmove", (e) => {
  if (e.scale !== undefined && e.scale !== 1) e.preventDefault();
}, { passive: false });
