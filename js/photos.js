import { db } from "./firebase.js";
import { collection, doc, addDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { COL_MEDIA, IMAGE_MAX_DIM, IMAGE_JPEG_QUALITY } from "./config.js";

// Firebase Storage requires the paid Blaze plan, so on the free plan we keep
// message photos in Firestore instead: each attachment is its own `media` doc
// holding a base64 data URL of the compressed image. Messages reference it by
// id (`imageId`), and the bubble fetches the media doc lazily on render.
//
// Firestore caps a document at ~1 MiB, so this works for photos (compressed to
// a few hundred KB) but NOT for video — video attachments are unsupported here.

const MAX_DATAURL_BYTES = 1_000_000; // headroom under Firestore's ~1 MiB doc cap

// Downscale + re-encode an image File to JPEG via <canvas>. Big phone photos
// (4–10 MB) routinely shrink to ~150–300 KB this way without visible loss.
export function compressImage(file, maxDim = IMAGE_MAX_DIM, quality = IMAGE_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width  = Math.round(width  * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objectUrl);
        if (!blob) return reject(new Error("Canvas toBlob failed"));
        const name = (file.name || "photo").replace(/\.\w+$/, "") + ".jpg";
        resolve(new File([blob], name, { type: "image/jpeg" }));
      }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image decode failed")); };
    img.src = objectUrl;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Compress a photo and store it as a `media` doc. Returns an Appwrite-style
 * { $id } where $id is the media doc id (stored as the message's imageId).
 * Throws on video, or on an image too large to fit a Firestore doc even after
 * a second, harder compression pass.
 */
export async function uploadMessageMedia(file, meId, conversationId) {
  if (file.type.startsWith("video/")) {
    throw new Error("Video attachments aren't supported on the free plan.");
  }

  let compressed = await compressImage(file);
  let dataUrl = await fileToDataUrl(compressed);
  if (dataUrl.length > MAX_DATAURL_BYTES) {
    // Second pass: smaller + lower quality before giving up.
    compressed = await compressImage(file, 1024, 0.6);
    dataUrl = await fileToDataUrl(compressed);
  }
  if (dataUrl.length > MAX_DATAURL_BYTES) {
    throw new Error("Image is too large to send (try a smaller photo).");
  }

  const ref = await addDoc(collection(db, COL_MEDIA), {
    conversationId,
    senderId: meId,
    type: "image/jpeg",
    dataUrl,
    createdAt: serverTimestamp(),
  });
  return { $id: ref.id };
}

// Resolves to { url, type } — url is the stored data URL (usable directly as an
// <img>/<video> src). Used via media-cache.js, which caches the promise.
export async function imageViewBlobUrl(fileId) {
  const snap = await getDoc(doc(db, COL_MEDIA, fileId));
  if (!snap.exists()) throw new Error("media not found");
  const data = snap.data();
  return { url: data.dataUrl, type: data.type || "image/jpeg" };
}

// MIME type for a media doc — used to decide photo vs. video before rendering.
export async function mediaContentType(fileId) {
  const snap = await getDoc(doc(db, COL_MEDIA, fileId));
  if (!snap.exists()) throw new Error("media not found");
  return snap.data().type || "image/jpeg";
}
