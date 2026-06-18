// Each media doc (a base64 data URL in Firestore) is fetched once and cached
// per fileId so re-renders don't re-read it. Resolves to { url, type }.

import { imageViewBlobUrl, mediaContentType } from "./photos.js";

const blobCache = new Map();   // fileId -> Promise<{ url, type }>
const kindCache = new Map();   // fileId -> Promise<contentType>

export function bubbleMediaUrl(fileId) {
  if (!blobCache.has(fileId)) {
    const p = imageViewBlobUrl(fileId).catch((err) => {
      blobCache.delete(fileId); // allow retry on next render
      throw err;
    });
    blobCache.set(fileId, p);
  }
  return blobCache.get(fileId);
}

// MIME type per file (HEAD request — no body), cached.
export function mediaKind(fileId) {
  if (!kindCache.has(fileId)) {
    const p = mediaContentType(fileId).catch((err) => {
      kindCache.delete(fileId);
      throw err;
    });
    kindCache.set(fileId, p);
  }
  return kindCache.get(fileId);
}
