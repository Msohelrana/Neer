// <img>/<video> can't send the Appwrite session cookie cross-origin
// (401 → broken media), so files are fetched once with credentials and
// served as same-origin blob URLs, cached per fileId for re-renders.
// Resolves to { url, type } — type distinguishes photos from videos.

import { imageViewBlobUrl, mediaContentType } from "./photos.js";

const blobCache = new Map();   // fileId -> Promise<{ url, type }>
const kindCache = new Map();   // fileId -> Promise<contentType>

export function bubbleMediaUrl(fileId) {
  if (!blobCache.has(fileId)) {
    // Straight to the raw file — server-side previews 403 on Appwrite
    // Cloud's free plan, and photos upload pre-compressed anyway.
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
