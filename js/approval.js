import { databases, teams, Query, ID } from "./appwrite.js";
import { DB_ID, COL_APPROVALS, ADMIN_TEAM_NAME } from "./config.js";

/**
 * Admin approval gate. A user may enter the app only when an approval doc
 * with their userId exists. The approvals collection is writable only by the
 * "admins" team (enforced server-side by collection permissions), so users
 * cannot approve themselves.
 */

const cacheKey = (userId) => `neer:approved:${userId}`;

// Approval is bound to the email the admin approved: changing the account
// email breaks the match, which forces a fresh admin approval (users have no
// write access to approval docs, so they can't re-bind it themselves).
export async function isApproved(userId, email) {
  try {
    const res = await databases.listDocuments(DB_ID, COL_APPROVALS, [
      Query.equal("userId", userId),
      Query.limit(1),
    ]);
    const doc = res.documents[0];
    const ok = !!doc && doc.email === email;
    try {
      if (ok) localStorage.setItem(cacheKey(userId), email);
      else localStorage.removeItem(cacheKey(userId));
    } catch {}
    return ok;
  } catch (err) {
    // Collection not created yet → gate is disabled so the app keeps working
    // until the console setup (see config.js) is done.
    if (err?.code === 404) return true;
    // Network blip → trust the last known answer instead of locking out.
    return localStorage.getItem(cacheKey(userId)) === email;
  }
}

// True when the signed-in user belongs to the admins team.
export async function isAdmin() {
  try {
    const res = await teams.list();
    return res.teams.some((t) => t.name === ADMIN_TEAM_NAME);
  } catch {
    return false;
  }
}

// ----- Admin-only (fail server-side for everyone else) -----

export async function listApprovals() {
  const res = await databases.listDocuments(DB_ID, COL_APPROVALS, [Query.limit(500)]);
  return res.documents;
}

export async function approveUser(userId, email) {
  return databases.createDocument(DB_ID, COL_APPROVALS, ID.unique(), { userId, email });
}

export async function revokeApproval(approvalDocId) {
  return databases.deleteDocument(DB_ID, COL_APPROVALS, approvalDocId);
}
