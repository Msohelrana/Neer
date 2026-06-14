// Main entry point for chat.html.
//
// This module wires up the chat shell: auth gate, message rendering,
// reactions, receipts, the action sheet, conversations, the composer
// (text + emoji + photos + reply), settings, and the live realtime
// subscriptions. Self-contained UI pieces (lightbox, camera, call UI,
// emoji picker) live in their own modules and are mounted from here.

import {
  requireAuth,
  logout,
  updateName,
  updatePassword,
  updateEmail,
  sendVerificationEmail,
} from "./auth.js";
import {
  ensureProfile,
  listOtherUsers,
  updateProfileName,
  updateProfileEmail,
  subscribeUsers,
  heartbeat,
} from "./users.js";
import {
  getOrCreateConversation,
  loadMessages,
  sendMessage,
  editMessage,
  markDeleted,
  DELETED_SENTINEL,
  subscribeMessages,
  subscribeAllMessages,
} from "./chat.js";
import {
  loadReactions,
  createReaction,
  updateReaction,
  removeReaction,
  subscribeReactions,
} from "./reactions.js";
import {
  loadReceipts,
  createReceipt,
  updateReceipt,
  subscribeReceipts,
} from "./receipts.js";
import { enablePush } from "./push.js";
import { dialogAlert, dialogConfirm } from "./dialog.js";
import { COMPOSER_AUTO_EXPAND_MS } from "./config.js";
import {
  getCachedMessages,
  appendCachedMessage,
  updateCachedMessage,
  removeCachedMessage,
  getHiddenIds,
  hideMessageLocally,
  getCachedUserList,
  saveCachedUserList,
  upsertCachedUser,
  removeCachedUser,
  getCachedConversation,
  saveCachedConversation,
  deleteCachedConversation,
  getDeletedAt,
  getLastSeen,
  markSeen,
  getMyReceiptId,
  saveMyReceiptId,
} from "./cache.js";
import { getTheme, setTheme } from "./theme.js";
import {
  getOutbox,
  enqueueOutbox,
  removeFromOutbox,
  outboxForConversation,
} from "./outbox.js";
import { uploadMessageMedia, imageViewUrl } from "./photos.js";
import { isApproved, isAdmin } from "./approval.js";

import { paintAvatar, avatarHue, avatarInitial } from "./avatar.js";
import { showToast } from "./toast.js";
import { bubbleMediaUrl, mediaKind } from "./media-cache.js";
import { setupEmojiPicker } from "./emoji-picker.js";
import { setupLightbox } from "./lightbox.js";
import { setupCamera } from "./camera.js";
import { setupCallUI } from "./call-ui.js";

// ============================================================
// Auth gate
// ============================================================

const me = await requireAuth();
// Unverified accounts wait at the verify screen (skip when offline — the
// cached user can't re-verify without a network anyway).
if (me.emailVerification === false && navigator.onLine !== false) {
  location.replace("./verify.html");
  throw new Error("email_not_verified");
}
// Verified accounts also need an admin's approval (admins skip the gate).
if (navigator.onLine !== false &&
    !(await isApproved(me.$id, me.email)) && !(await isAdmin())) {
  location.replace("./approval.html");
  throw new Error("not_approved");
}
await ensureProfile(me);

// ============================================================
// Offline state
// ============================================================

let online = navigator.onLine !== false;
const offlineBanners = document.querySelectorAll("[data-offline-banner]");
function isOffline() { return !online; }
function setOnlineUI(isOn) {
  online = isOn;
  offlineBanners.forEach((el) => el.classList.toggle("hidden", isOn));
  if (isOn) flushOutbox().catch((e) => console.warn("Outbox flush:", e?.message));
}
window.addEventListener("online",  () => setOnlineUI(true));
window.addEventListener("offline", () => setOnlineUI(false));
setOnlineUI(online);

// ============================================================
// Viewport — match the chat container to the visible viewport so the
// mobile soft keyboard doesn't overlap the composer.
// ============================================================

function syncAppHeight() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--app-h", h + "px");
  const m = document.getElementById("messages");
  if (m) m.scrollTop = m.scrollHeight;
}
syncAppHeight();
window.visualViewport?.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("scroll", syncAppHeight);
window.addEventListener("resize", syncAppHeight);

// ============================================================
// Header paint + logout
// ============================================================

document.getElementById("me-name").textContent = me.name || me.email;
paintAvatar(document.getElementById("me-avatar"), me.$id, me.name || me.email);

document.getElementById("logout-btn").addEventListener("click", async () => {
  await logout();
  location.replace("./login.html");
});

// ============================================================
// Core DOM refs + state
// ============================================================

const userListEl = document.getElementById("user-list");
const headerEl   = document.getElementById("thread-title");
const messagesEl = document.getElementById("messages");
const composerEl = document.getElementById("composer");
const inputEl    = document.getElementById("composer-input");
const chatEl     = document.getElementById("chat");

let activeConversation = null;
let activeOther = null;
let unsubscribe = null;
const renderedIds = new Set();
const bubbleMap = new Map();    // messageId -> bubble element
const messageMap = new Map();   // messageId -> latest message object
const reactionsMap = new Map(); // messageId -> array of reaction docs
const receiptsMap  = new Map(); // userId -> lastSeenAt (active conv only)
let hiddenIds = new Set();
let pendingReply = null;
let unsubscribeReactions = null;
let unsubscribeReceipts  = null;

const REACTION_EMOJIS = ["❤️", "😆", "😮", "😢", "😡", "👍"];
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

// Modules mounted later; declared with `let` so the popstate handler (which
// runs before the user can interact) can safely reference them.
let camera, lightbox, callUI, emojiPicker;

// ============================================================
// Lazy media loading — bubbles only fetch when scrolled near
// ============================================================

const mediaObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    mediaObserver.unobserve(en.target);
    en.target._loadMedia?.();
  }
}, { root: messagesEl, rootMargin: "600px 0px" });

// Coalesce bottom-snaps to one per frame.
let scrollPending = false;
let bulkRender = false;  // true while painting cached history
let historyStart = 0;    // index into cached list where rendering begins
function scheduleScrollToBottom() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "instant" });
  });
}

const scrollBottomBtn = document.getElementById("scroll-bottom");
let stickToBottom = true;
messagesEl.addEventListener("scroll", () => {
  const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  stickToBottom = dist < 80;
  scrollBottomBtn.classList.toggle("hidden", dist < 300);
}, { passive: true });
scrollBottomBtn.addEventListener("click", () => {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
});

// ============================================================
// Tiny helpers
// ============================================================

