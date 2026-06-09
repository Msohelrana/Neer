const MSG_PREFIX         = "neer:msgs";
const CONV_PREFIX        = "neer:conv";
const HIDDEN_PREFIX      = "neer:hidden";
const USERS_PREFIX       = "neer:users";
const PROFILE_OK_PREFIX  = "neer:profileok";
const SEEN_PREFIX        = "neer:seen";
const RECEIPT_PREFIX     = "neer:receipt";
const DELETED_PREFIX     = "neer:deleted";

const msgKey        = (userId, conversationId) => `${MSG_PREFIX}:${userId}:${conversationId}`;
const convKey       = (userId, pairKey)        => `${CONV_PREFIX}:${userId}:${pairKey}`;
const hiddenKey     = (userId)                 => `${HIDDEN_PREFIX}:${userId}`;
const usersKey      = (userId)                 => `${USERS_PREFIX}:${userId}`;
const profileOkKey  = (userId)                 => `${PROFILE_OK_PREFIX}:${userId}`;
const seenKey       = (userId, conversationId) => `${SEEN_PREFIX}:${userId}:${conversationId}`;
const receiptKey    = (userId, conversationId) => `${RECEIPT_PREFIX}:${userId}:${conversationId}`;
const deletedKey    = (userId, conversationId) => `${DELETED_PREFIX}:${userId}:${conversationId}`;

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

// One-shot flag: skip the `getDocument` in ensureProfile after first success.
export function wasProfileEnsured(userId) {
  return read(profileOkKey(userId)) === true;
}

export function markProfileEnsured(userId) {
  write(profileOkKey(userId), true);
}

// User list cache. Returns { users, fetchedAt } or null.
export function getCachedUserList(meId) {
  return read(usersKey(meId));
}

export function saveCachedUserList(meId, users) {
  write(usersKey(meId), { users, fetchedAt: Date.now() });
}

export function upsertCachedUser(meId, user) {
  const cached = getCachedUserList(meId);
  if (!cached) return false;
  const i = cached.users.findIndex((u) => u.$id === user.$id);
  if (i === -1) cached.users.push(user);
  else cached.users[i] = { ...cached.users[i], ...user };
  cached.users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  write(usersKey(meId), cached);
  return true;
}

// Last-seen ISO timestamp per conversation. Used to bold unread chat-list items.
export function getLastSeen(userId, conversationId) {
  return read(seenKey(userId, conversationId)) || "";
}

export function markSeen(userId, conversationId, timestamp) {
  if (!timestamp) return;
  const prev = read(seenKey(userId, conversationId));
  if (prev && prev >= timestamp) return;
  write(seenKey(userId, conversationId), timestamp);
}

// Stores the $id of the user's own receipt doc per conversation so we can
// update it in place without a lookup query.
export function getMyReceiptId(userId, conversationId) {
  return read(receiptKey(userId, conversationId));
}
export function saveMyReceiptId(userId, conversationId, receiptId) {
  write(receiptKey(userId, conversationId), receiptId);
}

// Wipe every locally-cached trace of a conversation and stamp a "deleted at"
// cutoff so old server-side messages don't get refetched on reopen. The conv
// stub itself is kept (saves a refetch) and the cutoff is what makes the
// deletion sticky — loadMessages uses it as the `since` filter.
export function deleteCachedConversation(userId, pairKey) {
  const conv = getCachedConversation(userId, pairKey);
  if (!conv) return null;
  try {
    localStorage.removeItem(msgKey(userId, conv.$id));
    localStorage.removeItem(seenKey(userId, conv.$id));
    localStorage.removeItem(receiptKey(userId, conv.$id));
    write(deletedKey(userId, conv.$id), new Date().toISOString());
  } catch (err) {
    console.warn("deleteCachedConversation failed:", err);
  }
  return conv;
}

export function getDeletedAt(userId, conversationId) {
  return read(deletedKey(userId, conversationId)) || "";
}

export function removeCachedUser(meId, userId) {
  const cached = getCachedUserList(meId);
  if (!cached) return false;
  const next = cached.users.filter((u) => u.$id !== userId);
  if (next.length === cached.users.length) return false;
  cached.users = next;
  write(usersKey(meId), cached);
  return true;
}
