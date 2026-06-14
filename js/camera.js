// In-app camera (Messenger-style). The host wires `open()` to a button and
// receives the captured JPEG via `onPhoto(file)`. If the camera isn't
// available the module bails — the host can call `onFallback?.()` to open
// a native <input capture> instead.

export function setupCamera({ onPhoto, onFallback }) {
  const overlay   = document.getElementById("camera-overlay");
  const videoEl   = document.getElementById("camera-video");
  const previewEl = document.getElementById("camera-preview");
  const shutterEl = document.getElementById("camera-shutter");
  const flipBtn   = document.getElementById("camera-flip");
  const retakeBtn = document.getElementById("camera-retake");
  const sendBtn   = document.getElementById("camera-send");
  const closeBtn  = document.getElementById("camera-close");

  let stream = null;
  let facing = "environment";
  let blob   = null;

  async function startStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: false,
    });
    videoEl.srcObject = stream;
    // Mirror the live preview for the front camera, like every camera app.
    videoEl.classList.toggle("mirrored", facing === "user");
  }

  async function open() {
    try {
      await startStream();
    } catch {
      // No camera / permission denied — let the host fall back to the
      // native capture input.
      onFallback?.();
      return;
    }
    resetUI();
    overlay.classList.remove("hidden");
    // Own a history entry so the phone back button closes the camera
    // instead of quitting the app.
    if (!history.state || history.state.view !== "camera") {
      history.pushState({ view: "camera" }, "");
    }
  }

  function resetUI() {
    if (previewEl.src) { URL.revokeObjectURL(previewEl.src); previewEl.removeAttribute("src"); }
    blob = null;
    previewEl.classList.add("hidden");
    videoEl.classList.remove("hidden");
    shutterEl.classList.remove("hidden");
    flipBtn.classList.remove("hidden");
    retakeBtn.classList.add("hidden");
    sendBtn.classList.add("hidden");
  }

  // Tear down without touching history — for the popstate path.
  function hide() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    videoEl.srcObject = null;
    resetUI();
    overlay.classList.add("hidden");
  }

  // The user-facing close — pops the history entry so popstate tears down.
  function close() {
    if (history.state?.view === "camera") history.back();
    else hide();
  }

  shutterEl.addEventListener("click", () => {
    if (!videoEl.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext("2d");
    if (facing === "user") {
      // Capture what the mirrored preview showed.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0);
    canvas.toBlob((b) => {
      if (!b) return;
      blob = b;
      previewEl.src = URL.createObjectURL(b);
      previewEl.classList.remove("hidden");
      videoEl.classList.add("hidden");
      shutterEl.classList.add("hidden");
      flipBtn.classList.add("hidden");
      retakeBtn.classList.remove("hidden");
      sendBtn.classList.remove("hidden");
    }, "image/jpeg", 0.92);
  });

  retakeBtn.addEventListener("click", resetUI); // stream still running
  sendBtn.addEventListener("click", () => {
    if (!blob) return;
    const file = new File([blob], "camera.jpg", { type: "image/jpeg" });
    close();
    onPhoto?.(file);
  });
  flipBtn.addEventListener("click", async () => {
    facing = facing === "user" ? "environment" : "user";
    try {
      await startStream();
    } catch {
      facing = facing === "user" ? "environment" : "user";
    }
  });
  closeBtn.addEventListener("click", close);

  return { open, close, hide, isOpen: () => !overlay.classList.contains("hidden") };
}
