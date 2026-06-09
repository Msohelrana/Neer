import { client, databases, Query, Permission, Role } from "./appwrite.js";
import { DB_ID, COL_USERS } from "./config.js";
import { wasProfileEnsured, markProfileEnsured } from "./cache.js";

/**
 * Create the user's profile document on first login.
 * Document ID == account $id so we can fetch by ID later.
 *
 * After a successful confirmation/creation we set a localStorage flag so
 * subsequent page loads skip the `getDocument` call entirely.
 */
export async function ensureProfile(user) {
  if (wasProfileEnsured(user.$id)) return;
  try {
    await databases.getDocument(DB_ID, COL_USERS, user.$id);
    markProfileEnsured(user.$id);
    return;
  } catch (err) {
    if (err?.code !== 404) throw err;
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
    if (err?.code !== 409) throw err;
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

/**
 * Subscribe to the users collection so the sidebar can stay live without
 * polling. Realtime traffic doesn't count toward the read quota.
 */
export function subscribeUsers(handlers) {
  const { onCreate, onUpdate, onDelete } = handlers;
  const channel = `databases.${DB_ID}.collections.${COL_USERS}.documents`;
  return client.subscribe(channel, (resp) => {
    const events = resp.events;
    if (events.some((e) => e.endsWith(".create"))) onCreate?.(resp.payload);
    else if (events.some((e) => e.endsWith(".update"))) onUpdate?.(resp.payload);
    else if (events.some((e) => e.endsWith(".delete"))) onDelete?.(resp.payload);
  });
}
