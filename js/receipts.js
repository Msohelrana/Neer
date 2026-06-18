import { db, mapDoc } from "./firebase.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { COL_RECEIPTS } from "./config.js";

/**
 * Read receipts. Each user keeps one row per conversation marking the
 * timestamp of the most recent message they've seen. The sender uses the
 * other participant's receipt to label their last bubble as Sent /
 * Delivered / Seen.
 */

const receiptsCol = () => collection(db, COL_RECEIPTS);

export async function loadReceipts(conversationId) {
  try {
    const res = await getDocs(
      query(receiptsCol(), where("conversationId", "==", conversationId), limit(10))
    );
    return res.docs.map(mapDoc);
  } catch (err) {
    // Returns null (vs []) so callers can tell "unavailable" apart from "no docs
    // yet" and skip the realtime subscribe to avoid noise.
    console.warn("loadReceipts failed:", err?.message || err);
    return null;
  }
}

export async function createReceipt(conversationId, userId, lastSeenAt) {
  const ref = await addDoc(receiptsCol(), {
    conversationId, userId, lastSeenAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return mapDoc(await getDoc(ref));
}

export async function updateReceipt(receiptId, lastSeenAt) {
  return updateDoc(doc(db, COL_RECEIPTS, receiptId), { lastSeenAt, updatedAt: serverTimestamp() });
}

export function subscribeReceipts(conversationId, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  const q = query(receiptsCol(), where("conversationId", "==", conversationId));
  let first = true;
  return onSnapshot(q, (snap) => {
    if (first) { first = false; return; }
    snap.docChanges().forEach((change) => {
      const payload = mapDoc(change.doc);
      if (change.type === "added") onCreate?.(payload);
      else if (change.type === "modified") onUpdate?.(payload);
      else if (change.type === "removed") onDelete?.(payload);
    });
  });
}