function isOnline(user) {
  if (!user?.lastActiveAt) return false;
  const t = new Date(user.lastActiveAt).getTime();
  return Number.isFinite(t) && (Date.now() - t) < ONLINE_THRESHOLD_MS;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isDeleted(msg) {
  return msg?.text === DELETED_SENTINEL;
}

// Detect/parse call-event messages encoded as `__CALL__{json}` in `text`.
function parseCallEvent(text) {
  if (!text || !text.startsWith("__CALL__")) return null;
  try { return JSON.parse(text.slice(8)); } catch { return {}; }
}
function formatCallSummary(info, isMine) {
  const status = info?.status || "ended";
  const duration = info?.duration || 0;
  const isVideo = info?.media === "video";
  const kindLabel = isVideo ? "Video call" : "Voice call";
  if (status === "accepted" && duration > 0) {
    const mm = Math.floor(duration / 60);
    const ss = String(duration % 60).padStart(2, "0");
    return { label: `${kindLabel} · ${mm}:${ss}`, missed: false };
  }
  const missedLabel = isVideo ? "Missed video call" : "Missed voice call";
  return { label: isMine ? "No answer" : missedLabel, missed: true };
}
function paintCallEvent(bubble, msg) {
  const info = parseCallEvent(msg.text);
  const isVideo = info?.media === "video";
  const { label, missed } = formatCallSummary(info, msg.senderId === me.$id);
  bubble.innerHTML = "";
  const icon = document.createElement("span");
  icon.className = "call-event-icon" + (missed ? " missed" : "");
  icon.innerHTML = isVideo
    ? `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M17 10.5V7c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-3.5l4 4v-11l-4 4z" fill="currentColor"/></svg>`
    : `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.4 21 3 13.6 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.2 2.3z" fill="currentColor"/></svg>`;
  const text = document.createElement("span");
  text.className = "call-event-text";
  text.textContent = label;
  const time = document.createElement("span");
  time.className = "call-event-time";
  time.textContent = formatTime(msg.$createdAt);
  bubble.append(icon, text, time);
}

// ============================================================
// Bubble rendering
// ============================================================

function paintBubbleContent(bubble, msg) {
  if (parseCallEvent(msg.text)) {
    paintCallEvent(bubble, msg);
    return;
  }
  if (isDeleted(msg)) {
    bubble.innerHTML = "";
    bubble.classList.add("removed");
    bubble.classList.remove("has-image");
    const span = document.createElement("span");
    span.className = "bubble-text removed-text";
    span.textContent = msg.senderId === me.$id ? "You removed a message" : "Message removed";
    bubble.appendChild(span);
    return;
  }
  bubble.classList.remove("removed");
  const edited = msg.$updatedAt && msg.$updatedAt !== msg.$createdAt;
  const isMine = msg.senderId === me.$id;
  bubble.innerHTML = "";

  if (!isMine && activeOther) {
    const av = document.createElement("span");
    av.className = "bubble-avatar";
    av.textContent = avatarInitial(activeOther.name || activeOther.email);
    av.style.setProperty("--hue", String(avatarHue(activeOther.$id)));
    av.setAttribute("aria-hidden", "true");
    bubble.appendChild(av);
  }

  if (msg.replyToId && msg.replyToText) {
    const quote = document.createElement("div");
    quote.className = "bubble-quote";
    const lbl = document.createElement("span");
    lbl.className = "bubble-quote-label";
    lbl.textContent = "↩ Reply";
    const qtxt = document.createElement("span");
    qtxt.className = "bubble-quote-text";
    qtxt.textContent = msg.replyToText;
    quote.append(lbl, qtxt);
    quote.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = bubbleMap.get(msg.replyToId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("highlight");
        setTimeout(() => target.classList.remove("highlight"), 1200);
      }
    });
    bubble.appendChild(quote);
  }

  const hasImage = !!(msg.imageId || msg._localImageUrl);
  bubble.classList.toggle("has-image", hasImage);
  if (hasImage) {
    const frame = document.createElement("div");
    frame.className = "bubble-image-frame";
    const buildMedia = (url, type) => {
      if (type && type.startsWith("video/")) {
        const v = document.createElement("video");
        v.className = "bubble-image";
        v.src = url;
        v.controls = true;
        v.playsInline = true;
        v.preload = "metadata";
        v.addEventListener("loadedmetadata", () => {
          if (stickToBottom) scheduleScrollToBottom();
        }, { once: true });
        return v;
      }
      const img = document.createElement("img");
      img.className = "bubble-image";
      img.alt = "Photo";
      img.loading = "lazy";
      img.src = url;
      img.addEventListener("load", () => {
        if (stickToBottom) scheduleScrollToBottom();
      }, { once: true });
      if (msg.imageId) {
        img.addEventListener("click", (e) => {
          e.stopPropagation();
          lightbox?.open(msg.imageId);
        });
      }
      return img;
    };
    const showFail = () => {
      frame.innerHTML = "";
      const fail = document.createElement("span");
      fail.className = "bubble-text";
      fail.textContent = "Media unavailable";
      frame.appendChild(fail);
    };
    if (msg._localImageUrl) {
      frame.appendChild(buildMedia(msg._localImageUrl, msg._localMime || "image/jpeg"));
    } else {
      const fileId = msg.imageId;
      frame._loadMedia = async () => {
        try {
          const kind = await mediaKind(fileId);
          if (kind.startsWith("video/")) {
            const ph = document.createElement("button");
            ph.type = "button";
            ph.className = "bubble-image video-placeholder";
            ph.setAttribute("aria-label", "Play video");
            ph.innerHTML = `<svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.25)"/><path d="M10 8l6 4-6 4z" fill="#fff"/></svg>`;
            ph.addEventListener("click", async (e) => {
              e.stopPropagation();
              ph.disabled = true;
              ph.classList.add("loading");
              try {
                const { url, type } = await bubbleMediaUrl(fileId);
                const v = buildMedia(url, type || "video/mp4");
                ph.replaceWith(v);
                v.play?.().catch(() => {});
              } catch {
                ph.disabled = false;
                ph.classList.remove("loading");
                showToast("Video failed to load");
              }
            });
            frame.appendChild(ph);
            if (stickToBottom) scheduleScrollToBottom();
          } else {
            const { url, type } = await bubbleMediaUrl(fileId);
            frame.appendChild(buildMedia(url, type));
          }
        } catch {
          showFail();
        }
      };
      mediaObserver.observe(frame);
    }
    bubble.appendChild(frame);
  }

  if (msg.text) {
    const textSpan = document.createElement("span");
    textSpan.className = "bubble-text";
    textSpan.textContent = msg.text;
    bubble.appendChild(textSpan);
  }

  bubble.classList.toggle("pending", !!msg._pending);
  if (msg._pending) {
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = "Sending…";
    bubble.appendChild(time);
  } else if (edited) {
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = "edited";
    bubble.appendChild(time);
  }

  const menuBtn = document.createElement("button");
  menuBtn.className = "bubble-menu-btn";
  menuBtn.type = "button";
  menuBtn.textContent = "⋯";
  menuBtn.setAttribute("aria-label", "Message actions");
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const latest = messageMap.get(msg.$id) || msg;
    openMsgSheet(latest, bubble);
  });
  bubble.appendChild(menuBtn);
}

// ============================================================
// Time dividers — every message owns one; anchors stay visible.
// ============================================================

const dividerMap = new Map();
const anchorIds = new Set();
let shownDividerId = null;
let lastAnchorTime = null;
const ANCHOR_GAP_MS = 60 * 60 * 1000;

function formatDivider(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfToday.getDate() - 1);
  if (d >= startOfToday) return time;
  if (d >= startOfYesterday) return "YESTERDAY AT " + time;
  const weekStart = new Date(startOfToday); weekStart.setDate(startOfToday.getDate() - 6);
  if (d >= weekStart) {
    return d.toLocaleDateString([], { weekday: "short" }).toUpperCase() + " AT " + time;
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" }).toUpperCase() + " AT " + time;
}

function appendDivider(msg) {
  const t = new Date(msg.$createdAt).getTime();
  const isAnchor = !lastAnchorTime || (t - new Date(lastAnchorTime).getTime()) >= ANCHOR_GAP_MS;
  const div = document.createElement("div");
  div.className = "time-divider" + (isAnchor ? "" : " hidden");
  div.textContent = formatDivider(msg.$createdAt);
  div.dataset.id = msg.$id;
  messagesEl.appendChild(div);
  dividerMap.set(msg.$id, div);
  if (isAnchor) {
    anchorIds.add(msg.$id);
    lastAnchorTime = msg.$createdAt;
  }
}
function hideShownDivider() {
  if (!shownDividerId) return;
  if (anchorIds.has(shownDividerId)) { shownDividerId = null; return; }
  const el = dividerMap.get(shownDividerId);
  if (el) el.classList.add("hidden");
  shownDividerId = null;
}
function showOnlyDivider(messageId) {
  hideShownDivider();
  const el = dividerMap.get(messageId);
  if (!el) return;
  el.classList.remove("hidden");
  shownDividerId = messageId;
}
function toggleDivider(messageId) {
  if (anchorIds.has(messageId)) return;
  if (shownDividerId === messageId) hideShownDivider();
  else showOnlyDivider(messageId);
}

// ============================================================
// Message render / update / delete
// ============================================================

