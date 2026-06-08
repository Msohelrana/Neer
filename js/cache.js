const MSG_PREFIX    = "neer:msgs";
const CONV_PREFIX   = "neer:conv";
const HIDDEN_PREFIX = "neer:hidden";

const msgKey    = (userId, conversationId) => `${MSG_PREFIX}:${userId}:${conversationId}`;
const convKey   = (userId, pairKey)        => `${CONV_PREFIX}:${userId}:${pairKey}`;
const hiddenKey = (userId)                 => `${HIDDEN_PREFIX}:${userId}`;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("Cache write failed:", err);
  }
}

export function getCachedMessages(userId, conversationId) {
  return read(msgKey(userId, conversationId)) || [];
}

export function appendCachedMessage(userId, conversationId, message) {
  const list = getCachedMessages(userId, conversationId);
  if (list.some((m) => m.$id === message.$id)) return;
  list.push(message);
  write(msgKey(userId, conversationId), list);
}

export function updateCachedMessage(userId, conversationId, messageId, updates) {
  const list = getCachedMessages(userId, conversationId);
  const i = list.findIndex((m) => m.$id === messageId);
  if (i === -1) return;
  list[i] = { ...list[i], ...updates };
  write(msgKey(userId, conversationId), list);
}

export function removeCachedMessage(userId, conversationId, messageId) {
  const list = getCachedMessages(userId, conversationId);
  const next = list.filter((m) => m.$id !== messageId);
  if (next.length === list.length) return;
  write(msgKey(userId, conversationId), next);
}

export function getCachedConversation(userId, pairKey) {
  return read(convKey(userId, pairKey));
}

export function saveCachedConversation(userId, pairKey, conversation) {
  write(convKey(userId, pairKey), conversation);
}

export function getHiddenIds(userId) {
  return new Set(read(hiddenKey(userId)) || []);
}

export function hideMessageLocally(userId, messageId) {
  const set = getHiddenIds(userId);
  set.add(messageId);
  write(hiddenKey(userId), [...set]);
}
