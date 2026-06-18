import { db, mapDoc } from "./firebase.js";
import {
  collection,
  doc,
  addDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { COL_SIGNALING } from "./config.js";

/**
 * Tiny WebRTC signaling layer over Firestore. Each signal is a doc with
 * { callId, from, to, type, payload }. type ∈ { "offer", "answer", "ice", "end" }.
 * Docs are pruned at the end of each call.
 */

const signalingCol = () => collection(db, COL_SIGNALING);

export async function sendSignal(callId, from, to, type, payload) {
  const ref = await addDoc(signalingCol(), {
    callId, from, to, type,
    payload: JSON.stringify(payload ?? {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Callers don't read fields off the result; avoid a read-back on a hot path.
  return { $id: ref.id };
}

export function subscribeSignals(myId, handler) {
  const q = query(signalingCol(), where("to", "==", myId));
  let first = true;
  return onSnapshot(q, (snap) => {
    if (first) { first = false; return; }
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const sig = mapDoc(change.doc);
      try { sig._payload = JSON.parse(sig.payload || "{}"); }
      catch { sig._payload = {}; }
      handler(sig);
    });
  });
}

export async function pruneCallSignals(callId) {
  try {
    const res = await getDocs(
      query(signalingCol(), where("callId", "==", callId), limit(100))
    );
    for (const d of res.docs) {
      try { await deleteDoc(doc(db, COL_SIGNALING, d.id)); } catch {}
    }
  } catch (e) { /* ignore */ }
}
