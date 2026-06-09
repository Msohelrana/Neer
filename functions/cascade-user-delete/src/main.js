import { Client, Databases, Query } from "node-appwrite";

const DB_ID            = "6a268f90000c630a4d44";
const COL_USERS        = "users";
const COL_CONVERSATIONS = "conversations";
const COL_MESSAGES     = "messages";
const COL_REACTIONS    = "reactions";

/**
 * Triggered by the `users.*.delete` Appwrite Auth event. Cascades the
 * deletion to the matching profile document plus any data the user owns
 * (messages they sent or received, conversations they were a participant
 * in, reactions they placed). Without this, the website keeps showing
 * "ghost" users whose account no longer exists.
 */
export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers["x-appwrite-key"] ?? process.env.APPWRITE_API_KEY);

  const db = new Databases(client);

  let payload;
  try { payload = req.bodyJson ?? JSON.parse(req.body || "{}"); }
  catch { payload = {}; }

  const userId = payload?.$id;
  if (!userId) {
    error("Event payload missing $id");
    return res.json({ ok: false, error: "no userId in payload" }, 400);
  }

  log(`Cascading delete for user ${userId}`);

  // 1. Delete the user's profile document (sidebar removes them instantly via realtime).
  await safeDelete(db, COL_USERS, userId, log, error);

  // 2. Delete every message they sent OR received.
  for (const field of ["senderId", "receiverId"]) {
    await deleteAllMatching(db, COL_MESSAGES, [Query.equal(field, userId)], log, error);
  }

  // 3. Delete conversations they were a participant in.
  await deleteAllMatching(db, COL_CONVERSATIONS, [Query.equal("participants", userId)], log, error);

  // 4. Delete their reactions.
  await deleteAllMatching(db, COL_REACTIONS, [Query.equal("userId", userId)], log, error);

  return res.json({ ok: true, userId });
};

async function safeDelete(db, collection, id, log, error) {
  try {
    await db.deleteDocument(DB_ID, collection, id);
    log(`Deleted ${collection}/${id}`);
  } catch (e) {
    if (e.code === 404) return;
    error(`Failed deleting ${collection}/${id}: ${e.message}`);
  }
}

async function deleteAllMatching(db, collection, queries, log, error) {
  let cursor = null;
  while (true) {
    const page = [...queries, Query.limit(100)];
    if (cursor) page.push(Query.cursorAfter(cursor));
    let result;
    try { result = await db.listDocuments(DB_ID, collection, page); }
    catch (e) { error(`List ${collection} failed: ${e.message}`); return; }
    if (!result.documents.length) return;
    for (const doc of result.documents) {
      try { await db.deleteDocument(DB_ID, collection, doc.$id); }
      catch (e) { error(`Delete ${collection}/${doc.$id} failed: ${e.message}`); }
    }
    log(`Deleted ${result.documents.length} from ${collection}`);
    if (result.documents.length < 100) return;
    cursor = result.documents[result.documents.length - 1].$id;
  }
}
