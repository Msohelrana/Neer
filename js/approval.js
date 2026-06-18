import { db, auth, mapDoc } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { COL_APPROVALS, COL_ADMINS } from "./config.js";

/**
 * Admin approval gate. A user may enter the app only when an approval doc with
 * their userId exists. The `approvals` collection is writable only by users who
 * have an `admins/{uid}` doc (enforced by Security Rules), so users cannot
 * approve themselves. Approval doc id == userId for direct lookups.
 */

const cacheKey = (userId) => `neer:approved:${userId}`;

// Approval is bound to the email the admin approved: changing the account email
// breaks the match, forcing a fresh admin approval.
export async function isApproved(userId, email) {
  try {
    const snap = await getDoc(doc(db, COL_APPROVALS, userId));
    const ok = snap.exists() && snap.data().email === email;
    try {
      if (ok) localStorage.setItem(cacheKey(userId), email);
      else localStorage.removeItem(cacheKey(userId));
    } catch {}
    return ok;
  } catch (err) {
    // Network/permission blip → trust the last known answer instead of locking out.
    return localStorage.getItem(cacheKey(userId)) === email;
  }
}

// True when the signed-in user has an admins/{uid} doc.
export async function isAdmin() {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    const snap = await getDoc(doc(db, COL_ADMINS, uid));
    return snap.exists();
  } catch {
    return false;
  }
}

// ----- Admin-only (fail server-side for everyone else) -----

export async function listApprovals() {
  const res = await getDocs(query(collection(db, COL_APPROVALS), limit(500)));
  return res.docs.map(mapDoc);
}

export async function approveUser(userId, email) {
  return setDoc(doc(db, COL_APPROVALS, userId), {
    userId, email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function revokeApproval(approvalDocId) {
  return deleteDoc(doc(db, COL_APPROVALS, approvalDocId));
}
