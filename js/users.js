import { db, mapDoc } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { COL_USERS } from "./config.js";
import { wasProfileEnsured, markProfileEnsured } from "./cache.js";

const usersCol = () => collection(db, COL_USERS);

/**
 * Create the user's profile document on first login.
 * Document ID == account uid so we can fetch by ID later.
 *
 * After a successful creation we set a localStorage flag so subsequent page
 * loads skip the read entirely.
 */
export async function ensureProfile(user) {
  if (wasProfileEnsured(user.$id)) return;
  if (navigator.onLine === false) return;  // try again when we're back online
  try {
    const ref = doc(db, COL_USERS, user.$id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      markProfileEnsured(user.$id);
      return;
    }
    await setDoc(ref, {
      name: user.name,
      email: user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    markProfileEnsured(user.$id);
  } catch (err) {
    // Network/permission hiccup → don't block app load; retry next page open.
    console.warn("ensureProfile failed:", err?.message || err);
  }
}

export async function listOtherUsers(meId) {
  // Firestore can't cheaply express "document id != meId", so fetch the page
  // ordered by name and drop myself client-side.
  const snap = await getDocs(query(usersCol(), orderBy("name"), limit(100)));
  return snap.docs.map(mapDoc).filter((u) => u.$id !== meId);
}

export async function getUser(userId) {
  const snap = await getDoc(doc(db, COL_USERS, userId));
  if (!snap.exists()) {
    const err = new Error("user not found");
    err.code = 404;
    throw err;
  }
  return mapDoc(snap);
}

export async function updateProfileName(userId, name) {
  return updateDoc(doc(db, COL_USERS, userId), { name, updatedAt: serverTimestamp() });
}

export async function updateProfileEmail(userId, email) {
  return updateDoc(doc(db, COL_USERS, userId), { email, updatedAt: serverTimestamp() });
}

/**
 * Bump my own `lastActiveAt` so other clients can render an "online" dot.
 * Designed to be cheap: callers throttle to ~once a minute. Stored as an ISO
 * string (the value is read/compared directly, not used for ordering).
 */
export async function heartbeat(userId) {
  try {
    await updateDoc(doc(db, COL_USERS, userId), {
      lastActiveAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("heartbeat failed:", err?.message || err);
  }
}

/**
 * Subscribe to the users collection so the sidebar can stay live without
 * polling. The initial snapshot (existing users) is skipped — callers seed the
 * list via listOtherUsers() first, then this fires only on later changes.
 */
export function subscribeUsers(handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  let first = true;
  return onSnapshot(usersCol(), (snap) => {
    if (first) { first = false; return; }
    snap.docChanges().forEach((change) => {
      const docData = mapDoc(change.doc);
      if (change.type === "added") onCreate?.(docData);
      else if (change.type === "modified") onUpdate?.(docData);
      else if (change.type === "removed") onDelete?.(docData);
    });
  });
}
