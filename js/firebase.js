// Firebase initialization + shared helpers. Replaces the old Appwrite SDK init.
//
// We deliberately re-export the modular SDK functions the rest of the app needs
// from this single module, so the data layer imports `auth`, `db` and the
// query/doc helpers from one place (mirroring how everything used to import
// from appwrite.js).

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

import { firebaseConfig } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/**
 * Reshape a Firestore document snapshot into the Appwrite-style object the rest
 * of the app expects: `$id`, `$createdAt`, `$updatedAt` alongside the fields.
 *
 * Timestamps are emitted as ISO strings (the app compares/sorts/formats them as
 * such). `serverTimestamps: "estimate"` gives a best-guess time for writes that
 * haven't yet been acknowledged by the server, so optimistic local snapshots
 * never surface a null `$createdAt`.
 */
export function mapDoc(snap) {
  const data = snap.data({ serverTimestamps: "estimate" }) || {};
  const toIso = (ts) => (ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : null);
  const created = toIso(data.createdAt) || new Date().toISOString();
  const updated = toIso(data.updatedAt) || created;
  // Strip the raw Timestamp fields; the app only ever reads the $-prefixed ones.
  const { createdAt, updatedAt, ...rest } = data;
  return { ...rest, $id: snap.id, $createdAt: created, $updatedAt: updated };
}

// Random id for non-document identifiers (e.g. WebRTC call ids). Replaces
// Appwrite's ID.unique() where a Firestore auto-id isn't involved.
export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