function renderMessage(msg) {
  if (hiddenIds.has(msg.$id)) return;
  if (renderedIds.has(msg.$id)) return;
  renderedIds.add(msg.$id);
  messageMap.set(msg.$id, msg);
  messagesEl.querySelector(".empty-conv")?.remove();
  appendDivider(msg);
  const wrap = document.createElement("div");
  const isCall = !!parseCallEvent(msg.text);
  wrap.className = isCall
    ? "bubble system call-event"
    : "bubble " + (msg.senderId === me.$id ? "me" : "them");
  wrap.dataset.id = msg.$id;
  if (bulkRender) wrap.style.animation = "none";
  paintBubbleContent(wrap, msg);
  if (!isCall && !isDeleted(msg)) bindBubbleLongPress(wrap, msg.$id);
  // Messenger-style: 2+ consecutive caption-less photos from the same
  // sender collapse into a .photo-run tile grid.
  const isPhotoOnly = !isCall && !isDeleted(msg) &&
    (msg.imageId || msg._localImageUrl) && !msg.text &&
    !(msg._localMime && msg._localMime.startsWith("video/"));
  const side = msg.senderId === me.$id ? "me" : "them";
  const divider = dividerMap.get(msg.$id);
  const prev = divider.previousElementSibling;
  let grouped = false;
  function showPhotoTime(run) {
    if (msg._pending || run?.dataset.timeShown) return;
    divider.classList.remove("hidden");
    anchorIds.add(msg.$id);
    if (run) run.dataset.timeShown = "1";
  }
  if (isPhotoOnly && !anchorIds.has(msg.$id)) {
    if (prev?.classList.contains("photo-run") && prev.classList.contains(side)) {
      prev.appendChild(wrap);
      messagesEl.insertBefore(divider, prev);
      grouped = true;
      showPhotoTime(prev);
    } else if (prev?.classList.contains("bubble") && prev.classList.contains(side) &&
               prev.classList.contains("has-image") && !prev.querySelector(".bubble-text")) {
      const run = document.createElement("div");
      run.className = "photo-run " + side;
      messagesEl.insertBefore(run, prev);
      run.append(prev, wrap);
      messagesEl.insertBefore(divider, run);
      grouped = true;
      if (anchorIds.has(prev.dataset.id)) run.dataset.timeShown = "1";
      else showPhotoTime(run);
    }
  }
  if (!grouped) {
    messagesEl.appendChild(wrap);
    if (isPhotoOnly) showPhotoTime(null);
  }
  bubbleMap.set(msg.$id, wrap);
  paintReactions(msg.$id);
  if (!bulkRender) scheduleScrollToBottom();
}

function showEmptyConvState() {
  if (!activeOther) return;
  if (messagesEl.querySelector(".bubble")) return;
  if (messagesEl.querySelector(".empty-conv")) return;
  const el = document.createElement("div");
  el.className = "empty-conv";
  el.innerHTML = `
    <div class="empty-conv-avatar avatar" aria-hidden="true"></div>
    <div class="empty-conv-name"></div>
    <div class="empty-conv-sub"></div>
  `;
  paintAvatar(el.querySelector(".avatar"), activeOther.$id, activeOther.name || activeOther.email);
  el.querySelector(".empty-conv-name").textContent = activeOther.name;
  el.querySelector(".empty-conv-sub").textContent = "Say hi 👋";
  messagesEl.appendChild(el);
}

function applyMessageUpdate(msg) {
  messageMap.set(msg.$id, msg);
  const bubble = bubbleMap.get(msg.$id);
  if (!bubble) return;
  paintBubbleContent(bubble, msg);
  paintReactions(msg.$id);
}

function applyMessageDelete(messageId) {
  messageMap.delete(messageId);
  reactionsMap.delete(messageId);
  const bubble = bubbleMap.get(messageId);
  if (bubble) {
    const run = bubble.parentElement?.classList.contains("photo-run")
      ? bubble.parentElement : null;
    bubble.remove();
    if (run && !run.children.length) run.remove();
    else if (run && run.children.length === 1) run.replaceWith(run.firstElementChild);
  }
  bubbleMap.delete(messageId);
  renderedIds.delete(messageId);
  const div = dividerMap.get(messageId);
  if (div) div.remove();
  dividerMap.delete(messageId);
  anchorIds.delete(messageId);
  if (shownDividerId === messageId) shownDividerId = null;
  if (!messagesEl.querySelector(".bubble")) showEmptyConvState();
}

// ============================================================
// Reactions
// ============================================================

function paintReactions(messageId) {
  const bubble = bubbleMap.get(messageId);
  if (!bubble) return;
  bubble.querySelector(".bubble-reactions")?.remove();
  const msg = messageMap.get(messageId);
  if (msg && isDeleted(msg)) return;
  const list = reactionsMap.get(messageId) || [];
  if (!list.length) return;
  const groups = new Map();
  list.forEach((r) => {
    const g = groups.get(r.emoji) || { count: 0, mine: false };
    g.count += 1;
    if (r.userId === me.$id) g.mine = true;
    groups.set(r.emoji, g);
  });
  const wrap = document.createElement("div");
  wrap.className = "bubble-reactions";
  for (const [emoji, { count, mine }] of groups.entries()) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bubble-reaction" + (mine ? " mine" : "");
    chip.textContent = count > 1 ? `${emoji} ${count}` : emoji;
    chip.title = mine ? "Tap to remove your reaction" : "Tap to react";
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleReaction(messageId, emoji);
    });
    wrap.appendChild(chip);
  }
  bubble.appendChild(wrap);
}

// Keep at most one reaction per (messageId, userId).
function ingestReaction(r) {
  const list = (reactionsMap.get(r.messageId) || []).filter(
    (x) => x.$id !== r.$id && x.userId !== r.userId
  );
  list.push(r);
  reactionsMap.set(r.messageId, list);
}

function discardReaction(r) {
  const list = (reactionsMap.get(r.messageId) || []).filter(
    (x) => x.$id !== r.$id
  );
  if (list.length) reactionsMap.set(r.messageId, list);
  else reactionsMap.delete(r.messageId);
}

async function toggleReaction(messageId, emoji) {
  if (!activeConversation) return;
  const list = reactionsMap.get(messageId) || [];
  const mine = list.find((r) => r.userId === me.$id);
  const convId = activeConversation.$id;

  if (!mine) {
    const tempId = "tmp_" + messageId + "_" + Date.now();
    ingestReaction({
      $id: tempId, conversationId: convId,
      messageId, userId: me.$id, emoji,
    });
    paintReactions(messageId);
    try {
      const created = await createReaction(convId, messageId, me.$id, emoji);
      ingestReaction(created);
      paintReactions(messageId);
    } catch (err) {
      discardReaction({ $id: tempId, messageId });
      paintReactions(messageId);
      dialogAlert("Reaction failed: " + (err?.message || err));
    }
    return;
  }

  if (mine.emoji === emoji) {
    discardReaction(mine);
    paintReactions(messageId);
    try {
      await removeReaction(mine.$id);
    } catch (err) {
      ingestReaction(mine);
      paintReactions(messageId);
      dialogAlert("Reaction failed: " + (err?.message || err));
    }
    return;
  }

  const prevEmoji = mine.emoji;
  ingestReaction({ ...mine, emoji });
  paintReactions(messageId);
  try {
    await updateReaction(mine.$id, emoji);
  } catch (err) {
    ingestReaction({ ...mine, emoji: prevEmoji });
    paintReactions(messageId);
    dialogAlert("Reaction failed: " + (err?.message || err));
  }
}

// ============================================================
// Read receipts (sent / delivered / seen)
// ============================================================

async function upsertMyReceipt(convId, timestamp) {
  if (!timestamp) return;
  const cachedId = getMyReceiptId(me.$id, convId);
  try {
    if (cachedId) {
      await updateReceipt(cachedId, timestamp);
      return;
    }
    const created = await createReceipt(convId, me.$id, timestamp);
    saveMyReceiptId(me.$id, convId, created.$id);
  } catch (err) {
    if (err?.code === 404) {
      try {
        const created = await createReceipt(convId, me.$id, timestamp);
        saveMyReceiptId(me.$id, convId, created.$id);
      } catch (e) { console.warn("Receipt recreate failed:", e?.message); }
    } else {
      console.warn("Receipt upsert failed:", err?.message || err);
    }
  }
}

