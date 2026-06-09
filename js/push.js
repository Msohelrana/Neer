import { databases, ID, Permission, Role, Query } from "./appwrite.js";
import { DB_ID, COL_PUSH_SUBS, VAPID_PUBLIC_KEY } from "./config.js";

/**
 * Web Push registration.
 *
 * Subscribes the current device to Web Push and stores the resulting
 * endpoint in the `pushSubscriptions` collection so the send-push
 * Appwrite Function can deliver notifications when this device is offline
 * or the app tab is closed.
 */

function isSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Register a push subscription for this device and save it to Appwrite.
 * No-op if Web Push is unsupported, the VAPID key is unset, or permission
 * is not granted. Returns the saved doc or null.
 */
export async function enablePush(userId) {
  if (!isSupported()) return null;
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("PASTE_")) {
    console.warn("VAPID_PUBLIC_KEY not configured — skipping push subscribe.");
    return null;
  }
  if (Notification.permission !== "granted") return null;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh   = json.keys?.p256dh;
  const auth     = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;

  // Avoid duplicate rows for the same endpoint on the same user.
  try {
    const existing = await databases.listDocuments(DB_ID, COL_PUSH_SUBS, [
      Query.equal("userId", userId),
      Query.equal("endpoint", endpoint),
      Query.limit(1),
    ]);
    if (existing.documents.length) return existing.documents[0];
  } catch (err) {
    console.warn("Push lookup failed:", err?.message || err);
  }

  try {
    return await databases.createDocument(
      DB_ID, COL_PUSH_SUBS, ID.unique(),
      { userId, endpoint, p256dh, auth },
      [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ]
    );
  } catch (err) {
    console.warn("Push subscription save failed:", err?.message || err);
    return null;
  }
}
