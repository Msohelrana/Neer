# Neer — Chat App

A static, vanilla-JS 1-on-1 chat app.
**Backend:** Appwrite Cloud (free tier). **Hosting:** GitHub Pages.

No build step, no npm install — just static files and the Appwrite Web SDK loaded from a CDN.

---

## 1. Appwrite Cloud setup

### 1.1 Create the project
1. Sign up / log in at https://cloud.appwrite.io.
2. **Create project** → name it `Neer` (any name).
3. Copy the **Project ID** from the project settings.

### 1.2 Add a Web platform
1. Project → **Overview** → **Add platform** → **Web**.
2. **Hostname**: add **two** entries:
   - `localhost` (for local testing via `python -m http.server` etc.)
   - `<your-github-username>.github.io` (for production)

### 1.3 Create the database
1. **Databases** → **Create database** → ID: `neer`, name: `neer`.

### 1.4 Create the `users` collection
- **Collection ID**: `users`
- **Permissions** (collection-level):
  - **Create**: Role = `Users` (any logged-in user can create their own profile)
- **Attributes**:

  | key          | type   | size | required |
  |--------------|--------|------|----------|
  | name         | String | 64   | yes      |
  | email        | String | 256  | yes      |
  | lastActiveAt | String | 32   | no       |

- **Indexes**:
  - `email_idx` — key `email`, type `key`, attribute `email` (so future lookups by email work)
- Document-level permissions are set in code (`read: Users`, `update: owner`).

### 1.5 Create the `conversations` collection
- **Collection ID**: `conversations`
- **Permissions** (collection-level):
  - **Create**: Role = `Users`
- **Row security**: **ON** (Settings tab → Row security toggle)
- **Attributes**:

  | key          | type   | size | required | array |
  |--------------|--------|------|----------|-------|
  | pairKey      | String | 96   | yes      | no    |
  | participants | String | 64   | yes      | yes   |

- **Indexes**:
  - `pairKey_idx` — key `pairKey`, type `key`, attribute `pairKey`
- Document-level read is granted to `Users` (any logged-in user) so the participants can read the doc; update/delete is restricted to the creator.

### 1.6 Create the `messages` collection
- **Collection ID**: `messages`
- **Permissions** (collection-level):
  - **Create**: Role = `Users`
- **Row security**: **ON** (Settings tab → Row security toggle)
- **Attributes**:

  | key            | type   | size | required |
  |----------------|--------|------|----------|
  | conversationId | String | 64   | yes      |
  | senderId       | String | 64   | yes      |
  | receiverId     | String | 64   | yes      |
  | text           | String | 2000 | yes      |
  | replyToId      | String | 64   | no       |
  | replyToText    | String | 280  | no       |

- **Indexes**:
  - `conversation_idx` — key `conversation_idx`, type `key`, attribute `conversationId`
- Document-level read is granted to `Users`; update/delete is restricted to the sender.

### 1.6.5 Create the `pushSubscriptions` collection (optional — for true closed-app push)

See `functions/send-push/README.md` for the full setup. Schema in brief:

- **Collection ID**: `pushSubscriptions`
- **Permissions** (collection-level) — **Create**: `Users`
- **Row security**: ON
- **Attributes**:

  | key      | type   | size | required |
  |----------|--------|------|----------|
  | userId   | String | 64   | yes      |
  | endpoint | String | 500  | yes      |
  | p256dh   | String | 256  | yes      |
  | auth     | String | 64   | yes      |

- **Indexes**: `user_idx` on `userId`.

### 1.7 Create the `receipts` collection

Powers the **Sent / Delivered / Seen** label under your last sent message. Each user keeps exactly one row per conversation, marking the timestamp of the most recent message they've seen.

- **Collection ID**: `receipts`
- **Permissions** (collection-level):
  - **Create**: Role = `Users`
- **Row security**: **ON**
- **Attributes**:

  | key            | type   | size | required |
  |----------------|--------|------|----------|
  | conversationId | String | 64   | yes      |
  | userId         | String | 64   | yes      |
  | lastSeenAt     | String | 32   | yes      |