function repaintReceiptIndicator() {
  messagesEl.querySelectorAll(".receipt-indicator").forEach((el) => el.remove());
  if (!activeConversation || !activeOther) return;
  const meBubbles = messagesEl.querySelectorAll(".bubble.me");
  if (!meBubbles.length) return;
  const lastMine = meBubbles[meBubbles.length - 1];
  const msg = messageMap.get(lastMine.dataset.id);
  if (!msg) return;
  if (parseCallEvent(msg.text)) return;

  const otherSeenAt = receiptsMap.get(activeOther.$id);
  let status, isSeen = false;
  if (otherSeenAt && otherSeenAt >= msg.$createdAt) {
    status = "Seen"; isSeen = true;
  } else if (otherSeenAt) {
    status = "Delivered";
  } else {
    status = "Sent";
  }

  const ind = document.createElement("div");
  ind.className = "receipt-indicator" + (isSeen ? " seen" : "");
  if (isSeen) {
    const av = document.createElement("span");
    av.className = "receipt-avatar";
    av.textContent = avatarInitial(activeOther.name || activeOther.email);
    av.style.setProperty("--hue", String(avatarHue(activeOther.$id)));
    ind.appendChild(av);
  }
  const txt = document.createElement("span");
  txt.className = "receipt-text";
  txt.textContent = status;
  ind.appendChild(txt);
  const anchor = lastMine.parentElement?.classList.contains("photo-run")
    ? lastMine.parentElement
    : lastMine;
  anchor.insertAdjacentElement("afterend", ind);
}

// ============================================================
// Bubble long-press + reaction popover + action sheet
// ============================================================

function bindBubbleLongPress(bubble, messageId) {
  let timer = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  bubble.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button, a, textarea, input, .bubble-quote, .edit-input")) return;
    fired = false;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => {
      fired = true;
      const msg = messageMap.get(messageId);
      if (msg) openMsgSheet(msg, bubble);
    }, 480);
  });
  bubble.addEventListener("pointermove", (e) => {
    if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel();
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) =>
    bubble.addEventListener(t, cancel)
  );
  bubble.addEventListener("click", (e) => {
    if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; return; }
    if (e.target.closest("button, a, textarea, input, .bubble-quote, .bubble-reaction, .edit-input, .bubble-image")) return;
    toggleDivider(messageId);
  }, true);
  bubble.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const msg = messageMap.get(messageId);
    if (msg) openMsgSheet(msg, bubble);
  });
}

const msgSheet           = document.getElementById("msg-sheet");
const msgSheetActions    = document.getElementById("msg-sheet-actions");
const reactionPopover    = document.getElementById("reaction-popover");

