import { databases, Query, Permission, Role } from "./appwrite.js";
import { DB_ID, COL_USERS } from "./config.js";

/**
 * Create the user's profile document on first login.
 * Document ID == account $id so we can fetch by ID later.
 */
export async function ensureProfile(user) {
  try {
    await databases.getDocument(DB_ID, COL_USERS, user.$id);
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
