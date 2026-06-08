import {
  Client,
  Account,
  Databases,
  Query,
  ID,
  Permission,
  Role,
} from "https://cdn.jsdelivr.net/npm/appwrite@16.0.2/+esm";

import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } from "./config.js";

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);

export { Query, ID, Permission, Role };