const ICON_REPLY  = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" fill="currentColor"/></svg>`;
const ICON_COPY   = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>`;
const ICON_DELETE = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
const ICON_MORE   = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor"/></svg>`;
const ICON_EDIT   = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
const ICON_BACK   = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_HIDE   = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z" fill="currentColor"/></svg>`;
const ICON_SAVE   = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>`;

function openReactionPopover(msg, bubble) {
  reactionPopover.innerHTML = "";
  const myEmoji = (reactionsMap.get(msg.$id) || [])
    .find((r) => r.userId === me.$id)?.emoji;
  REACTION_EMOJIS.forEach((em) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reaction-popover-btn" + (em === myEmoji ? " active" : "");
    btn.textContent = em;
    btn.setAttribute("aria-label", `React with ${em}`);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMsgSheet();
      toggleReaction(msg.$id, em);
    });
    reactionPopover.appendChild(btn);
  });
  reactionPopover.classList.remove("hidden");
  const rect = bubble.getBoundingClientRect();
  const pRect = reactionPopover.getBoundingClientRect();
  const gap = 8;
  let top = rect.top - pRect.height - gap;
  if (top < 8) top = rect.bottom + gap;
  let left = rect.left + rect.width / 2 - pRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - pRect.width - 8));
  reactionPopover.style.top  = top  + "px";
  reactionPopover.style.left = left + "px";
}

function closeReactionPopover() {
  reactionPopover.classList.add("hidden");
  reactionPopover.innerHTML = "";
}

function openMsgSheet(msg, bubble) {
  if (isDeleted(msg)) return;
  const isMine = msg.senderId === me.$id;
  renderSheetMain(msg, isMine);
  msgSheet.classList.remove("hidden");
  if (bubble) openReactionPopover(msg, bubble);
}

function closeMsgSheet() {
  msgSheet.classList.add("hidden");
  msgSheetActions.innerHTML = "";
  closeReactionPopover();
}

function sheetBtn(label, iconHtml, onClick, variant) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "msg-sheet-action" + (variant ? " msg-sheet-action--" + variant : "");
  btn.innerHTML = `<span class="msg-sheet-action-icon">${iconHtml}</span><span class="msg-sheet-action-label"></span>`;
  btn.querySelector(".msg-sheet-action-label").textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderSheetMain(msg, isMine) {
  msgSheetActions.innerHTML = "";
  msgSheetActions.append(
    sheetBtn("Reply", ICON_REPLY, () => {
      closeMsgSheet();
      setReply(msg);
    }),
  );
  if (msg.imageId) {
    msgSheetActions.appendChild(
      sheetBtn("Save", ICON_SAVE, () => {
        closeMsgSheet();
        saveImage(msg.imageId);
      })
    );
  }
  if (msg.text) {
    msgSheetActions.appendChild(
      sheetBtn("Copy", ICON_COPY, async () => {
        try {
          await navigator.clipboard.writeText(msg.text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = msg.text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch {}
          ta.remove();
        }
        closeMsgSheet();
      })
    );
  }
  msgSheetActions.appendChild(
    sheetBtn("Delete", ICON_DELETE, () => renderSheetDelete(msg, isMine), "danger"),
  );
  if (isMine) {
    msgSheetActions.appendChild(
      sheetBtn("More", ICON_MORE, () => renderSheetMore(msg))
    );
  }
}

function renderSheetDelete(msg, isMine) {
  msgSheetActions.innerHTML = "";
  if (isMine) {
    msgSheetActions.appendChild(
      sheetBtn("For everyone", ICON_DELETE, async () => {
        closeMsgSheet();
        await removeForEveryone(msg);
      }, "danger")
    );
  }
  msgSheetActions.append(
    sheetBtn("For me", ICON_HIDE, () => {
      closeMsgSheet();
      removeForMe(msg);
    }),
    sheetBtn("Back", ICON_BACK, () => renderSheetMain(msg, isMine)),
  );
}

function renderSheetMore(msg) {
  msgSheetActions.innerHTML = "";
  msgSheetActions.append(
    sheetBtn("Edit", ICON_EDIT, () => {
      closeMsgSheet();
      startEdit(msg);
    }),
    sheetBtn("Back", ICON_BACK, () => renderSheetMain(msg, true)),
  );
}

// Generic long-press / right-click binder for sidebar user items.
function bindLongPress(el, onLong, onTap) {
  let fired = false, timer = null, sx = 0, sy = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    fired = false;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { fired = true; onLong(); }, 480);
  });
  el.addEventListener("pointermove", (e) => {
    if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel();
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) => el.addEventListener(t, cancel));
  el.addEventListener("click", (e) => {
    if (fired) { e.stopPropagation(); fired = false; return; }
    onTap?.();
  });
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); onLong(); });
}

function openChatSheet(other) {
  msgSheetActions.innerHTML = "";
  msgSheetActions.append(
    sheetBtn("Delete chat", ICON_DELETE, async () => {
      closeMsgSheet();
      const ok = await dialogConfirm(
        `Delete chat with ${other.name} from this device?\nMessages on the server are not affected.`,
        { okLabel: "Delete", danger: true }
      );
      if (ok) deleteChatLocally(other);
    }, "danger"),
    sheetBtn("Cancel", ICON_BACK, closeMsgSheet),
  );
  msgSheet.classList.remove("hidden");
}

function deleteChatLocally(other) {
  const pairKey = [me.$id, other.$id].sort().join("_");
  const conv = deleteCachedConversation(me.$id, pairKey);
  if (!conv) return;
  if (activeConversation && activeConversation.$id === conv.$id) {
    leaveActiveConversation();
  }
  repaintFromCache();
}

msgSheet.addEventListener("click", (e) => {
  if (e.target.dataset.close !== undefined) closeMsgSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMsgSheet();
    emojiPicker?.close();
  }
});

// ============================================================
// Edit / delete actions
// ============================================================

function startEdit(msg) {
  const bubble = bubbleMap.get(msg.$id);
  if (!bubble) return;
  bubble.innerHTML = "";
  bubble.classList.add("editing");
  const ta = document.createElement("textarea");
  ta.className = "edit-input";
  ta.value = msg.text;
  ta.rows = 1;
  const actions = document.createElement("div");
  actions.className = "edit-actions";
  const save   = document.createElement("button");
  save.type = "button"; save.textContent = "Save";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.textContent = "Cancel";
  actions.append(save, cancel);
  bubble.append(ta, actions);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const restore = () => {
    bubble.classList.remove("editing");
    paintBubbleContent(bubble, msg);
  };

  cancel.addEventListener("click", restore);

  save.addEventListener("click", async () => {
    const next = ta.value.trim();
    if (!next || next === msg.text) { restore(); return; }
    try {
      const updated = await editMessage(msg.$id, next);
      Object.assign(msg, { text: updated.text, $updatedAt: updated.$updatedAt });
      updateCachedMessage(me.$id, activeConversation.$id, msg.$id, {
        text: updated.text, $updatedAt: updated.$updatedAt,
      });
      bubble.classList.remove("editing");
      paintBubbleContent(bubble, msg);
    } catch (err) {
      dialogAlert("Edit failed: " + err.message);
    }
  });

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save.click(); }
    if (e.key === "Escape") cancel.click();
  });
}

async function removeForEveryone(msg) {
  const ok = await dialogConfirm(
    "Remove this message for everyone? This cannot be undone.",
    { okLabel: "Remove", danger: true }
  );
  if (!ok) return;
  try {
    const updated = await markDeleted(msg.$id);
    updateCachedMessage(me.$id, activeConversation.$id, msg.$id, {
      text: DELETED_SENTINEL, $updatedAt: updated.$updatedAt,
    });
    applyMessageUpdate({ ...msg, text: DELETED_SENTINEL, $updatedAt: updated.$updatedAt });
  } catch (err) {
    dialogAlert("Remove failed: " + err.message);
  }
}

function removeForMe(msg) {
  hideMessageLocally(me.$id, msg.$id);
  hiddenIds.add(msg.$id);
  applyMessageDelete(msg.$id);
}

// ============================================================
// History paging — capped initial render, "Show 50 earlier" button.
// ============================================================

const INITIAL_RENDER_CAP = 80;
const HISTORY_CHUNK = 50;

function makeEarlierButton(convId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "load-earlier";
  btn.textContent = `Show ${Math.min(HISTORY_CHUNK, historyStart)} earlier messages`;
  btn.addEventListener("click", () => {
    const cached = getCachedMessages(me.$id, convId);
    const prevTopId = cached[historyStart]?.$id;
    historyStart = Math.max(0, historyStart - HISTORY_CHUNK);
    messagesEl.innerHTML = "";
    mediaObserver.disconnect();
    renderedIds.clear();
    bubbleMap.clear();
    dividerMap.clear();
    anchorIds.clear();
    shownDividerId = null;
    lastAnchorTime = null;
    if (historyStart > 0) messagesEl.appendChild(makeEarlierButton(convId));
    bulkRender = true;
    cached.slice(historyStart).forEach(renderMessage);
    outboxForConversation(me.$id, convId).forEach((item) => {
      renderMessage({
        $id: item.tempId,
        conversationId: convId,
        senderId: me.$id,
        receiverId: item.receiverId,
        text: item.text,
        $createdAt: item.queuedAt,
        $updatedAt: null,
        _pending: true,
        ...(item.reply ? { replyToId: item.reply.id, replyToText: (item.reply.text || "").slice(0, 280) } : {}),
      });
    });
    bulkRender = false;
    reactionsMap.forEach((_, id) => paintReactions(id));
    repaintReceiptIndicator();
    const anchor = prevTopId && bubbleMap.get(prevTopId);
    if (anchor) anchor.scrollIntoView({ block: "start", behavior: "instant" });
    else messagesEl.scrollTop = 0;
  });
  return btn;
}

// ============================================================
// Open / leave conversation
// ============================================================

function leaveActiveConversation() {
  chatEl.dataset.view = "sidebar";
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unsubscribeReactions) { unsubscribeReactions(); unsubscribeReactions = null; }
  if (unsubscribeReceipts)  { unsubscribeReceipts();  unsubscribeReceipts  = null; }
  activeConversation = null;
  activeOther = null;
  receiptsMap.clear();
  document.querySelectorAll(".user-item.active").forEach((el) => el.classList.remove("active"));
  callUI?.updatePill();
  repaintFromCache();
}

async function openConversation(other) {
  activeOther = other;
  headerEl.innerHTML = "";
  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = other.name;
  headerEl.append(nameEl);

  const threadAvatar = document.getElementById("thread-avatar");
  threadAvatar.classList.remove("hidden");
  paintAvatar(threadAvatar, other.$id, other.name || other.email);
  const cachedOther = (getCachedUserList(me.$id)?.users || []).find((x) => x.$id === other.$id);
  threadAvatar.classList.toggle("online", isOnline(cachedOther || other));
  document.getElementById("thread-actions").classList.remove("hidden");
  callUI?.updatePill();

  messagesEl.innerHTML = "";
  mediaObserver.disconnect();
  renderedIds.clear();
  bubbleMap.clear();
  messageMap.clear();
  reactionsMap.clear();
  receiptsMap.clear();
  dividerMap.clear();
  anchorIds.clear();
  shownDividerId = null;
  lastAnchorTime = null;
  setReply(null);
  showEmptyConvState();
  hiddenIds = getHiddenIds(me.$id);
  composerEl.classList.remove("hidden");
  if (!history.state || history.state.view !== "thread") {
    history.pushState({ view: "thread" }, "");
  }
  chatEl.dataset.view = "thread";

  document.querySelectorAll(".user-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === other.$id);
  });

  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unsubscribeReactions) { unsubscribeReactions(); unsubscribeReactions = null; }
  if (unsubscribeReceipts)  { unsubscribeReceipts();  unsubscribeReceipts  = null; }

  try {
    activeConversation = await getOrCreateConversation(me.$id, other.$id);
  } catch (err) {
    const pairKey = [me.$id, other.$id].sort().join("_");
    const stub = getCachedConversation(me.$id, pairKey);
    if (!stub) {
      dialogAlert("Can't open this chat while offline — open it once while connected.");
      return;
    }
    activeConversation = stub;
  }
  const convId = activeConversation.$id;

  const cached = getCachedMessages(me.$id, convId);
  historyStart = Math.max(0, cached.length - INITIAL_RENDER_CAP);
  if (historyStart > 0) messagesEl.appendChild(makeEarlierButton(convId));
  bulkRender = true;
  cached.slice(historyStart).forEach(renderMessage);
  bulkRender = false;
  stickToBottom = true;
  messagesEl.scrollTop = messagesEl.scrollHeight;

  let since = cached.length ? cached[cached.length - 1].$createdAt : null;
  const deletedAt = getDeletedAt(me.$id, convId);
  if (deletedAt && (!since || deletedAt > since)) since = deletedAt;
  try {
    const fresh = await loadMessages(convId, since);
    fresh.forEach((msg) => {
      appendCachedMessage(me.$id, convId, msg);
      renderMessage(msg);
    });
  } catch (err) {
    console.warn("loadMessages failed:", err?.message);
  }

  outboxForConversation(me.$id, convId).forEach((item) => {
    renderMessage({
      $id: item.tempId,
      conversationId: convId,
      senderId: me.$id,
      receiverId: item.receiverId,
      text: item.text,
      $createdAt: item.queuedAt,
      $updatedAt: null,
      _pending: true,
      ...(item.reply ? { replyToId: item.reply.id, replyToText: (item.reply.text || "").slice(0, 280) } : {}),
    });
  });

  const all = getCachedMessages(me.$id, convId);
  if (all.length) {
    markSeen(me.$id, convId, all[all.length - 1].$createdAt);
    repaintFromCache();
  } else if (!outboxForConversation(me.$id, convId).length) {
    showEmptyConvState();
  }

  unsubscribe = subscribeMessages(convId, {
    onCreate: (msg) => {
      appendCachedMessage(me.$id, convId, msg);
      renderMessage(msg);
      markSeen(me.$id, convId, msg.$createdAt);
      if (msg.senderId !== me.$id) upsertMyReceipt(convId, msg.$createdAt);
      repaintReceiptIndicator();
    },
    onUpdate: (msg) => {
      updateCachedMessage(me.$id, convId, msg.$id, {
        text: msg.text, $updatedAt: msg.$updatedAt,
      });
      applyMessageUpdate(msg);
    },
    onDelete: (msg) => {
      removeCachedMessage(me.$id, convId, msg.$id);
      applyMessageDelete(msg.$id);
    },
  });

  try {
    const reactionDocs = await loadReactions(convId);
    reactionDocs.forEach(ingestReaction);
    reactionsMap.forEach((_, messageId) => paintReactions(messageId));
  } catch (err) {
    console.warn("loadReactions failed:", err?.message);
  }

  unsubscribeReactions = subscribeReactions(convId, {
    onCreate: (r) => { ingestReaction(r);  paintReactions(r.messageId); },
    onUpdate: (r) => { ingestReaction(r);  paintReactions(r.messageId); },
    onDelete: (r) => { discardReaction(r); paintReactions(r.messageId); },
  });

  let receiptDocs = null;
  try {
    receiptDocs = await loadReceipts(convId);
  } catch (err) {
    console.warn("loadReceipts failed:", err?.message);
  }
  if (receiptDocs !== null) {
    receiptDocs.forEach((r) => receiptsMap.set(r.userId, r.lastSeenAt));
    const latest = getCachedMessages(me.$id, convId).slice(-1)[0];
    if (latest) upsertMyReceipt(convId, latest.$createdAt);
    repaintReceiptIndicator();

    unsubscribeReceipts = subscribeReceipts(convId, {
      onCreate: (r) => { receiptsMap.set(r.userId, r.lastSeenAt); repaintReceiptIndicator(); },
      onUpdate: (r) => { receiptsMap.set(r.userId, r.lastSeenAt); repaintReceiptIndicator(); },
      onDelete: (r) => { receiptsMap.delete(r.userId);           repaintReceiptIndicator(); },
    });
  }
}

// ============================================================
// User list (sidebar)
// ============================================================

const USER_LIST_TTL_MS = 30 * 60 * 1000;

function paintUserList(users) {
  if (!users || !users.length) {
    userListEl.innerHTML = '<div class="empty">No other users yet. Have a friend sign up.</div>';
    return;
  }
  const activeId = document.querySelector(".user-item.active")?.dataset.id;
  userListEl.innerHTML = "";
  users.forEach(u => {
    if (u.$id === me.$id) return;
    const item = document.createElement("div");
    item.className = "user-item" + (u.$id === activeId ? " active" : "");
    item.dataset.id = u.$id;
    item.innerHTML = `
      <div class="avatar" aria-hidden="true"></div>
      <div class="user-meta">
        <span class="name"></span>
        <span class="last-message"></span>
      </div>
    `;
    const avEl = item.querySelector(".avatar");
    paintAvatar(avEl, u.$id, u.name || u.email);
    if (isOnline(u)) avEl.classList.add("online");
    item.querySelector(".name").textContent = u.name;

    const pairKey = [me.$id, u.$id].sort().join("_");
    const conv = getCachedConversation(me.$id, pairKey);
    if (conv) {
      const msgs = getCachedMessages(me.$id, conv.$id);
      const last = msgs[msgs.length - 1];
      if (last) {
        const callInfo = parseCallEvent(last.text);
        let display, prefix;
        if (callInfo) {
          const { label } = formatCallSummary(callInfo, last.senderId === me.$id);
          display = (callInfo.media === "video" ? "📹 " : "📞 ") + label;
          prefix = "";
        } else if (isDeleted(last)) {
          prefix = "";
          display = last.senderId === me.$id ? "You removed a message" : "Message removed";
        } else if (last.imageId && !last.text) {
          prefix = last.senderId === me.$id ? "You: " : "";
          display = "📷 Photo";
        } else {
          prefix = last.senderId === me.$id ? "You: " : "";
          display = last.text;
        }
        item.querySelector(".last-message").textContent = prefix + display;
        const lastSeen = getLastSeen(me.$id, conv.$id);
        const isUnread = last.senderId !== me.$id && last.$createdAt > lastSeen;
        if (isUnread) item.classList.add("unread");
      }
    }
    bindLongPress(item, () => openChatSheet(u), () => openConversation(u));
    userListEl.appendChild(item);
  });
}

async function renderUserList() {
  const cached = getCachedUserList(me.$id);
  const stale = !cached
    || !cached.users?.length
    || (Date.now() - cached.fetchedAt) > USER_LIST_TTL_MS;

  if (cached) paintUserList(cached.users);

  if (stale) {
    try {
      const users = await listOtherUsers(me.$id);
      saveCachedUserList(me.$id, users);
      paintUserList(users);
    } catch (err) {
      console.warn("User list refresh failed:", err);
      if (!cached) userListEl.innerHTML = '<div class="empty">Failed to load users.</div>';
    }
  }
}

function repaintFromCache() {
  const cached = getCachedUserList(me.$id);
  paintUserList(cached?.users || []);
  if (activeOther) {
    const u = cached?.users.find((x) => x.$id === activeOther.$id);
    document.getElementById("thread-avatar").classList.toggle("online", isOnline(u || activeOther));
  }
}

// ============================================================
// Presence heartbeat
// ============================================================

let lastBeatAt = 0;
async function beat() {
  const now = Date.now();
  if (now - lastBeatAt < 30_000) return;
  lastBeatAt = now;
  await heartbeat(me.$id);
}
beat();
setInterval(beat, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") beat();
});
setInterval(repaintFromCache, 30_000);

// ============================================================
// In-page notifications (Notification API)
// ============================================================

const notifyAvailable = () => "Notification" in window;
const notifyAllowed   = () => notifyAvailable() && Notification.permission === "granted";

function showMessageNotification(senderName, text, conversationId, otherUserId) {
  if (!notifyAllowed()) return;
  if (document.visibilityState === "visible" &&
      activeConversation && activeConversation.$id === conversationId) return;
  try {
    const n = new Notification(senderName, {
      body: text,
      icon: "./icon.svg",
      badge: "./icon.svg",
      tag: conversationId,
      renotify: true,
    });
    n.addEventListener("click", () => {
      window.focus();
      n.close();
      const users = getCachedUserList(me.$id)?.users || [];
      const user = users.find((u) => u.$id === otherUserId);
      if (user) openConversation(user);
    });
  } catch (e) { /* ignore */ }
}

// ============================================================
// Global realtime — sidebar previews + unread state across all chats
// ============================================================

subscribeAllMessages(me.$id, {
  onCreate: (msg) => {
    appendCachedMessage(me.$id, msg.conversationId, msg);
    const otherId = msg.senderId === me.$id ? msg.receiverId : msg.senderId;
    const pairKey = [me.$id, otherId].sort().join("_");
    if (!getCachedConversation(me.$id, pairKey)) {
      saveCachedConversation(me.$id, pairKey, {
        $id: msg.conversationId,
        pairKey,
        participants: [me.$id, otherId],
      });
    }
    if (msg.senderId === me.$id ||
        (activeConversation && msg.conversationId === activeConversation.$id)) {
      markSeen(me.$id, msg.conversationId, msg.$createdAt);
    }
    if (msg.senderId !== me.$id && !parseCallEvent(msg.text) && !isDeleted(msg)) {
      const sender = (getCachedUserList(me.$id)?.users || []).find((u) => u.$id === msg.senderId);
      const previewText = msg.text || (msg.imageId ? "📷 Photo" : "");
      showMessageNotification(sender?.name || "New message", previewText, msg.conversationId, msg.senderId);
    }
    repaintFromCache();
  },
  onUpdate: (msg) => {
    updateCachedMessage(me.$id, msg.conversationId, msg.$id, {
      text: msg.text, $updatedAt: msg.$updatedAt,
    });
    repaintFromCache();
  },
  onDelete: (msg) => {
    removeCachedMessage(me.$id, msg.conversationId, msg.$id);
    repaintFromCache();
  },
});

subscribeUsers({
  onCreate: (user) => {
    if (user.$id === me.$id) return;
    if (upsertCachedUser(me.$id, user)) repaintFromCache();
  },
  onUpdate: (user) => {
    if (user.$id === me.$id) return;
    if (upsertCachedUser(me.$id, user)) repaintFromCache();
  },
  onDelete: (user) => {
    if (removeCachedUser(me.$id, user.$id)) repaintFromCache();
  },
});

// ============================================================
// Send flow — optimistic bubble + offline outbox
// ============================================================

function tempMsgId() {
  return "tmp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

async function sendWithOptimism(text, reply) {
  if (!activeConversation || !activeOther) return;
  const tempId = tempMsgId();
  const convId = activeConversation.$id;
  const optimistic = {
    $id: tempId,
    conversationId: convId,
    senderId: me.$id,
    receiverId: activeOther.$id,
    text,
    $createdAt: new Date().toISOString(),
    $updatedAt: null,
    _pending: true,
  };
  if (reply?.id) {
    optimistic.replyToId   = reply.id;
    optimistic.replyToText = (reply.text || "").slice(0, 280);
  }
  renderMessage(optimistic);

  const item = {
    tempId,
    conversationId: convId,
    receiverId: activeOther.$id,
    text,
    reply: reply ? { id: reply.id, text: reply.text } : null,
    queuedAt: optimistic.$createdAt,
  };

  if (isOffline()) {
    enqueueOutbox(me.$id, item);
    return;
  }

  try {
    const sent = await sendMessage(activeConversation, me.$id, text, reply);
    applyMessageDelete(tempId);
    appendCachedMessage(me.$id, convId, sent);
    renderMessage(sent);
  } catch (err) {
    if (isOffline() || err?.message?.toLowerCase().includes("network")) {
      enqueueOutbox(me.$id, item);
    } else {
      applyMessageDelete(tempId);
      dialogAlert("Failed to send: " + err.message);
    }
  }
}

composerEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || !activeConversation) return;
  const reply = pendingReply;
  inputEl.value = "";
  setReply(null);
  refreshComposerMode();
  sendWithOptimism(text, reply);
});

async function flushOutbox() {
  const items = getOutbox(me.$id);
  for (const item of items) {
    const convStub = {
      $id: item.conversationId,
      participants: [me.$id, item.receiverId],
    };
    try {
      const sent = await sendMessage(convStub, me.$id, item.text, item.reply);
      removeFromOutbox(me.$id, item.tempId);
      appendCachedMessage(me.$id, item.conversationId, sent);
      if (activeConversation && activeConversation.$id === item.conversationId) {
        applyMessageDelete(item.tempId);
        renderMessage(sent);
      }
      repaintFromCache();
    } catch (err) {
      console.warn("Outbox send failed:", err?.message);
      if (!navigator.onLine) break;
    }
  }
}

// ============================================================
// Composer mode (like/send toggle) + reply preview + emoji picker
// ============================================================

const sendBtn          = document.getElementById("send-btn");
const likeBtn          = document.getElementById("like-btn");
const emojiBtn         = document.getElementById("emoji-btn");
const emojiPickerEl    = document.getElementById("emoji-picker");
const replyPreview     = document.getElementById("reply-preview");
const replyPreviewText = document.getElementById("reply-preview-text");

function refreshComposerMode() {
  const hasText = inputEl.value.trim().length > 0;
  sendBtn.classList.toggle("hidden", !hasText);
  likeBtn.classList.toggle("hidden",  hasText);
  if (!hasText || inputEl.offsetParent === null) {
    inputEl.style.height = "";
    return;
  }
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}
inputEl.addEventListener("input", refreshComposerMode);
refreshComposerMode();

likeBtn.addEventListener("click", () => {
  if (!activeConversation) return;
  const reply = pendingReply;
  setReply(null);
  sendWithOptimism("👍", reply);
});

function setReply(msg) {
  let snippet = msg?.text || "";
  if (msg && isDeleted(msg)) snippet = "Message removed";
  else if (msg && !snippet && msg.imageId) snippet = "📷 Photo";
  pendingReply = msg ? { id: msg.$id, text: snippet } : null;
  if (pendingReply) {
    const preview = pendingReply.text.length > 120
      ? pendingReply.text.slice(0, 120) + "…"
      : pendingReply.text;
    replyPreviewText.textContent = preview;
    replyPreview.classList.remove("hidden");
    inputEl.focus();
  } else {
    replyPreview.classList.add("hidden");
  }
}
document.getElementById("reply-preview-close")
  .addEventListener("click", () => setReply(null));

emojiPicker = setupEmojiPicker({
  button: emojiBtn,
  picker: emojiPickerEl,
  target: inputEl,
  onInsert: refreshComposerMode,
});

// ============================================================
// Composer compact/expanded — focusing input collapses the four
// left-side action buttons into a single `>` arrow.
// ============================================================

const expandedActions = document.querySelectorAll(".composer-expanded-action");
const moreBtnEl = document.getElementById("more-btn");
let composerCompact = false;
let composerExpandTimer = null;

function setComposerCompact(compact) {
  composerCompact = compact;
  expandedActions.forEach((b) => b.classList.toggle("hidden", compact));
  moreBtnEl.classList.toggle("hidden", !compact);
}
function cancelComposerTimer() {
  if (composerExpandTimer) {
    clearTimeout(composerExpandTimer);
    composerExpandTimer = null;
  }
}
inputEl.addEventListener("focus", () => {
  if (composerCompact) return;
  setComposerCompact(true);
  cancelComposerTimer();
  if (COMPOSER_AUTO_EXPAND_MS > 0) {
    composerExpandTimer = setTimeout(() => {
      setComposerCompact(false);
      composerExpandTimer = null;
    }, COMPOSER_AUTO_EXPAND_MS);
  }
});
inputEl.addEventListener("input", cancelComposerTimer);
moreBtnEl.addEventListener("click", () => {
  cancelComposerTimer();
  setComposerCompact(false);
});
["plus-btn", "mic-btn"].forEach((id) => {
  document.getElementById(id).addEventListener("click", () => {
    showToast("Coming soon");
  });
});

// ============================================================
// Photos — gallery picker, in-app camera, send pipeline, save action
// ============================================================

const galleryInput = document.createElement("input");
galleryInput.type = "file";
galleryInput.accept = "image/*,video/*";
galleryInput.multiple = true;
galleryInput.style.display = "none";
document.body.appendChild(galleryInput);

const cameraInput = document.createElement("input");
cameraInput.type = "file";
cameraInput.accept = "image/*";
cameraInput.capture = "environment";
cameraInput.style.display = "none";
document.body.appendChild(cameraInput);

document.getElementById("gallery-btn").addEventListener("click", () => {
  if (!activeConversation) return;
  if (isOffline()) { showToast("Connect to send photos"); return; }
  galleryInput.value = "";
  galleryInput.click();
});
document.getElementById("camera-btn").addEventListener("click", () => {
  if (!activeConversation) return;
  if (isOffline()) { showToast("Connect to send photos"); return; }
  camera.open();
});

camera = setupCamera({
  onPhoto: (file) => sendPhotos([file]),
  onFallback: () => { cameraInput.value = ""; cameraInput.click(); },
});

galleryInput.addEventListener("change", (e) => sendPhotos(e.target.files));
cameraInput.addEventListener("change", (e) => sendPhotos(e.target.files));

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // Appwrite bucket limit

async function sendPhotos(fileList) {
  const all = Array.from(fileList || []).filter(
    (f) => f && (f.type.startsWith("image/") || f.type.startsWith("video/"))
  );
  const files = all.filter((f) => {
    if (f.type.startsWith("video/") && f.size > MAX_VIDEO_BYTES) {
      dialogAlert(`"${f.name}" is too large — videos can be up to 50 MB.`);
      return false;
    }
    return true;
  });
  if (!files.length || !activeConversation || !activeOther) return;
  const caption = inputEl.value.trim();
  inputEl.value = "";
  setReply(null);
  refreshComposerMode();

  const conv = activeConversation;
  const convId = conv.$id;
  const jobs = files.map((file, i) => {
    const tempId = tempMsgId();
    const localUrl = URL.createObjectURL(file);
    const text = i === 0 ? caption : "";
    renderMessage({
      $id: tempId,
      conversationId: convId,
      senderId: me.$id,
      receiverId: activeOther.$id,
      text,
      $createdAt: new Date().toISOString(),
      $updatedAt: null,
      _pending: true,
      _localImageUrl: localUrl,
      _localMime: file.type,
    });
    return { file, tempId, localUrl, text };
  });

  for (const job of jobs) {
    try {
      const fileDoc = await uploadMessageMedia(job.file, me.$id);
      const sent = await sendMessage(conv, me.$id, job.text, null, fileDoc.$id);
      applyMessageDelete(job.tempId);
      appendCachedMessage(me.$id, convId, sent);
      renderMessage(sent);
    } catch (err) {
      applyMessageDelete(job.tempId);
      dialogAlert("Photo send failed: " + (err?.message || err));
    } finally {
      URL.revokeObjectURL(job.localUrl);
    }
  }
}

async function saveImage(imageId) {
  try {
    const res = await fetch(imageViewUrl(imageId), { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    const ext = (blob.type.split("/")[1] || "jpg").split(";")[0];
    a.download = `neer-${blob.type.startsWith("video/") ? "video" : "photo"}-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    showToast("Photo saved");
  } catch (err) {
    dialogAlert("Save failed: " + (err?.message || err));
  }
}

