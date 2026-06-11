import { storage, ID, Permission, Role } from "./appwrite.js";
import { BUCKET_IMAGES, IMAGE_MAX_DIM, IMAGE_JPEG_QUALITY } from "./config.js";

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

// Images are downscaled client-side; videos can't be transcoded in the
// browser, so they upload as-is (size-capped by the caller).
export async function uploadMessageMedia(file, meId) {
  const payload = file.type.startsWith("video/") ? file : await compressImage(file);
  return storage.createFile(BUCKET_IMAGES, ID.unique(), payload, [
    Permission.read(Role.users()),
    Permission.update(Role.user(meId)),
    Permission.delete(Role.user(meId)),
  ]);
}

// Bandwidth-friendly preview URL — Appwrite resizes server-side and caches.
export function imagePreviewUrl(fileId, width = 800) {
  return storage.getFilePreview(BUCKET_IMAGES, fileId, width);
}

// Full-resolution view URL — opened when the user taps a bubble image.
export function imageViewUrl(fileId) {
  return storage.getFileView(BUCKET_IMAGES, fileId);
}

// Cross-origin `<img>` tags can't carry the session cookie, so a bucket with
// Read=Users will 401 the request and the browser shows a broken-image icon.
// fetch() with credentials does send the cookie, so we pull the bytes once and
// hand back a same-origin blob URL the <img> can render. Callers MUST revoke
// the URL (revoke on img load/error works well).
// Both resolve to { url, type } — the MIME type tells the caller whether the
// file is a photo or a video.
export async function imagePreviewBlobUrl(fileId, width = 800) {
  const url = storage.getFilePreview(BUCKET_IMAGES, fileId, width);
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Preview fetch failed: " + res.status);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}
export async function imageViewBlobUrl(fileId) {
  const url = storage.getFileView(BUCKET_IMAGES, fileId);
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("View fetch failed: " + res.status);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}
