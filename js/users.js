import { client, databases, Query, Permission, Role } from "./appwrite.js";
import { DB_ID, COL_USERS } from "./config.js";
import { wasProfileEnsured, markProfileEnsured } from "./cache.js";
import { onCollection } from "./realtime.js";

/**
 * Create the user's profile document on first login.
 * Document ID == account $id so we can fetch by ID later.
 *
 * After a successful confirmation/creation we set a localStorage flag so
 * subsequent page loads skip the `getDocument` call entirely.
 */
export async function ensureProfile(user) {
  if (wasProfileEnsured(user.$id)) return;
  if (navigator.onLine === false) return;  // try again when we're back online
  try {
    await databases.getDocument(DB_ID, COL_USERS, user.$id);
    markProfileEnsured(user.$id);
    return;
  } catch (err) {
    if (err?.code !== 404) {
      // Network failure → don't block app load; we'll retry on next page open.
      if (!err?.code) return;
      throw err;
    }
  }
  try {
    await databases.createDocument(
      DB_ID,
      COL_USERS,
      user.$id,
      {
        name: user.name,
        email: user.email,
      },
      [
        Permission.read(Role.users()),
        Permission.update(Role.user(user.$id)),
        Permission.delete(Role.user(user.$id)),
      ]
    );
  } catch (err) {
    // Race: another tab created it between our get and create.
    if (err?.code !== 409) {
      if (!err?.code) return;
      throw err;
    }
  }
  markProfileEnsured(user.$id);
}

export async function listOtherUsers(meId) {
  const res = await databases.listDocuments(DB_ID, COL_USERS, [
    Query.notEqual("$id", meId),
    Query.orderAsc("name"),
    Query.limit(100),
  ]);
  return res.documents;
}

export async function getUser(userId) {
  return databases.getDocument(DB_ID, COL_USERS, userId);
}

export async function updateProfileName(userId, name) {
  return databases.updateDocument(DB_ID, COL_USERS, userId, { name });
}

export async function updateProfileEmail(userId, email) {
  return databases.updateDocument(DB_ID, COL_USERS, userId, { email });
}

/**
 * Bump my own `lastActiveAt` so other clients can render an "online" dot.
 * Designed to be cheap: callers throttle to ~once a minute.
 */
export async function heartbeat(userId) {
  try {
    await databases.updateDocument(DB_ID, COL_USERS, userId, {
      lastActiveAt: new Date().toISOString(),
    });
  } catch (err) {
    // Silently ignore — likely the `lastActiveAt` attribute isn't in the
    // schema yet. Online dot stays off; rest of the app keeps working.
    console.warn("heartbeat failed:", err?.message || err);
  }
}

/**
 * Subscribe to the users collection so the sidebar can stay live without
 * polling. Realtime traffic doesn't count toward the read quota.
 */
export function subscribeUsers(handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  return onCollection(COL_USERS, (resp) => {
    const events = resp.events;
    if (events.some((e) => e.endsWith(".create"))) onCreate?.(resp.payload);
    else if (events.some((e) => e.endsWith(".update"))) onUpdate?.(resp.payload);
    else if (events.some((e) => e.endsWith(".delete"))) onDelete?.(resp.payload);
  });
}
