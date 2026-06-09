import { databases, Query, ID, Permission, Role } from "./appwrite.js";
import { DB_ID, COL_SIGNALING } from "./config.js";
import { onCollection } from "./realtime.js";

/**
 * Tiny WebRTC signaling layer that piggybacks on Appwrite Realtime.
 * Each signal is a doc with { callId, from, to, type, payload }.
 * type ∈ { "offer", "answer", "ice", "end" }
 */

export async function sendSignal(callId, from, to, type, payload) {
  return databases.createDocument(
    DB_ID, COL_SIGNALING, ID.unique(),
    {
      callId, from, to, type,
      payload: JSON.stringify(payload ?? {}),
    },
    [
      Permission.read(Role.users()),
      Permission.update(Role.users()),
      Permission.delete(Role.users()),
    ]
  );
}

export function subscribeSignals(myId, handler) {
  return onCollection(COL_SIGNALING, (resp) => {
    const sig = resp.payload;
    if (!sig || sig.to !== myId) return;
    if (!resp.events.some((e) => e.endsWith(".create"))) return;
    try { sig._payload = JSON.parse(sig.payload || "{}"); }
    catch { sig._payload = {}; }
    handler(sig);
  });
}

export async function pruneCallSignals(callId) {
  try {
    const res = await databases.listDocuments(DB_ID, COL_SIGNALING, [
      Query.equal("callId", callId),
      Query.limit(100),
    ]);
    for (const d of res.documents) {
      try { await databases.deleteDocument(DB_ID, COL_SIGNALING, d.$id); } catch {}
    }
  } catch (e) { /* ignore */ }
}
