import { client, databases, Query, ID, Permission, Role } from "./appwrite.js";
import { DB_ID, COL_CONVERSATIONS, COL_MESSAGES } from "./config.js";
import { onCollection } from "./realtime.js";
import { getCachedConversation, saveCachedConversation } from "./cache.js";

function pairKey(a, b) {
  return [a, b].sort().join("_");
}

export async function getOrCreateConversation(meId, otherId) {
  const key = pairKey(meId, otherId);

  const cached = getCachedConversation(meId, key);
  if (cached) return cached;

  const found = await databases.listDocuments(DB_ID, COL_CONVERSATIONS, [
    Query.equal("pairKey", key),
    Query.limit(1),
  ]);
  if (found.documents.length) {
    saveCachedConversation(meId, key, found.documents[0]);
    return found.documents[0];
  }

  const created = await databases.createDocument(
    DB_ID,
    COL_CONVERSATIONS,
    ID.unique(),
    {
      pairKey: key,
      participants: [meId, otherId],
    },
    [
      // Appwrite's client SDK can only grant perms to self/any/users/teams —
      // granting Role.user(otherId) from the browser is rejected. Role.users()
      // is the tightest client-side option; true per-pair ACLs need a server
      // function to re-permission docs after creation.
      Permission.read(Role.users()),
      Permission.update(Role.user(meId)),
      Permission.delete(Role.user(meId)),
    ]
  );
  saveCachedConversation(meId, key, created);
  return created;
}

/**
 * Loads messages for a conversation. If `since` is an ISO timestamp,
 * only messages created strictly after that time are returned —
 * use this with the latest cached message's `$createdAt` to fetch deltas.
 */
export async function loadMessages(conversationId, since) {
  const queries = [
    Query.equal("conversationId", conversationId),
    Query.orderAsc("$createdAt"),
    Query.limit(200),
  ];
  if (since) queries.push(Query.greaterThan("$createdAt", since));
  const res = await databases.listDocuments(DB_ID, COL_MESSAGES, queries);
  return res.documents;
}

export async function sendMessage(conversation, meId, text, reply, imageId) {
  const otherId = conversation.participants.find((p) => p !== meId);
  const data = {
    conversationId: conversation.$id,
    senderId: meId,
    receiverId: otherId,
    text: text || "",
  };
  if (reply?.id) {
    data.replyToId   = reply.id;
    data.replyToText = (reply.text || "").slice(0, 280);
  }
  if (imageId) data.imageId = imageId;
  return databases.createDocument(
    DB_ID,
    COL_MESSAGES,
    ID.unique(),
    data,
    [
      // See getOrCreateConversation — client SDK can't grant Role.user(otherId).
      Permission.read(Role.users()),
      Permission.update(Role.user(meId)),
      Permission.delete(Role.user(meId)),
    ]
  );
}

export async function editMessage(messageId, newText) {
  return databases.updateDocument(DB_ID, COL_MESSAGES, messageId, { text: newText });
}

export async function deleteMessage(messageId) {
  return databases.deleteDocument(DB_ID, COL_MESSAGES, messageId);
}

// Tombstone a message instead of deleting it — replaces text with a sentinel
// so both sides render a "Message removed" placeholder. Used by "Remove for
// everyone" so the chat history shows the message ever existed.
export const DELETED_SENTINEL = "__DELETED__";
export async function markDeleted(messageId) {
  return databases.updateDocument(DB_ID, COL_MESSAGES, messageId, {
    text: DELETED_SENTINEL,
  });
}

/**
 * Subscribes to message create/update/delete events for the given conversation.
 * Pass any combination of { onCreate, onUpdate, onDelete }; returns an unsubscribe fn.
 */
export function subscribeMessages(conversationId, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  return onCollection(COL_MESSAGES, (resp) => {
    if (resp.payload?.conversationId !== conversationId) return;
    if (resp.events.some((e) => e.endsWith(".create"))) onCreate?.(resp.payload);
    else if (resp.events.some((e) => e.endsWith(".update"))) onUpdate?.(resp.payload);
    else if (resp.events.some((e) => e.endsWith(".delete"))) onDelete?.(resp.payload);
  });
}

/**
 * Global message subscription — fires for any message in the collection where
 * the current user is sender or receiver. Used by the sidebar to keep last-
 * message previews and unread badges live across all conversations.
 */
export function subscribeAllMessages(meId, handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  return onCollection(COL_MESSAGES, (resp) => {
    const msg = resp.payload;
    if (!msg || (msg.senderId !== meId && msg.receiverId !== meId)) return;
    if (resp.events.some((e) => e.endsWith(".create"))) onCreate?.(msg);
    else if (resp.events.some((e) => e.endsWith(".update"))) onUpdate?.(msg);
    else if (resp.events.some((e) => e.endsWith(".delete"))) onDelete?.(msg);
  });
}
