# send-push

Appwrite Function that delivers a Web Push notification every time a new
message lands in the `messages` collection. Works even when the recipient's
chat tab is closed.

## One-time setup

### 1. Generate VAPID keys

On any machine with Node.js:

```bash
npx web-push generate-vapid-keys
```

Copy the two strings it prints — one **Public Key**, one **Private Key**.

### 2. Wire the public key into the website

Open `js/config.js` and paste the **public** key:

```js
export const VAPID_PUBLIC_KEY = "BHx...long-base64...";
```

Commit + redeploy the static site.

### 3. Create the `pushSubscriptions` collection

In Appwrite Console → Databases → `neer` → Create collection:

- **Collection ID**: `pushSubscriptions`
- **Permissions** → Create: `Users`
- **Row Security**: ON
- **Attributes**:

  | key      | type   | size | required |
  |----------|--------|------|----------|
  | userId   | String | 64   | yes      |
  | endpoint | String | 500  | yes      |
  | p256dh   | String | 256  | yes      |
  | auth     | String | 64   | yes      |

- **Indexes**:
  - `user_idx` — type `key`, attribute `userId`

### 4. Deploy this function

1. **Console → Functions → Create function**
   - Name: `send-push`
   - Runtime: `Node.js 18+` (also works on 25)
   - Public: **off**

2. **Settings**:
   - **Entrypoint**: `src/main.js`
   - **Build commands**: `npm install`
   - **Scopes**: enable
     - `documents.read`
     - `documents.write`
   - **Environment variables**:
     - `VAPID_PUBLIC_KEY`  — same value as in `js/config.js`
     - `VAPID_PRIVATE_KEY` — keep secret, never commit
     - `VAPID_SUBJECT`     — `mailto:youremail@example.com`

3. **Events** → add `databases.*.collections.messages.documents.*.create`

4. **Deployments** → upload `send-push.tar.gz` from this folder (Manual deployment),
   set entrypoint `src/main.js` and build command `npm install`, activate.

### 5. Test

Open chat in two profiles. Have user B send to user A. Close A's tab
completely. Now B sends another message → A gets a system push within
~1 second.

## How it routes the click

The push payload includes `data.otherUserId`. When the recipient taps the
notification, the service worker focuses an existing chat tab (or opens a
new one) and posts `{type: "open-conversation", otherUserId}` to it. The
page listens for that message and calls `openConversation(user)`.

## Free-tier cost

- 1 listDocuments per incoming message (lookup recipient's subs).
- 1 getDocument per incoming message (sender name).
- N Web Push API calls (N = subscriptions for that user; usually 1–3).

Stale endpoints are auto-pruned via 410/404 responses, so the
`pushSubscriptions` collection stays small.
