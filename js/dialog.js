/**
 * Themed replacement for window.alert / window.confirm.
 *   await dialogAlert("Message");
 *   if (await dialogConfirm("Sure?", { danger: true })) { ... }
 *
 * Resolves to true (confirmed) / false (cancelled or dismissed).
 */

let host = null;
let resolveActive = null;

function ensureDOM() {
  if (host) return host;
  host = document.createElement("div");
  host.id = "app-dialog";
  host.className = "app-dialog hidden";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  host.innerHTML = `
    <div class="app-dialog-backdrop"></div>
    <div class="app-dialog-panel">
      <div class="app-dialog-msg"></div>
      <div class="app-dialog-actions"></div>
    </div>
  `;
  host.querySelector(".app-dialog-backdrop").addEventListener("click", () => close(false));
  document.body.appendChild(host);
  return host;
}

function close(result) {
  if (!host) return;
  host.classList.add("hidden");
  const r = resolveActive;
  resolveActive = null;
  if (r) r(result);
}

// Keyboard shortcuts — Esc cancels, Enter accepts the primary action.
document.addEventListener("keydown", (e) => {
  if (!resolveActive) return;
  if (e.key === "Escape") { e.preventDefault(); close(false); }
  else if (e.key === "Enter") {
    e.preventDefault();
    host?.querySelector(".app-dialog-actions .primary")?.click();
  }
});

function open({ text, okLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    if (resolveActive) resolveActive(false); // close any prior
    resolveActive = resolve;

    const node = ensureDOM();
    node.querySelector(".app-dialog-msg").textContent = text;
    const actions = node.querySelector(".app-dialog-actions");
    actions.innerHTML = "";

    if (cancelLabel) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = cancelLabel;
      cancel.addEventListener("click", () => close(false));
      actions.appendChild(cancel);
    }
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary" + (danger ? " danger" : "");
    ok.textContent = okLabel;
    ok.addEventListener("click", () => close(true));
    actions.appendChild(ok);

    node.classList.remove("hidden");
    setTimeout(() => ok.focus(), 0);
  });
}

export function dialogAlert(text, opts = {}) {
  return open({ text, okLabel: opts.okLabel || "OK" });
}

export function dialogConfirm(text, opts = {}) {
  return open({
    text,
    okLabel: opts.okLabel || "OK",
    cancelLabel: opts.cancelLabel || "Cancel",
    danger: !!opts.danger,
  });
}