// ============================================================
// Lightbox + Call UI
// ============================================================

function chatImageIds() {
  return [...messageMap.values()]
    .filter((m) => m.imageId && !isDeleted(m))
    .sort((a, b) => (a.$createdAt < b.$createdAt ? -1 : 1))
    .map((m) => m.imageId);
}

lightbox = setupLightbox({
  getGalleryIds: chatImageIds,
  getMediaUrl: bubbleMediaUrl,
  onSave: saveImage,
});

callUI = setupCallUI({
  me,
  getActiveOther: () => activeOther,
  getActiveConversation: () => activeConversation,
  getCachedUsers: () => getCachedUserList(me.$id)?.users || [],
  sendCallEvent: (conv, body) => sendMessage(conv, me.$id, body),
});

// ============================================================
// Thread header buttons (call / video / info)
// ============================================================

document.getElementById("call-btn").addEventListener("click", () => {
  if (activeOther) callUI.startOutgoing(activeOther, "audio");
});
document.getElementById("video-btn").addEventListener("click", () => {
  if (activeOther) callUI.startOutgoing(activeOther, "video");
});
document.getElementById("info-btn").addEventListener("click", () => {
  if (!activeOther) return;
  showToast(`${activeOther.name} · ${activeOther.email}`, 2600);
});

