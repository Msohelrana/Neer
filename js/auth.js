import { account, ID } from "./appwrite.js";

export async function register(email, password, name) {
  await account.create(ID.unique(), email, password, name);
  await account.createEmailPasswordSession(email, password);
  return account.get();
}

export async function login(email, password) {
  await account.createEmailPasswordSession(email, password);
  return account.get();
}

export async function logout() {
  try {
    await account.deleteSession("current");
  } catch {
    /* no active session */
  }
}

export async function getCurrentUser() {
  try {
    return await account.get();
  } catch {
    return null;
  }
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    location.replace("./login.html");
    throw new Error("not_authenticated");
  }
  return user;
}

export async function updateName(newName) {
  return account.updateName(newName);
}

export async function updatePassword(currentPassword, newPassword) {
  return account.updatePassword(newPassword, currentPassword);
}
