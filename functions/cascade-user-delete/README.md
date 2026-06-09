# cascade-user-delete

Appwrite Function that fires when an Auth account is deleted and cascades the
removal into the database — deletes the matching `users` profile document, all
messages the user sent or received, conversations they participated in, and
reactions they placed. Result: deleting an account in the Appwrite Console
removes that person from the sidebar of every other client instantly (via the
realtime delete event on the `users` collection).

## Deploy

1. **Console → Functions → Create function**
   - Name: `cascade-user-delete`
   - Runtime: `Node.js 18.0` (or newer)
   - Execute access: leave default (executed by Appwrite, not users).

2. **Settings tab**:
   - **Entrypoint**: `src/main.js`
   - **Commands**: `npm install`
   - **Permissions** (scopes the dynamic API key gets): tick
     - `users.read`
     - `documents.read`
     - `documents.write`

3. **Events tab** → add: `users.*.delete`

4. **Deployments** → **Manually with CLI** (or zip-upload the folder). With the
   Appwrite CLI from this folder:

   ```bash
   appwrite functions create-deployment \
     --function-id=cascade-user-delete \
     --entrypoint='src/main.js' \
     --code='.' \
     --activate=true
   ```

   Or just zip the contents of `functions/cascade-user-delete/` and upload via
   the Console → Deployments → Create deployment → "Manual".

## How it works

Triggered automatically by `users.*.delete`. The event payload's `$id` is the
deleted account's user id. The function:

1. Deletes `users/<userId>` profile document (404 is ignored).
2. Pages through `messages` where `senderId == userId`, deletes each.
3. Pages through `messages` where `receiverId == userId`, deletes each.
4. Pages through `conversations` where `userId ∈ participants`, deletes each.
5. Pages through `reactions` where `userId == userId`, deletes each.

Pages are 100 docs at a time using cursor pagination, so it scales to
accounts with thousands of messages without timing out.
