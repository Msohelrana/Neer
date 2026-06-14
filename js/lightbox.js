// Full-screen photo/video viewer. Owns its own DOM bindings; the host
// provides a gallery source (file ids in the open chat) plus a media-URL
// resolver so it stays decoupled from the rest of the app.
//
// Phone back + the X button both flow through history.back() so popstate is
// the single close path — the host's popstate handler calls hide() (which
// just tears down the UI, no history pop).

export function setupLightbox({ getGalleryIds, getMediaUrl, onSave }) {
  const el        = document.getElementById("lightbox");
  const imgEl     = document.getElementById("lightbox-img");
  const videoEl   = document.getElementById("lightbox-video");
  const prevBtn   = document.getElementById("lightbox-prev");
  const nextBtn   = document.getElementById("lightbox-next");
  const counterEl = document.getElementById("lightbox-counter");

  let currentId = null;
  let gallery   = [];

  function paintNav() {
    const i = gallery.indexOf(currentId);
    const many = gallery.length > 1;
    prevBtn.classList.toggle("hidden", !many || i <= 0);
    nextBtn.classList.toggle("hidden", !many || i >= gallery.length - 1);
    counterEl.classList.toggle("hidden", !many);
    if (many) counterEl.textContent = `${i + 1} / ${gallery.length}`;
  }

  function showImage(imageId) {
    currentId = imageId;
    imgEl.src = "";
    videoEl.pause();
    videoEl.removeAttribute("src");
    imgEl.classList.remove("hidden");
    videoEl.classList.add("hidden");
    // The shared cache already holds the full-quality file.
    getMediaUrl(imageId).then(({ url, type }) => {
      if (currentId !== imageId) return;
      if (type && type.startsWith("video/")) {
        imgEl.classList.add("hidden");
        videoEl.classList.remove("hidden");
        videoEl.src = url;
      } else {
        imgEl.src = url;
      }
    }).catch(() => {});
    paintNav();
  }

  function step(dir) {
    const i = gallery.indexOf(currentId);
    const next = gallery[i + dir];
    if (next) showImage(next);
  }

  function open(imageId) {
    gallery = getGalleryIds();
    showImage(imageId);
    el.classList.remove("hidden");
    if (!history.state || history.state.view !== "lightbox") {
      history.pushState({ view: "lightbox" }, "");
    }
  }

  // Tear down the UI without touching history — for the popstate path.
  function hide() {
    el.classList.add("hidden");
    imgEl.src = "";
    videoEl.pause();
    videoEl.removeAttribute("src");
    currentId = null;
  }

  // The user-facing close — pops the history entry so popstate hides the UI.
  function close() {
    if (el.classList.contains("hidden")) return;
    if (history.state?.view === "lightbox") history.back();
    else hide();
  }

  el.addEventListener("click", (e) => {
    if (e.target.closest(".lightbox-btn")) return;
    close();
  });
  document.getElementById("lightbox-close").addEventListener("click", close);
  document.getElementById("lightbox-save").addEventListener("click", () => {
    if (currentId) onSave?.(currentId);
  });
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  document.addEventListener("keydown", (e) => {
    if (el.classList.contains("hidden")) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
  });

  // Horizontal swipe steps through photos, Messenger-style.
  let sx = null, sy = null;
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    } else {
      sx = sy = null;
    }
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    sx = sy = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
    }
  });

  return { open, close, hide, isOpen: () => !el.classList.contains("hidden") };
}
