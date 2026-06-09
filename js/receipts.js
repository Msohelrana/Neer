import { client, databases, Query, ID, Permission, Role } from "./appwrite.js";
import { DB_ID, COL_RECEIPTS } from "./config.js";
import { onCollection } from "./realtime.js";

/**
 * Read receipts. Each user keeps one row per conversation marking the
 * timestamp of the most recent message they've seen. The sender uses the
 * other participant's receipt to label their last bubble as Sent /
 * Delivered / Seen.
 */

export async function loadReceipts(conversationId) {
  try {
    const res = await databases.listDocuments(DB_ID, COL_RECEIPTS, [
      Query.equal("conversationId", conversationId),
      Query.limit(10),
    ]);
    return res.documents;
  } catch (err) {
    // Returns null (vs []) so callers can tell "collection unavailable" apart
    // from "no docs yet" and skip the realtime subscribe to avoid noise.
    console.warn("loadReceipts failed:", err?.message || err);
    return null;
  }
}

export async function createReceipt(conversationId, userId, lastSeenAt) {
  return databases.createDocument(
    DB_ID,
    COL_RECEIPTS,
    ID.unique(),
    { conversationId, userId, lastSeenAt },
    [
      Permission.read(Role.users()),
      Permission.update(Role.user(userId)),
      Permission.delete(Role.user(userId)),
    ]
  );
}

export async function updateReceipt(receiptId, lastSeenAt) {
  return databases.updateDocument(DB_ID, COL_RECEIPTS, receiptId, { lastSeenAt });
}

export function subscribeReceipts(conversationId, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  return onCollection(COL_RECEIPTS, (resp) => {
    if (resp.payload?.conversationId !== conversationId) return;
    if (resp.events.some((e) => e.endsWith(".create"))) onCreate?.(resp.payload);
    else if (resp.events.some((e) => e.endsWith(".update"))) onUpdate?.(resp.payload);
    else if (resp.events.some((e) => e.endsWith(".delete"))) onDelete?.(resp.payload);
  });
}
