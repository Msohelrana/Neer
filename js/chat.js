import { db, mapDoc } from "./firebase.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  or,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { COL_CONVERSATIONS, COL_MESSAGES } from "./config.js";
import { getCachedConversation, saveCachedConversation } from "./cache.js";

const messagesCol = () => collection(db, COL_MESSAGES);

function pairKey(a, b) {
  return [a, b].sort().join("_");
}

export async function getOrCreateConversation(meId, otherId) {
  const key = pairKey(meId, otherId);

  const cached = getCachedConversation(meId, key);
  if (cached) return cached;

  // The pairKey IS the document id, so a 1-on-1 pair always resolves to the
  // same doc and we can fetch it with a direct get() (no query) — which lets
  // the read rule gate on `participants` without needing a composite index.
  const ref = doc(db, COL_CONVERSATIONS, key);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const conv = mapDoc(snap);
    saveCachedConversation(meId, key, conv);
    return conv;
  }

  // setDoc on the deterministic id is idempotent if both peers create at once.
  await setDoc(ref, {
    pairKey: key,
    participants: [meId, otherId],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = mapDoc(await getDoc(ref));
  saveCachedConversation(meId, key, created);
  return created;
}

/**
 * Loads messages for a conversation. If `since` is an ISO timestamp, only
 * messages created strictly after that time are returned — use this with the
 * latest cached message's `$createdAt` to fetch deltas.
 */
export async function loadMessages(conversationId, since) {
  const filters = [
    where("conversationId", "==", conversationId),
    orderBy("createdAt", "asc"),
    limit(200),
  ];
  if (since) {
    filters.splice(1, 0, where("createdAt", ">", Timestamp.fromDate(new Date(since))));
  }
  const res = await getDocs(query(messagesCol(), ...filters));
  return res.docs.map(mapDoc);
}

export async function sendMessage(conversation, meId, text, reply, imageId) {
  const otherId = conversation.participants.find((p) => p !== meId);
  const data = {
    conversationId: conversation.$id,
    senderId: meId,
    receiverId: otherId,
    text: text || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (reply?.id) {
    data.replyToId   = reply.id;
    data.replyToText = (reply.text || "").slice(0, 280);
  }
  if (imageId) data.imageId = imageId;
  const ref = await addDoc(messagesCol(), data);
  return mapDoc(await getDoc(ref));
}

export async function editMessage(messageId, newText) {
  const ref = doc(db, COL_MESSAGES, messageId);
  await updateDoc(ref, { text: newText, updatedAt: serverTimestamp() });
  return mapDoc(await getDoc(ref));
}

export async function deleteMessage(messageId) {
  return deleteDoc(doc(db, COL_MESSAGES, messageId));
}

// Tombstone a message instead of deleting it — replaces text with a sentinel
// so both sides render a "Message removed" placeholder. Used by "Remove for
// everyone" so the chat history shows the message ever existed.
export const DELETED_SENTINEL = "__DELETED__";
export async function markDeleted(messageId) {
  const ref = doc(db, COL_MESSAGES, messageId);
  await updateDoc(ref, { text: DELETED_SENTINEL, updatedAt: serverTimestamp() });
  return mapDoc(await getDoc(ref));
}

// Translate a Firestore snapshot's docChanges into create/update/delete
// callbacks, skipping the initial snapshot so existing history isn't replayed
// as new-message events.
function dispatchChanges(handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  let first = true;
  return (snap) => {
    if (first) { first = false; return; }
    snap.docChanges().forEach((change) => {
      const payload = mapDoc(change.doc);
      if (change.type === "added") onCreate?.(payload);
      else if (change.type === "modified") onUpdate?.(payload);
      else if (change.type === "removed") onDelete?.(payload);
    });
  };
}

/**
 * Subscribes to message create/update/delete events for the given conversation.
 * Pass any combination of { onCreate, onUpdate, onDelete }; returns an unsubscribe fn.
 */
export function subscribeMessages(conversationId, handlers) {
  const q = query(
    messagesCol(),
    where("conversationId", "==", conversationId),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(q, dispatchChanges(handlers));
}

/**
 * Global message subscription — fires for any message where the current user is
 * sender or receiver. Used by the sidebar to keep last-message previews and
 * unread badges live across all conversations.
 */
export function subscribeAllMessages(meId, handlers) {
  const q = query(
    messagesCol(),
    or(where("senderId", "==", meId), where("receiverId", "==", meId))
  );
  return onSnapshot(q, dispatchChanges(handlers));
}
