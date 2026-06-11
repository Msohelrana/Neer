import { account, ID } from "./appwrite.js";

const ME_KEY = "neer:me";

function cacheMe(user) {
  try { localStorage.setItem(ME_KEY, JSON.stringify(user)); } catch {}
}
function readCachedMe() {
  try { return JSON.parse(localStorage.getItem(ME_KEY) || "null"); }
  catch { return null; }
}
function clearCachedMe() {
  try { localStorage.removeItem(ME_KEY); } catch {}
}

export async function register(email, password, name) {
  await account.create(ID.unique(), email, password, name);
  await account.createEmailPasswordSession(email, password);
  const user = await account.get();
  cacheMe(user);
  return user;
}

export async function login(email, password) {
  await account.createEmailPasswordSession(email, password);
  const user = await account.get();
  cacheMe(user);
  return user;
}

export async function logout() {
  clearCachedMe();
  try {
    await account.deleteSession("current");
  } catch {
    /* no active session */
  }
}

export async function getCurrentUser() {
  try {
    const user = await account.get();
    cacheMe(user);
    return user;
  } catch {
    return null;
  }
}

// Returns the signed-in user. When offline, returns the cached user without
// hitting the network — otherwise a reload while offline would kick the user
// to the login page. Only redirects to login if both the network call AND the
// cache miss.
export async function requireAuth() {
  if (navigator.onLine === false) {
    const cached = readCachedMe();
    if (cached) return cached;
    location.replace("./login.html");
    throw new Error("not_authenticated");
  }
  try {
    const user = await account.get();
    cacheMe(user);
    return user;
  } catch (err) {
    // Network blip with a previously-known user → trust the cache rather than
    // bouncing them out. A real auth failure with a cache miss still redirects.
    const cached = readCachedMe();
    if (cached) return cached;
    location.replace("./login.html");
    throw err;
  }
}

// ----- Email verification -----
// Sends the verification mail; the link lands on verify.html with
// userId+secret query params. Requires an active session.
export async function sendVerificationEmail() {
  const url = new URL("verify.html", location.href).href;
  return account.createVerification(url);
}

// Called from verify.html with the params from the emailed link.
export async function confirmVerification(userId, secret) {
  return account.updateVerification(userId, secret);
}

export async function updateName(newName) {
  return account.updateName(newName);
}

export async function updatePassword(currentPassword, newPassword) {
  return account.updatePassword(newPassword, currentPassword);
}

// Changing the email un-verifies the account in Appwrite, so the caller must
// restart the verification (and admin approval) flow.
export async function updateEmail(newEmail, password) {
  const user = await account.updateEmail(newEmail, password);
  cacheMe(user);
  return user;
}
