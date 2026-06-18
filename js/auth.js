import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  applyActionCode,
  updateProfile,
  updatePassword as fbUpdatePassword,
  updateEmail as fbUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";

const ME_KEY = "neer:me";

// Map a Firebase User into the Appwrite-style object the rest of the app reads:
// `$id`, `name`, `email`, `emailVerification`. Keeping these field names means
// the UI/HTML (which checks user.$id, user.emailVerification, etc.) is unchanged.
function shape(user) {
  if (!user) return null;
  return {
    $id: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    emailVerification: !!user.emailVerified,
  };
}

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

// Firebase restores the session asynchronously on load. This resolves with the
// first definitive auth state so getCurrentUser/requireAuth can await it.
let firstAuthState = null;
function awaitFirstAuthState() {
  if (!firstAuthState) {
    firstAuthState = new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        resolve(user);
      });
    });
  }
  return firstAuthState;
}

export async function register(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
  const user = shape(cred.user);
  cacheMe(user);
  return user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const user = shape(cred.user);
  cacheMe(user);
  return user;
}

export async function logout() {
  clearCachedMe();
  try {
    await signOut(auth);
  } catch {
    /* no active session */
  }
}

export async function getCurrentUser() {
  const fbUser = auth.currentUser || (await awaitFirstAuthState());
  if (!fbUser) return null;
  // Pull fresh emailVerified/displayName in case it changed elsewhere.
  try { await fbUser.reload(); } catch {}
  const user = shape(auth.currentUser || fbUser);
  cacheMe(user);
  return user;
}

// Returns the signed-in user. When offline, returns the cached user without
// hitting the network — otherwise a reload while offline would kick the user
// to the login page. Only redirects to login if both the lookup AND the cache miss.
export async function requireAuth() {
  if (navigator.onLine === false) {
    const cached = readCachedMe();
    if (cached) return cached;
    location.replace("./login.html");
    throw new Error("not_authenticated");
  }
  try {
    const fbUser = auth.currentUser || (await awaitFirstAuthState());
    if (!fbUser) {
      const cached = readCachedMe();
      if (cached) return cached;
      location.replace("./login.html");
      throw new Error("not_authenticated");
    }
    const user = shape(fbUser);
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
// Sends the verification mail. The link lands on the configured action handler;
// set the custom action URL to verify.html in the Firebase console so the
// oobCode is handled in-app (see README). `url` is the post-verify continue URL.
export async function sendVerificationEmail() {
  if (!auth.currentUser) throw new Error("not_authenticated");
  const url = new URL("verify.html", location.href).href;
  return sendEmailVerification(auth.currentUser, { url });
}

// Called from verify.html with the oobCode from the emailed link.
export async function confirmVerification(oobCode) {
  await applyActionCode(auth, oobCode);
  if (auth.currentUser) { try { await auth.currentUser.reload(); } catch {} }
}

export async function updateName(newName) {
  if (!auth.currentUser) throw new Error("not_authenticated");
  await updateProfile(auth.currentUser, { displayName: newName });
  cacheMe(shape(auth.currentUser));
}

// Firebase requires a recent login for sensitive changes, so we reauthenticate
// with the current password before updating.
async function reauth(currentPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("not_authenticated");
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  return user;
}

export async function updatePassword(currentPassword, newPassword) {
  const user = await reauth(currentPassword);
  return fbUpdatePassword(user, newPassword);
}

// Changing the email un-verifies the account, so the caller must restart the
// verification (and admin approval) flow.
export async function updateEmail(newEmail, password) {
  const user = await reauth(password);
  await fbUpdateEmail(user, newEmail);
  const shaped = shape(auth.currentUser);
  cacheMe(shaped);
  return shaped;
}
