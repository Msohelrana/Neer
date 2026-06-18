/**
 * Web Push registration — DISABLED.
 *
 * Closed-app push required a server to deliver notifications (formerly the
 * Appwrite `send-push` function). That was dropped in the Firebase migration to
 * stay on the free Spark plan, which has no Cloud Functions.
 *
 * `enablePush()` is kept as a no-op so existing callers don't break. In-app
 * realtime notifications (while a tab is open) are unaffected. To restore true
 * closed-app push, add a Cloud Function on the Blaze plan that sends Web Push on
 * new-message writes, and re-implement the subscribe + persist flow here.
 */
export async function enablePush(/* userId */) {
  return null;
}
