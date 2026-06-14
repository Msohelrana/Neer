// Voice/video-call ringtones. Two separate tracks:
//   - outgoing: the caller hears it while waiting; routed to the earpiece
//     where the platform exposes one so it acts like a real ringback.
//   - incoming: louder; played to the receiver while the Accept/Decline
//     dialog is up. Also vibrates if the platform supports it.

const OUTGOING_RING_SRC = "./audio/call ring.mp3";
const INCOMING_RING_SRC = "./audio/receiver ring.mp3";

let _outAudio = null;
let _inAudio  = null;

function _outRing() {
  if (!_outAudio) {
    _outAudio = new Audio(OUTGOING_RING_SRC);
    _outAudio.loop = true;
    _outAudio.preload = "auto";
  }
  return _outAudio;
}

function _inRing() {
  if (!_inAudio) {
    _inAudio = new Audio(INCOMING_RING_SRC);
    _inAudio.loop = true;
    _inAudio.preload = "auto";
  }
  return _inAudio;
}

async function routeRingToEarpiece(a) {
  try {
    if (!a.setSinkId) return;
    const devs = await navigator.mediaDevices.enumerateDevices();
    const ear = devs.find((d) => d.kind === "audiooutput" && /earpiece|receiver/.test(d.label.toLowerCase()));
    if (ear) await a.setSinkId(ear.deviceId);
    else await a.setSinkId("communications");
  } catch {}
}

export function playOutgoingRing() {
  stopRing();
  const a = _outRing();
  a.volume = 0.5;
  a.currentTime = 0;
  routeRingToEarpiece(a).then(() => {
    a.play().catch((e) => console.warn("Outgoing ring play failed:", e?.message));
  });
}

export function playIncomingRing() {
  stopRing();
  const a = _inRing();
  a.volume = 1.0;
  a.currentTime = 0;
  a.play().catch((e) => console.warn("Incoming ring play failed:", e?.message));
  if (navigator.vibrate) navigator.vibrate([2000, 1000, 2000, 1000, 2000]);
}

export function stopRing() {
  [_outAudio, _inAudio].forEach((a) => {
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch {}
  });
  if (navigator.vibrate) navigator.vibrate(0);
}
