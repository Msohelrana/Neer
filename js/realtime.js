import { client } from "./appwrite.js";
import {
  DB_ID,
  COL_USERS,
  COL_MESSAGES,
  COL_REACTIONS,
  COL_RECEIPTS,
  COL_SIGNALING,
} from "./config.js";

/**
 * Central realtime dispatcher. Opens ONE persistent Appwrite WebSocket
 * subscribed to every collection we care about, then dispatches incoming
 * events to per-collection handler lists. Per-conversation subscribe()
 * calls just register/unregister local callbacks — they no longer trigger
 * a WS reconnect (which was producing the "WebSocket closed before
 * connection was established" console warnings).
 */

const TRACKED = [COL_USERS, COL_MESSAGES, COL_REACTIONS, COL_RECEIPTS, COL_SIGNALING];
const channelFor = (col) => `databases.${DB_ID}.collections.${col}.documents`;
const handlers = new Map(TRACKED.map((c) => [c, new Set()]));

let started = false;
function start() {
  if (started) return;
  started = true;
  client.subscribe(TRACKED.map(channelFor), (resp) => {
    const ch = (resp.channels || []).find((c) => /collections\.[^.]+\.documents/.test(c));
    const col = ch?.match(/collections\.([^.]+)\.documents/)?.[1];
    const set = col && handlers.get(col);
    if (!set) return;
    set.forEach((fn) => { try { fn(resp); } catch (e) { console.error(e); } });
  });
}

export function onCollection(collection, handler) {
  start();
  const set = handlers.get(collection);
  if (!set) return () => {};
  set.add(handler);
  return () => set.delete(handler);
}
