const OUTBOX_PREFIX = "neer:outbox";
const outboxKey = (userId) => `${OUTBOX_PREFIX}:${userId}`;

function readArr(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function writeArr(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)); }
  catch (err) { console.warn("Outbox write failed:", err); }
}

export function getOutbox(userId) {
  return readArr(outboxKey(userId));
}

export function enqueueOutbox(userId, item) {
  const arr = readArr(outboxKey(userId));
  arr.push(item);
  writeArr(outboxKey(userId), arr);
}

export function removeFromOutbox(userId, tempId) {
  const arr = readArr(outboxKey(userId)).filter((m) => m.tempId !== tempId);
  writeArr(outboxKey(userId), arr);
}

export function outboxForConversation(userId, conversationId) {
  return getOutbox(userId).filter((m) => m.conversationId === conversationId);
}
