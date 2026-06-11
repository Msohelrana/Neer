import { sendSignal, pruneCallSignals } from "./signaling.js";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/**
 * Single-channel 1-on-1 audio call using WebRTC + Appwrite signaling.
 * Use `outgoing()` from the caller side, `incoming(offer)` from the callee.
 * Events: 'connecting' | 'ringing' | 'connected' | 'ended'
 */
export class Call {
  constructor(me, other, callId, kind /* "out" | "in" */) {
    this.me = me;
    this.other = other;
    this.callId = callId;
    this.kind = kind;
    this.pc = new RTCPeerConnection(ICE_CONFIG);
    this.localStream = null;
    this.remoteAudio = null;
    this.pendingIce = [];
    this.listeners = new Map();
    this.startedAt = null;
    this.ended = false;

    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      sendSignal(this.callId, this.me.$id, this.other.$id, "ice", e.candidate.toJSON()).catch(() => {});
    };
    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      this.remoteStream = stream;
      this.remoteAudio = document.createElement("audio");
      this.remoteAudio.autoplay = true;
      this.remoteAudio.srcObject = stream;
      this.remoteAudio.muted = false;
      document.body.appendChild(this.remoteAudio);
      // Start in earpiece mode (small call speaker). Loudspeaker toggle
      // flips to the media-speaker path via Web Audio + gain boost.
      this._applyLoudspeaker(false).catch(() => {});
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === "connected") {
        this.startedAt = Date.now();
        this._emit("connected");
      } else if (s === "failed" || s === "disconnected" || s === "closed") {
        this.hangup();
      }
    };
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
  }
  _emit(event, ...args) {
    this.listeners.get(event)?.forEach((fn) => { try { fn(...args); } catch {} });
  }

  async _getMic() {
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
  }

  async startOutgoing() {
    this._emit("ringing");
    await this._getMic();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await sendSignal(this.callId, this.me.$id, this.other.$id, "offer", offer);
  }

  async acceptIncoming(offer) {
    await this._getMic();
    // Receiver picked up — fire "accepted" so the UI can start the timer
    // immediately (instead of waiting for the WebRTC handshake to finish).
    this._emit("accepted");
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await sendSignal(this.callId, this.me.$id, this.other.$id, "answer", answer);
    await this._flushIce();
  }

  async handleSignal(sig) {
    const payload = sig._payload;
    if (sig.type === "answer") {
      await this.pc.setRemoteDescription(payload);
      await this._flushIce();
      // Caller knows the receiver picked up the moment the answer arrives.
      this._emit("accepted");
    } else if (sig.type === "ice") {
      if (this.pc.remoteDescription) {
        try { await this.pc.addIceCandidate(payload); } catch (e) { console.warn("ICE:", e); }
      } else {
        this.pendingIce.push(payload);
      }
    } else if (sig.type === "end") {
      this.hangup(true);
    }
  }

  async _flushIce() {
    while (this.pendingIce.length) {
      const c = this.pendingIce.shift();
      try { await this.pc.addIceCandidate(c); } catch (e) { console.warn("ICE flush:", e); }
    }
  }

  setMuted(mute) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !mute));
  }

  setLoudspeaker(on) {
    this._applyLoudspeaker(on).catch((e) => console.warn("Loudspeaker switch:", e?.message));
  }

  // Find a real output device by label (Chrome on Android exposes
  // "Earpiece" / "Speakerphone" audiooutput devices once the mic permission
  // is granted, which it always is during a call).
  async _findOutput(regex) {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.find((d) => d.kind === "audiooutput" && regex.test(d.label.toLowerCase())) || null;
    } catch { return null; }
  }

  async _applyLoudspeaker(on) {
    if (!this.remoteAudio || !this.remoteStream) return;
    this.loudspeaker = !!on;
    // Tear down any prior Web Audio chain so we can rebuild fresh.
    if (this.audioCtx) {
      try { await this.audioCtx.close(); } catch {}
      this.audioCtx = null;
      this.gainNode = null;
    }
    if (on) {
      // Loudspeaker: explicit speakerphone sink when the platform exposes
      // one; otherwise the legacy Web Audio path (default sink + gain boost).
      const spk = await this._findOutput(/speakerphone|\bspeaker\b/);
      if (spk && this.remoteAudio.setSinkId) {
        try {
          await this.remoteAudio.setSinkId(spk.deviceId);
          this.remoteAudio.muted = false;
          return;
        } catch {}
      }
      try { if (this.remoteAudio.setSinkId) await this.remoteAudio.setSinkId(""); } catch {}
      this.remoteAudio.muted = true;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new Ctx();
        if (this.audioCtx.state === "suspended") await this.audioCtx.resume().catch(() => {});
        const src = this.audioCtx.createMediaStreamSource(this.remoteStream);
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = 1.8;
        src.connect(this.gainNode).connect(this.audioCtx.destination);
      } catch (err) {
        console.warn("WebAudio gain unavailable:", err?.message);
        this.remoteAudio.muted = false;
      }
    } else {
      // Earpiece (calling speaker): explicit earpiece sink where exposed
      // (Android Chrome); fall back to Chromium's 'communications' hint
      // (Windows). Platforms with neither can't route to the earpiece.
      this.remoteAudio.muted = false;
      try {
        if (this.remoteAudio.setSinkId) {
          const ear = await this._findOutput(/earpiece|receiver/);
          if (ear) await this.remoteAudio.setSinkId(ear.deviceId);
          else await this.remoteAudio.setSinkId("communications");
        }
      } catch (e) {
        console.warn("Earpiece routing unavailable:", e?.message);
      }
    }
  }

  hangup(remote = false) {
    if (this.ended) return;
    this.ended = true;
    try { this.pc?.close(); } catch {}
    this.localStream?.getTracks().forEach((t) => t.stop());
    if (this.remoteAudio) {
      try { this.remoteAudio.srcObject = null; } catch {}
      this.remoteAudio.remove();
      this.remoteAudio = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
      this.audioCtx = null;
      this.gainNode = null;
    }
    if (!remote) {
      sendSignal(this.callId, this.me.$id, this.other.$id, "end", {}).catch(() => {});
    }
    pruneCallSignals(this.callId).catch(() => {});
    this._emit("ended");
  }
}