// ============================================================
// Back button + history popstate
// ============================================================

document.getElementById("back-btn").addEventListener("click", () => {
  if (history.state && history.state.view === "thread") history.back();
  else leaveActiveConversation();
});

window.addEventListener("popstate", () => {
  if (camera?.isOpen()) { camera.hide(); return; }
  if (lightbox?.isOpen()) { lightbox.hide(); return; }
  const sm = document.getElementById("settings-modal");
  if (sm && !sm.classList.contains("hidden")) {
    sm.classList.add("hidden");
    return;
  }
  if (activeConversation) leaveActiveConversation();
});

// ============================================================
// Settings modal
// ============================================================

const settingsModal = document.getElementById("settings-modal");
const settingsMsg   = document.getElementById("settings-msg");
const themeToggle   = document.getElementById("theme-toggle");
const nameForm      = document.getElementById("name-form");
const passwordForm  = document.getElementById("password-form");
const meNameEl      = document.getElementById("me-name");

function showSettingsMsg(text, isError = false) {
  settingsMsg.textContent = text;
  settingsMsg.classList.toggle("error", isError);
}

function syncThemeButtons() {
  const current = getTheme();
  themeToggle.querySelectorAll("button").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === current);
  });
}

isAdmin().then((ok) => {
  if (ok) document.getElementById("admin-section").classList.remove("hidden");
}).catch(() => {});
document.getElementById("admin-btn").addEventListener("click", () => {
  location.href = "./admin.html";
});

