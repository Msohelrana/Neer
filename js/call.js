import { sendSignal, pruneCallSignals } from "./signaling.js";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/**
 * Single-channel 1-on-1 audio/video call using WebRTC + Firestore signaling.
 * Use `startOutgoing()` from the caller side, `acceptIncoming(offer)` from
 * the callee. Pass `{ media: "video" }` in opts for a video call.
 * Events: 'ringing' | 'accepted' | 'connected' | 'ended'
 *         'localstream' | 'remotestream' (MediaStream arg)
 */
export class Call {
  constructor(me, other, callId, kind /* "out" | "in" */, opts = {}) {
    this.me = me;
    this.other = other;
    this.callId = callId;
    this.kind = kind;
    this.media = opts.media === "video" ? "video" : "audio";
    this._facing = "user";
    this.pc = new RTCPeerConnection(ICE_CONFIG);
    this.localStream = null;
    this.remoteStream = null;
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
      this._emit("remotestream", stream);
      // Video calls play audio through the <video> element the UI binds to
      // this stream; the earpiece/loudspeaker routing only makes sense for
      // voice-only calls.
      if (this.media === "video") return;
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
        if (this.media === "video") this._tuneVideoSender().catch(() => {});
        this._emit("connected");
      } else if (s === "failed" || s === "disconnected" || s === "closed") {
        this.hangup();
      }
    };
  }

  // Pin the video sender to a reasonable ceiling and keep framerate steady
  // when bandwidth tightens (better than jerky high-res for talking heads).
  // GCC backs off below this automatically on a poor link.
  async _tuneVideoSender(maxBitrateBps = 1_200_000) {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = maxBitrateBps;
    params.degradationPreference = "maintain-framerate";
    try { await sender.setParameters(params); }
    catch (e) { console.warn("setParameters:", e?.message); }
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
  }
  _emit(event, ...args) {
    this.listeners.get(event)?.forEach((fn) => { try { fn(...args); } catch {} });
  }

  async _getMic() {
    // Echo cancellation/noise suppression default to on for audio. For video
    // we ask for 720p @ 30fps; the browser downshifts if the camera can't.
    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    };
    if (this.media === "video") {
      constraints.video = {
        facingMode: this._facing,
        width:  { ideal: 1280, max: 1920 },
        height: { ideal: 720,  max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      };
    }
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
    this._emit("localstream", this.localStream);
  }

  setCameraEnabled(on) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !!on));
  }

  // Swap front/back camera mid-call by renegotiating the video sender's track.
  async switchCamera() {
    if (this.media !== "video" || !this.localStream) return;
    const oldTrack = this.localStream.getVideoTracks()[0];
    if (!oldTrack) return;
    const next = this._facing === "user" ? "environment" : "user";
    let newStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: next },
      });
    } catch (err) {
      console.warn("Camera switch failed:", err?.message || err);
      return;
    }
    const newTrack = newStream.getVideoTracks()[0];
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);
    oldTrack.stop();
    this.localStream.removeTrack(oldTrack);
    this.localStream.addTrack(newTrack);
    this._facing = next;
    this._emit("localstream", this.localStream);
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
