import { db, mapDoc } from "./firebase.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { COL_REACTIONS } from "./config.js";

/**
 * Persistent message reactions. Each (messageId, userId) pair has at most one
 * reaction; switching emojis updates the existing row instead of creating a
 * second one. Both participants can read all reactions in their conversation.
 */

const reactionsCol = () => collection(db, COL_REACTIONS);

export async function loadReactions(conversationId) {
  try {
    const res = await getDocs(
      query(reactionsCol(), where("conversationId", "==", conversationId), limit(500))
    );
    return res.docs.map(mapDoc);
  } catch (err) {
    console.warn("loadReactions failed:", err?.message || err);
    return [];
  }
}

export async function createReaction(conversationId, messageId, userId, emoji) {
  const ref = await addDoc(reactionsCol(), {
    conversationId, messageId, userId, emoji,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return mapDoc(await getDoc(ref));
}

export async function updateReaction(reactionId, emoji) {
  return updateDoc(doc(db, COL_REACTIONS, reactionId), { emoji, updatedAt: serverTimestamp() });
}

export async function removeReaction(reactionId) {
  return deleteDoc(doc(db, COL_REACTIONS, reactionId));
}

export function subscribeReactions(conversationId, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  const q = query(reactionsCol(), where("conversationId", "==", conversationId));
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
