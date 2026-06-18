# Neer — Chat App

A vanilla-JS 1-on-1 chat app.
**Backend:** Firebase (Authentication + Cloud Firestore + Storage). **Build:** Vite. **Hosting:** GitHub Pages.

Realtime messaging, image/video attachments, reactions, read receipts, and WebRTC voice/video
calls — all on Firebase's free **Spark** plan.

---

## 1. Prerequisites

- **Node.js 20+** (for the Vite build).
- A **Firebase project** (free Spark plan is enough).
- The **Firebase CLI** for deploying rules/indexes: `npm install -g firebase-tools`.
- (Optional) The **Google Cloud CLI** (`gcloud`) or `gsutil` for the Storage CORS step.

---

## 2. Firebase setup

### 2.1 Create the project
1. Go to https://console.firebase.google.com → **Add project**. Name it `Neer` (any name).
2. Once created, open **Project settings** (gear icon) → **General** → scroll to **Your apps** →
   **Add app** → **Web** (`</>`). Register it (no Hosting needed).
3. Copy the `firebaseConfig` object shown — you'll paste it in step 3.

### 2.2 Enable Email/Password auth
**Build → Authentication → Get started → Sign-in method →** enable **Email/Password**.

### 2.3 Create Firestore
**Build → Firestore Database → Create database** → start in **production mode** (the rules in this
repo lock it down properly) → pick a region close to your users.

> **No Storage needed.** Firebase Storage now requires the paid Blaze plan, so to stay on the free
> Spark plan this app stores photo attachments as base64 data URLs in a Firestore `media` collection.
> Photos work; **video attachments are not supported** on the free plan (they exceed Firestore's
> ~1 MiB per-document limit).

### 2.4 (Recommended) Route the verification link in-app
By default Firebase verifies email on its own hosted page. To have the link land on this app's
`verify.html` instead: **Authentication → Templates → Email address verification → ✏️ →
Customize action URL** → set it to `https://<your-username>.github.io/<repo>/verify.html`.
(If you skip this, verification still works — Firebase verifies, then redirects to the app, which
detects the verified state on load.)

---

## 3. Wire up the frontend

Open [js/config.js](js/config.js) and replace the placeholder `firebaseConfig` with the object from
step 2.1:

```js
export const firebaseConfig = {
  apiKey: "…",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "…",
  appId: "…",
};
```

These values are **not secret** — the Firebase Web config is meant to ship in the client. Access is
enforced by the Security Rules, not by hiding this object.

---

## 4. Deploy rules & indexes

The repo ships the Security Rules and the composite index the app needs.

```powershell
firebase login
# Put your real project id in .firebaserc (replace YOUR_PROJECT_ID), then:
firebase deploy --only firestore:rules,firestore:indexes
```

This deploys [firestore.rules](firestore.rules) and [firestore.indexes.json](firestore.indexes.json).

---

## 5. Admin & approval gate

A user can only enter the app once an **approval** doc exists for them. Approvals are writable only
by admins (enforced by rules), so users can't approve themselves.

1. **Make yourself an admin** — in the Firestore console, create a collection `admins` with a
   document whose **ID is your auth UID** (find it under Authentication → Users). The document can be
   empty. There is intentionally no in-app way to grant admin.
2. Open [admin.html](admin.html) while signed in as that admin to approve/revoke other users.

Approval is bound to the user's email: changing their account email forces a fresh approval.

---

## 6. Run locally

```powershell
npm install
npm run dev      # Vite dev server, prints a localhost URL
```

Sign up two accounts in two different browser profiles (or one normal + one incognito) and message
back and forth. Verify email via the link, then approve each account (step 5).

---

## 7. Deploy to GitHub Pages

Hosting stays on GitHub Pages; the app is built by GitHub Actions.

1. **Settings → Pages → Source: GitHub Actions** (one-time switch — no longer "Deploy from a branch").
2. Push to `main`. The workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs
   `npm ci` → `npm run build` → publishes `dist/`.
3. Your site goes live at `https://<user>.github.io/<repo>/`.

