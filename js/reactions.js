import { client, databases, Query, ID, Permission, Role } from "./appwrite.js";
import { DB_ID, COL_REACTIONS } from "./config.js";
import { onCollection } from "./realtime.js";

/**
 * Persistent message reactions. Each (messageId, userId) pair has at most one
 * reaction; switching emojis updates the existing row instead of creating a
 * second one. Both participants can read all reactions in their conversation.
 */

export async function loadReactions(conversationId) {
  try {
    const res = await databases.listDocuments(DB_ID, COL_REACTIONS, [
      Query.equal("conversationId", conversationId),
      Query.limit(500),
    ]);
    return res.documents;
  } catch (err) {
    // Collection might not exist yet — chat should still work without reactions.
    console.warn("loadReactions failed:", err?.message || err);
    return [];
  }
}

export async function createReaction(conversationId, messageId, userId, emoji) {
  return databases.createDocument(
    DB_ID,
    COL_REACTIONS,
    ID.unique(),
    { conversationId, messageId, userId, emoji },
    [
      Permission.read(Role.users()),
      Permission.update(Role.user(userId)),
      Permission.delete(Role.user(userId)),
    ]
  );
}

export async function updateReaction(reactionId, emoji) {
  return databases.updateDocument(DB_ID, COL_REACTIONS, reactionId, { emoji });
}

export async function removeReaction(reactionId) {
  return databases.deleteDocument(DB_ID, COL_REACTIONS, reactionId);
}

export function subscribeReactions(conversationId, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  return onCollection(COL_REACTIONS, (resp) => {
    if (resp.payload?.conversationId !== conversationId) return;
    if (resp.events.some((e) => e.endsWith(".create"))) onCreate?.(resp.payload);
    else if (resp.events.some((e) => e.endsWith(".update"))) onUpdate?.(resp.payload);
    else if (resp.events.some((e) => e.endsWith(".delete"))) onDelete?.(resp.payload);
  });
}
