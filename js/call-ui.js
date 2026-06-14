// Voice/video call UI. Owns the full-screen call overlay, the minimized
// header pill, and the WebRTC signaling subscribe. The host wires DOM
// buttons (Call / Video) to startOutgoing() and supplies a context object
// for reading current chat state and writing a call-history message at the
// end of each call.

import { Call } from "./call.js";
import { subscribeSignals } from "./signaling.js";
import { ID as AppwriteID } from "./appwrite.js";
import { RING_TIMEOUT_MS } from "./config.js";
import { dialogAlert } from "./dialog.js";
import { showToast } from "./toast.js";
import { paintAvatar } from "./avatar.js";
import { playOutgoingRing, playIncomingRing, stopRing } from "./ringtones.js";

const CALL_ICON_END     = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .4-.23.74-.56.9-.98.48-1.87 1.1-2.66 1.85a.998.998 0 0 1-1.41 0L.29 13.08a.95.95 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a.998.998 0 0 1-1.41 0c-.79-.74-1.69-1.36-2.67-1.85a1.01 1.01 0 0 1-.56-.9v-3.1A16.84 16.84 0 0 0 12 9z" fill="currentColor" transform="rotate(135 12 12)"/></svg>`;
const CALL_ICON_ACCEPT  = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.4 21 3 13.6 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.2 2.3z" fill="currentColor"/></svg>`;
const CALL_ICON_MIC     = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" fill="currentColor"/></svg>`;
const CALL_ICON_MUTE    = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23A6.94 6.94 0 0 0 19 11zm-4.02.17L15 11V5a3 3 0 0 0-6 0v.18l5.98 5.99zM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 3 3l1.66.83 4.07 4.07L19 17.73 4.27 3z" fill="currentColor"/></svg>`;
const CALL_ICON_SPEAKER = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/></svg>`;
const CALL_ICON_CAM_ON  = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M17 10.5V7c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-3.5l4 4v-11l-4 4z" fill="currentColor"/></svg>`;
const CALL_ICON_CAM_OFF = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2 2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z" fill="currentColor"/></svg>`;
const CALL_ICON_FLIP    = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9.5 4 6.83 6.66 12 11.83V8c2.21 0 4 1.79 4 4 0 .72-.19 1.4-.52 1.99l1.46 1.46A5.94 5.94 0 0 0 18 12c0-3.31-2.69-6-6-6V2L9.5 4zM12 16c-2.21 0-4-1.79-4-4 0-.72.19-1.4.52-1.99L7.06 8.55A5.94 5.94 0 0 0 6 12c0 3.31 2.69 6 6 6v4l2.5-2.5L12 17v-1z" fill="currentColor"/></svg>`;

