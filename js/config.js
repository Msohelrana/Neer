// Firebase project configuration. See README.md for how to obtain these values
// (Firebase console → Project settings → Your apps → Web app → SDK setup).
//
// These values are NOT secret — the Firebase Web config is meant to ship in the
// client. Access is enforced by the Firestore Security Rules (firestore.rules),
// not by hiding this object.
export const firebaseConfig = {
  apiKey: "AIzaSyBHBwV92lcPIg3S-31VZFmy4a1QN7fgDJE",
  authDomain: "neer-fc5ec.firebaseapp.com",
  projectId: "neer-fc5ec",
  storageBucket: "neer-fc5ec.firebasestorage.app",
  messagingSenderId: "123030187882",
  appId: "1:123030187882:web:b8052e3a03f73ee0c4ff13",
  measurementId: "G-51D7D7962R"
};

// Firestore collection names.
export const COL_USERS = "users";
export const COL_CONVERSATIONS = "conversations";
export const COL_MESSAGES = "messages";
export const COL_REACTIONS = "reactions";
export const COL_RECEIPTS = "receipts";
export const COL_SIGNALING = "signaling";
// Message photos are stored as base64 data URLs in their own docs (Firebase
// Storage needs the paid Blaze plan; this keeps attachments on the free plan).
export const COL_MEDIA = "media";

// Admin approval gate.
//  - `approvals/{userId}` docs (created by an admin) grant a user entry. Approval
//    is bound to the email, so changing the account email forces a fresh approval.
//  - `admins/{uid}` docs mark who may write approvals. Create these by hand in the
//    Firebase console (there is no client-side way to grant admin — by design).
// Security rules enforce both (see firestore.rules).
export const COL_APPROVALS = "approvals";
export const COL_ADMINS = "admins";

// Client-side compression target. Photos larger than these get downscaled and
// re-encoded as JPEG before upload — saves bandwidth + storage quota.
export const IMAGE_MAX_DIM = 1280;
export const IMAGE_JPEG_QUALITY = 0.78;

// Voice-call: auto-decline / give-up timeout in milliseconds. Change this to
// adjust how long a call rings before it cancels itself if nobody picks up.
// (90 000 ms = 1.5 minutes)
export const RING_TIMEOUT_MS = 90 * 1000;

// Composer compact → expanded auto-revert. After focusing the input, if the
// user doesn't type within this many ms, the four left-side action buttons
// (+, camera, gallery, mic) come back. Set to 0 to disable.
export const COMPOSER_AUTO_EXPAND_MS = 5 * 1000;