const notifyBtn = document.getElementById("notify-btn");
function refreshNotifyBtn() {
  if (!notifyAvailable()) {
    notifyBtn.textContent = "Notifications not supported";
    notifyBtn.disabled = true;
    return;
  }
  switch (Notification.permission) {
    case "granted":
      notifyBtn.textContent = "Notifications enabled ✓";
      notifyBtn.disabled = true;
      break;
    case "denied":
      notifyBtn.textContent = "Blocked — change in browser settings";
      notifyBtn.disabled = true;
      break;
    default:
      notifyBtn.textContent = "Enable notifications";
      notifyBtn.disabled = false;
  }
}
notifyBtn.addEventListener("click", async () => {
  if (!notifyAvailable()) return;
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      enablePush(me.$id).catch((e) => console.warn("Push subscribe:", e));
      try {
        new Notification("Neer notifications enabled", {
          body: "You'll get alerts for new messages.",
          icon: "./icon.svg",
          tag: "neer-test",
        });
      } catch {}
    }
  } catch {}
  refreshNotifyBtn();
});

// Re-subscribe on each load so the push endpoint stays current (browsers
// rotate endpoints periodically).
if ("Notification" in window && Notification.permission === "granted") {
  enablePush(me.$id).catch((e) => console.warn("Push re-subscribe:", e));
}

// Service-worker → page bridge: when a push notification is clicked.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "open-conversation") return;
    const otherUserId = event.data.otherUserId;
    const users = getCachedUserList(me.$id)?.users || [];
    const user = users.find((u) => u.$id === otherUserId);
    if (user) openConversation(user);
  });
}

function openSettings() {
  nameForm.elements.name.value = me.name || "";
  document.getElementById("me-email").textContent = me.email || "";
  document.getElementById("email-form").reset();
  passwordForm.reset();
  showSettingsMsg("");
  syncThemeButtons();
  refreshNotifyBtn();
  settingsModal.classList.remove("hidden");
  if (!history.state || history.state.view !== "settings") {
    history.pushState({ view: "settings" }, "");
  }
}

function closeSettings() {
  if (history.state && history.state.view === "settings") {
    history.back();
  } else {
    settingsModal.classList.add("hidden");
  }
}

document.getElementById("settings-btn").addEventListener("click", () => {
  if (isOffline()) {
    dialogAlert("Please check your internet connection and try again.");
    return;
  }
  openSettings();
});
document.getElementById("close-settings").addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});

themeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-theme]");
  if (!btn) return;
  setTheme(btn.dataset.theme);
  syncThemeButtons();
});

nameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const newName = nameForm.elements.name.value.trim();
  if (!newName || newName === me.name) return;
  try {
    await updateName(newName);
    await updateProfileName(me.$id, newName);
    me.name = newName;
    meNameEl.textContent = newName;
    showSettingsMsg("Name updated.");
  } catch (err) {
    showSettingsMsg(err.message, true);
  }
});

passwordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const current = passwordForm.elements.current.value;
  const next    = passwordForm.elements.next.value;
  try {
    await updatePassword(current, next);
    passwordForm.reset();
    showSettingsMsg("Password updated.");
  } catch (err) {
    showSettingsMsg(err.message, true);
  }
});

// Email change: Appwrite un-verifies the account, and the approval doc no
// longer matches the new address — so both gates re-arm automatically.
document.getElementById("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const newEmail = form.elements.newEmail.value.trim();
  const password = form.elements.password.value;
  if (!newEmail || newEmail === me.email) return;
  const sure = await dialogConfirm(
    "Changing your email signs you out to re-verify the new address, and an admin must approve your account again. Continue?"
  );
  if (!sure) return;
  try {
    try { localStorage.setItem(`neer:prevEmail:${me.$id}`, me.email); } catch {}
    await updateEmail(newEmail, password);
    await updateProfileEmail(me.$id, newEmail).catch(() => {});
    try { await sendVerificationEmail(); } catch {}
    location.replace("./verify.html");
  } catch (err) {
    showSettingsMsg(err.message, true);
  }
});

// ============================================================
// Start
// ============================================================

await renderUserList();
