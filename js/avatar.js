// Color-coded avatar helpers. The hue is derived deterministically from a
// seed (the user id) so the same user always gets the same color across
// sessions and devices.

export function avatarHue(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xfffff;
  return h % 360;
}

export function avatarInitial(nameOrEmail) {
  return (nameOrEmail || "?").trim().charAt(0).toUpperCase() || "?";
}

export function paintAvatar(el, seed, label) {
  el.textContent = avatarInitial(label);
  el.style.setProperty("--hue", String(avatarHue(seed || label || "?")));
}
