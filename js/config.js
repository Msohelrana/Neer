// Fill these in after creating the project + database in the Appwrite console.
// See README.md for step-by-step setup.

export const APPWRITE_ENDPOINT = "https://sgp.cloud.appwrite.io/v1";
export const APPWRITE_PROJECT_ID = "6a268efe0032493b8aaf";

export const DB_ID = "6a268f90000c630a4d44";

export const COL_USERS = "users";
export const COL_CONVERSATIONS = "conversations";
export const COL_MESSAGES = "messages";
export const COL_REACTIONS = "reactions";
export const COL_RECEIPTS = "receipts";
export const COL_PUSH_SUBS = "pushSubscriptions";
export const COL_SIGNALING = "signaling";

// Voice-call: auto-decline / give-up timeout in milliseconds. Change this to
// adjust how long a call rings before it cancels itself if nobody picks up.
// (90 000 ms = 1.5 minutes)
export const RING_TIMEOUT_MS = 90 * 1000;

// Web Push public key (VAPID). Generate the keypair with
//   npx web-push generate-vapid-keys
// then paste the public key here and the private key into the send-push
// Appwrite function's env (VAPID_PRIVATE_KEY).
export const VAPID_PUBLIC_KEY = "BDd1jvwR8SlKaP4PclcpsBULsAiMeZKw7_HVWAgNq1AzZopnRWA0-0XH_JdSE7SGIxKoSjIHZK-ge1F4sjkUaw4";
