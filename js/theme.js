const KEY = "neer:theme";
const VALID = ["dark", "light"];

export function getTheme() {
  const t = localStorage.getItem(KEY);
  return VALID.includes(t) ? t : "dark";
}

export function setTheme(theme) {
  if (!VALID.includes(theme)) return;
  localStorage.setItem(KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export function applyTheme() {
  document.documentElement.dataset.theme = getTheme();
}