`vite.config.js` uses `base: "./"`, so the build works whether served from a repo subpath or a
custom-domain root.

---

## 8. Project layout

```
Neer
├── index.html / login.html / chat.html / admin.html / approval.html / verify.html
├── package.json          # deps (firebase) + scripts (dev/build)
├── vite.config.js        # multi-page build, base "./"
├── firebase.json         # rules + indexes config for the CLI
├── .firebaserc           # default project id (edit this)
├── firestore.rules       # Firestore Security Rules
├── firestore.indexes.json
├── .github/workflows/deploy.yml
└── js/
    ├── config.js         # firebaseConfig + collection names (edit this)
    ├── firebase.js       # SDK init + mapDoc() shim + uid()
    ├── auth.js           # register / login / verify / profile
    ├── users.js          # profile docs + roster + presence
    ├── chat.js           # conversations + messages + realtime
    ├── reactions.js / receipts.js / signaling.js
    ├── approval.js       # admin approval gate
    ├── photos.js         # photo attachments (Firestore data URLs)
    └── … (UI: chat-app.js, call*.js, lightbox.js, etc.)
```

---

## 9. Data model (Firestore)

Every doc carries `createdAt` / `updatedAt` server timestamps. The data layer reshapes each snapshot
into an Appwrite-style object with `$id`, `$createdAt`, `$updatedAt` (ISO strings) via `mapDoc()`, so
the UI layer is backend-agnostic.

| Collection | Doc ID | Fields |
|---|---|---|
| `users` | auth UID | `name`, `email`, `lastActiveAt?` |
| `conversations` | `pairKey` (`sorted(uidA,uidB).join("_")`) | `pairKey`, `participants` (2) |
| `messages` | auto | `conversationId`, `senderId`, `receiverId`, `text`, `replyToId?`, `replyToText?`, `imageId?` |
| `reactions` | auto | `conversationId`, `messageId`, `userId`, `emoji` |
| `receipts` | auto | `conversationId`, `userId`, `lastSeenAt` |
| `signaling` | auto | `callId`, `from`, `to`, `type`, `payload` (JSON string) |
| `media` | auto | `conversationId`, `senderId`, `type`, `dataUrl` (base64) |
| `approvals` | approved user's UID | `userId`, `email` |
| `admins` | admin's UID | (marker; empty) |

A message's `imageId` is the id of its `media` doc; the photo itself is a compressed JPEG stored as a
base64 data URL inside that doc (so attachments need no paid Storage bucket).

---

## 10. How it works

- **Auth** — Firebase Email/Password. A profile doc is created in `users` keyed by the auth UID.
- **Conversations** — the deterministic `pairKey` is the conversation's document id, so a pair always
  resolves to the same doc with a direct `getDoc` (no query, no extra index).
- **Realtime** — each subscription is an `onSnapshot` listener scoped by a query (by `conversationId`,
  or `senderId`/`receiverId` for the sidebar); `docChanges()` drives create/update/delete callbacks.
- **Privacy** — Security Rules gate reads on membership of the conversation's `participants` array, so
  a user can only ever read the threads they're in.
- **Attachments** — photos are compressed client-side and stored as data URLs in `media` docs; the
  bubble fetches the doc lazily and caches it.

---

## 11. Known limitations (all from staying on the free Spark plan)

- **No video attachments.** Firestore caps a doc at ~1 MiB — fine for a compressed photo, too small
  for video. Video would need Firebase Storage (Blaze plan).
- **No closed-app push notifications.** Delivering Web Push needs a Cloud Function (Blaze plan).
  In-app realtime (while a tab is open) works fully. To restore push, enable Blaze and add a Cloud
  Function that sends Web Push on new-message writes, then re-implement [js/push.js](js/push.js).
- **No cascade delete.** Deleting an account in the console leaves its profile/messages behind (would
  also need a Cloud Function). Clean up manually or revisit on Blaze.

## 12. Next steps (not implemented)

- Last-message preview + unread badges in the sidebar
- Typing indicators
- Photo + video attachments via Firebase Storage (needs Blaze)
