import { Client, Databases, Query } from "node-appwrite";
import webpush from "web-push";

const DB_ID         = "6a268f90000c630a4d44";
const COL_USERS     = "users";
const COL_PUSH_SUBS = "pushSubscriptions";

/**
 * Triggered by `databases.*.collections.<DB_ID>.collections.messages.documents.*.create`.
 * Looks up the receiver's Web Push subscriptions and delivers a notification
 * to each one. Stale endpoints (HTTP 410/404) are auto-pruned.
 *
 * Env vars required:
 *   VAPID_PUBLIC_KEY   — same value as js/config.js VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY  — the matching private key (keep secret)
 *   VAPID_SUBJECT      — e.g. "mailto:you@example.com"
 */
export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers["x-appwrite-key"] ?? process.env.APPWRITE_API_KEY);
  const db = new Databases(client);

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  let msg;
  try { msg = req.bodyJson ?? JSON.parse(req.body || "{}"); }
  catch { msg = {}; }

  const receiverId = msg.receiverId;
  if (!receiverId || !msg.text) {
    return res.json({ ok: false, error: "missing receiverId or text" }, 400);
  }

  // Sender name for the notification title.
  let senderName = "New message";
  try {
    const sender = await db.getDocument(DB_ID, COL_USERS, msg.senderId);
    senderName = sender.name || senderName;
  } catch (e) { /* ignore */ }

  // Fetch all push subscriptions for the receiver.
  let subs;
  try {
    subs = await db.listDocuments(DB_ID, COL_PUSH_SUBS, [
      Query.equal("userId", receiverId),
      Query.limit(20),
    ]);
  } catch (e) {
    error(`Failed to list push subs: ${e.message}`);
    return res.json({ ok: false, error: e.message }, 500);
  }

  if (!subs.documents.length) {
    log(`No push subscriptions for ${receiverId}`);
    return res.json({ ok: true, sent: 0 });
  }

  const payload = JSON.stringify({
    title: senderName,
    body: msg.text.length > 140 ? msg.text.slice(0, 140) + "…" : msg.text,
    icon: "./icon.svg",
    badge: "./icon.svg",
    tag: msg.conversationId,
    data: { conversationId: msg.conversationId, otherUserId: msg.senderId },
  });

  let sent = 0, pruned = 0;
  for (const sub of subs.documents) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        try { await db.deleteDocument(DB_ID, COL_PUSH_SUBS, sub.$id); pruned++; }
        catch {}
      } else {
        error(`Push to ${sub.endpoint} failed: ${e.message}`);
      }
    }
  }

  log(`Push: ${sent} sent, ${pruned} pruned, ${subs.documents.length} total`);
  return res.json({ ok: true, sent, pruned });
};