function callBtn(label, html, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "call-btn-circle " + cls;
  b.setAttribute("aria-label", label);
  b.innerHTML = html;
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Mount the call UI. Returns:
 *   {
 *     startOutgoing(other, media),   // open a new outgoing call
 *     updatePill(),                  // re-evaluate header pill visibility
 *   }
 *
 * ctx:
 *   me                    — signed-in user object
 *   getActiveOther()      — current chat peer (for the header pill)
 *   getActiveConversation() — current conversation (for call-history)
 *   getCachedUsers()      — array of cached users (for offer→caller lookup)
 *   sendCallEvent(conv, body) — async, writes the __CALL__ history message
 */
export function setupCallUI(ctx) {
  const callOverlay  = document.getElementById("call-overlay");
  const callAvatarEl = document.getElementById("call-avatar");
  const callNameEl   = document.getElementById("call-name");
  const callStatusEl = document.getElementById("call-status");
  const callCtrlsEl  = document.getElementById("call-controls");
  const callPill     = document.getElementById("call-pill");
  const callPillText = document.getElementById("call-pill-text");
  const callMinBtn   = document.getElementById("call-minimize");
  const remoteVideo  = document.getElementById("call-remote-video");
  const localVideo   = document.getElementById("call-local-video");

  let activeCall      = null;
  let pendingIncoming = null; // { callId, other, cancel } pre-pickup
  let callTimer       = null;
  let muted           = false;

  // Header pill is visible only when a call involving the open chat's peer
  // is running while the overlay is minimized. Click → back to call screen.
  function updatePill() {
    const peer = activeCall?.other || pendingIncoming?.other;
    const activeOther = ctx.getActiveOther();
    const show = !!peer && callOverlay.classList.contains("hidden") &&
                 activeOther && peer.$id === activeOther.$id;
    callPill.classList.toggle("hidden", !show);
    if (show) callPillText.textContent = callStatusEl.textContent;
  }
  callMinBtn.addEventListener("click", () => {
    callOverlay.classList.add("hidden");
    updatePill();
  });
  callPill.addEventListener("click", () => {
    callOverlay.classList.remove("hidden");
    updatePill();
  });

  function showCallUI(other, status, controls) {
    paintAvatar(callAvatarEl, other.$id, other.name || other.email);
    callAvatarEl.classList.remove("ringing");
    callNameEl.textContent = other.name;
    callStatusEl.textContent = status;
    callCtrlsEl.innerHTML = "";
    controls.forEach((c) => callCtrlsEl.appendChild(c));
    callOverlay.classList.remove("hidden");
    updatePill();
  }

  function hideCallUI() {
    callOverlay.classList.add("hidden");
    callOverlay.classList.remove("video-active");
    callOverlay.dataset.media = "audio";
    callAvatarEl.classList.remove("ringing");
    remoteVideo.classList.add("hidden");
    localVideo.classList.add("hidden");
    try { remoteVideo.srcObject = null; } catch {}
    try { localVideo.srcObject = null; } catch {}
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    updatePill();
  }

  function startCallTimer() {
    const start = Date.now();
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      callStatusEl.textContent = `${mm}:${ss}`;
      callPillText.textContent = `${mm}:${ss}`;
    }, 1000);
  }

  function endActiveCall() {
    if (!activeCall) return;
    activeCall.hangup();
    activeCall = null;
    muted = false;
    hideCallUI();
  }

  function wireCall(call, other, conv) {
    callOverlay.dataset.media = call.media;
    // Local preview: show as soon as the camera/mic is acquired. For video
    // this means the caller sees themselves while the line still rings.
    call.on("localstream", (stream) => {
      if (call.media !== "video") return;
      try { localVideo.srcObject = stream; } catch {}
      localVideo.classList.toggle("mirrored", call._facing === "user");
      localVideo.classList.remove("hidden");
      localVideo.play?.().catch(() => {});
    });
    call.on("remotestream", (stream) => {
      if (call.media !== "video") return;
      try { remoteVideo.srcObject = stream; } catch {}
      remoteVideo.classList.remove("hidden");
      remoteVideo.play?.().catch(() => {});
      callOverlay.classList.add("video-active");
    });
    call.on("ringing", () => {
      showCallUI(other, "Calling…", [
        callBtn("End call", CALL_ICON_END, "end danger", endActiveCall),
      ]);
      playOutgoingRing();
    });
    // The moment either side picks up — stop ringing, flip to call screen,
    // start the timer. Both peers reach this within ~200 ms of each other.
    call.on("accepted", () => {
      stopRing();
      muted = false;
      let loud = false;
      startCallTimer();
      callStatusEl.textContent = "00:00";
      callCtrlsEl.innerHTML = "";
      const muteBtn = callBtn("Toggle mute", CALL_ICON_MIC, "mute", () => {
        muted = !muted;
        call.setMuted(muted);
        muteBtn.innerHTML = muted ? CALL_ICON_MUTE : CALL_ICON_MIC;
        muteBtn.classList.toggle("active", muted);
      });
      if (call.media === "video") {
        let camOn = true;
        const camBtn = callBtn("Toggle camera", CALL_ICON_CAM_ON, "camera", () => {
          camOn = !camOn;
          call.setCameraEnabled(camOn);
          camBtn.innerHTML = camOn ? CALL_ICON_CAM_ON : CALL_ICON_CAM_OFF;
          camBtn.classList.toggle("active", !camOn);
        });
        const flipBtn = callBtn("Flip camera", CALL_ICON_FLIP, "flip", async () => {
          flipBtn.disabled = true;
          try { await call.switchCamera(); } finally { flipBtn.disabled = false; }
        });
        callCtrlsEl.append(
          muteBtn,
          camBtn,
          flipBtn,
          callBtn("End call", CALL_ICON_END, "end danger", endActiveCall),
        );
      } else {
        const spkBtn = callBtn("Loudspeaker", CALL_ICON_SPEAKER, "speaker", () => {
          loud = !loud;
          call.setLoudspeaker(loud);
          spkBtn.classList.toggle("active", loud);
        });
        callCtrlsEl.append(
          muteBtn,
          spkBtn,
          callBtn("End call", CALL_ICON_END, "end danger", endActiveCall),
        );
      }
    });
    call.on("ended", () => {
      stopRing();
      if (activeCall === call) {
        activeCall = null;
        hideCallUI();
        showToast(`Call with ${other.name} ended`);
      }
      // Caller logs a single call-history record; both sides see it via realtime.
      if (call.kind === "out" && conv) {
        const duration = call.startedAt ? Math.floor((Date.now() - call.startedAt) / 1000) : 0;
        const status = duration > 0 ? "accepted" : "missed";
        ctx.sendCallEvent(conv, "__CALL__" + JSON.stringify({
          status, duration, media: call.media,
        })).catch(() => {});
      }
    });
  }

  async function startOutgoing(other, media = "audio") {
    if (activeCall) { showToast("Already on a call"); return; }
    const conv = ctx.getActiveConversation();
    if (!conv) return;
    const callId = AppwriteID.unique();
    const call = new Call(ctx.me, other, callId, "out", { media });
    activeCall = call;
    wireCall(call, other, conv);
    // Auto-cancel if the other side never picks up within the timeout.
    const ringTimer = setTimeout(() => {
      if (activeCall === call && !call.startedAt) {
        showToast(`${other.name} didn't answer`);
        endActiveCall();
      }
    }, RING_TIMEOUT_MS);
    call.on("accepted", () => clearTimeout(ringTimer));
    call.on("ended",    () => clearTimeout(ringTimer));
    try {
      await call.startOutgoing();
    } catch (err) {
      clearTimeout(ringTimer);
      endActiveCall();
      dialogAlert("Couldn't start call: " + (err?.message || err));
    }
  }

  function handleIncomingCall(sig, other, media) {
    if (activeCall) {
      // Already busy — auto-decline by sending end.
      const tmp = new Call(ctx.me, other, sig.callId, "in");
      tmp.hangup();
      return;
    }
    const callId = sig.callId;
    const offer = sig._payload;
    playIncomingRing();

    // Auto-decline if the user doesn't pick up within the timeout.
    const ringTimer = setTimeout(() => {
      cancelPendingIncoming();
      const tmp = new Call(ctx.me, other, callId, "in");
      tmp.hangup();
      showToast(`Missed call from ${other.name}`);
    }, RING_TIMEOUT_MS);

    function cancelPendingIncoming() {
      clearTimeout(ringTimer);
      stopRing();
      hideCallUI();
      pendingIncoming = null;
    }
    pendingIncoming = { callId, other, cancel: cancelPendingIncoming };

    // Reuse the full-screen call overlay for the incoming ring screen, with
    // real Accept (green phone) + Decline (red rotated phone) icon buttons.
    const decline = callBtn("Decline", CALL_ICON_END, "end danger", () => {
      cancelPendingIncoming();
      const tmp = new Call(ctx.me, other, callId, "in");
      tmp.hangup();
    });
    const accept = callBtn("Accept", CALL_ICON_ACCEPT, "accept success", async () => {
      cancelPendingIncoming();
      const call = new Call(ctx.me, other, callId, "in", { media });
      activeCall = call;
      wireCall(call, other);
      // Keep the call screen up for the receiver — cancelPendingIncoming()
      // hid the overlay and "accepted" only repaints its contents.
      showCallUI(other, "Connecting…", []);
      try {
        await call.acceptIncoming(offer);
      } catch (err) {
        endActiveCall();
        dialogAlert("Couldn't accept call: " + (err?.message || err));
      }
    });
    const ringLabel = media === "video" ? "Incoming video call…" : "Incoming voice call…";
    showCallUI(other, ringLabel, [decline, accept]);
    callAvatarEl.classList.add("ringing");
  }

  // Listen for signaling docs addressed to me.
  subscribeSignals(ctx.me.$id, async (sig) => {
    if (sig.type === "offer") {
      const users = ctx.getCachedUsers();
      const other = users.find((u) => u.$id === sig.from);
      // The caller's SDP has an `m=video` line when they offered video —
      // no need to add a custom field on the signaling doc.
      const isVideo = !!sig._payload?.sdp?.includes("m=video");
      if (other) handleIncomingCall(sig, other, isVideo ? "video" : "audio");
    } else if (sig.type === "end" && pendingIncoming && pendingIncoming.callId === sig.callId) {
      // Caller hung up before we picked up — kill the ringtone + dialog.
      pendingIncoming.cancel();
      showToast("Caller cancelled");
    } else if (activeCall && activeCall.callId === sig.callId) {
      await activeCall.handleSignal(sig);
    }
  });

  return { startOutgoing, updatePill };
}