- **Indexes**:
  - `conversation_idx` — type `key`, attribute `conversationId`
- Document-level read is granted to `Users`; update/delete is restricted to the receipt's owner.

### 1.8 Create the `reactions` collection

Powers the **React** action on the message-action sheet (❤️ 😆 😮 😢 😡 👍). Each user can have at most one reaction per message; switching emoji updates the same row.

- **Collection ID**: `reactions`
- **Permissions** (collection-level):
  - **Create**: Role = `Users`
- **Row security**: **ON**
- **Attributes**:

  | key            | type   | size | required |
  |----------------|--------|------|----------|
  | conversationId | String | 64   | yes      |
  | messageId      | String | 64   | yes      |
  | userId         | String | 64   | yes      |
  | emoji          | String | 16   | yes      |

- **Indexes**:
  - `conversation_idx` — type `key`, attribute `conversationId`
- Document-level read is granted to `Users`; update/delete is restricted to the reactor.

---

## 2. Wire up the frontend

Open `js/config.js` and replace the placeholder:

```js
export const APPWRITE_PROJECT_ID = "YOUR_PROJECT_ID";
```

with the Project ID copied in step 1.1. The endpoint defaults to `https://cloud.appwrite.io/v1`; change only if you're self-hosting Appwrite.

---

## 3. Run locally

The app uses ES modules, so it must be served — opening `index.html` via `file://` won't work.

```powershell
# from F:\Neer
python -m http.server 5500
# then open http://localhost:5500
```

Sign up two accounts in two different browser profiles (or one normal + one incognito) and message back and forth.

---

## 4. Deploy to GitHub Pages

1. Create a public repo, e.g. `neer-chat`.
2. Push these files to `main`.
3. Repo → **Settings** → **Pages** → **Source**: `Deploy from a branch`, branch `main`, folder `/ (root)`.
4. Wait ~30s; your site will be live at `https://<user>.github.io/neer-chat/`.
5. Back in Appwrite, make sure that exact hostname is added under **Platforms** (step 1.2).

---

## 5. Project layout

```
F:\Neer
├── index.html         # auth-aware redirect
├── login.html         # email/password sign in + sign up
├── chat.html          # sidebar of users + message thread
├── css/style.css
├── js/
│   ├── config.js      # Appwrite IDs (edit this)
│   ├── appwrite.js    # SDK init
│   ├── auth.js        # register / login / logout
│   ├── users.js       # profile + user listing
│   └── chat.js        # conversations + messages + realtime
└── README.md
```

---

## 6. How it works

- **Auth** — Appwrite Account API with email + password sessions. On signup, a profile document is created in `users` with the account's `$id` as the document ID so users can be looked up by ID.
- **Conversations** — each 1-on-1 thread has a deterministic `pairKey` (`sorted(uidA, uidB).join("_")`) so the same pair always resolves to the same conversation document.
- **Messages** — created with document-level read permissions for both participants; nobody else can see them.
- **Realtime** — `client.subscribe(...)` listens to the messages collection; the client filters by the open conversation ID and renders new bubbles instantly.

---

## 7. Security note (read this)

The Appwrite client SDK only lets a user grant document permissions to *themselves* or to broad roles like `Users`. You can't grant `Permission.read(Role.user(otherUserId))` from the browser, because that would let any user assign access to anyone else's account.

As a result, this project grants `Permission.read(Role.users())` on conversations and messages — meaning **any authenticated user can technically read every chat in the database** via direct API calls, even though the UI only shows you yours. This is fine for a hobby app or portfolio piece. To harden it for real users, switch to one of:

- **Appwrite Teams** — create a team per conversation with both users as members, grant `Role.team(teamId)` on the docs. Membership has to be set up via an invitation flow, though.
- **Appwrite Functions** — a server-side function with an API key creates the doc and sets per-user permissions (`Role.user(meId)` + `Role.user(otherId)`) which API keys *are* allowed to set.

## 8. Next steps (not implemented)

- Last-message preview + unread badges in the sidebar
- Typing indicators (Appwrite presence)
- Image / file attachments via Appwrite Storage
- Push notifications (web push)
