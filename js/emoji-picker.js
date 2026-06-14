// Small curated emoji picker, lazily rendered into a grid popover the first
// time the user opens it. The picker inserts at the cursor of a target
// textarea and notifies a callback so the host can re-size its composer.

const EMOJI_SECTIONS = {
  "Smileys": ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😋","😛","😜","🤪","🤨","🧐","🤓","😎","🥳","🤩","😏","😒","🙄","😬","😮‍💨","🤔","🤐","😶","😐","😴","🤤","😪","😵","🤯","🤠","🥸","🤡","🤥","🤫","🫡","🥺","😢","😭","😤","😠","😡","🤬","🤧","🤒","🤕","🥶","🥵","😈","👿","💀","👻","🤖"],
  "Gestures": ["👍","👎","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","🫰","🫶","👏","🙌","🙏","💪","👊","✊","🤝","👋","🖐️","🤚","✋","🖖","👈","👉","👆","👇","☝️","👀","👂","👃","🧠","🫀","🦴","🦷","👅","👄"],
  "Hearts": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","💌"],
  "Animals & Nature": ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🐤","🦄","🐝","🦋","🐌","🐞","🐢","🐍","🐙","🦑","🦐","🐳","🐬","🐟","🦈","🌸","🌼","🌻","🌹","🌷","🌳","🌴","🌵","🍀","🌙","⭐","🌟","✨","☀️","☁️","🌈","⚡","❄️","🔥"],
  "Food & Drink": ["🍎","🍐","🍊","🍌","🍉","🍇","🍓","🍒","🍑","🥭","🍍","🥝","🍅","🥑","🌽","🥕","🍞","🧀","🥓","🍔","🍟","🍕","🌭","🥪","🌮","🌯","🍣","🍜","🍝","🍱","🥗","🍿","🍩","🍪","🍰","🎂","🍫","🍬","🍭","🍯","☕","🍵","🥤","🍺","🍷","🍸","🥂"],
  "Activity & Travel": ["⚽","🏀","🏈","⚾","🎾","🏐","🏉","🎱","🏓","🏸","🥊","🎯","🎮","🎲","♟️","🎵","🎶","🎤","🎧","🎬","🎨","🚗","🚕","🚌","🚲","✈️","🚀","🛸","🚁","⛵","🛳️","🏖️","🏔️","🗽","🗼","🌍","🌎","🌏"],
  "Objects & Symbols": ["💯","💥","💫","💦","💨","🎉","🎊","🎁","🎈","🎀","💎","💍","👑","🔥","✨","⚡","🌟","⭐","🎯","✅","❌","⚠️","❓","❗","💡","🔒","🔓","🔔","🔕","📞","📱","💻","⌨️","🖥️","📷","🎥","📺","💬","💭","🗯️","📢","🎵","💤","💢"],
};

export function setupEmojiPicker({ button, picker, target, onInsert }) {
  let built = false;

  function build() {
    if (built) return;
    const frag = document.createDocumentFragment();
    for (const [section, list] of Object.entries(EMOJI_SECTIONS)) {
      const title = document.createElement("div");
      title.className = "emoji-section-title";
      title.textContent = section;
      frag.appendChild(title);
      const grid = document.createElement("div");
      grid.className = "emoji-grid";
      list.forEach((em) => {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "emoji-cell";
        cell.textContent = em;
        cell.setAttribute("aria-label", em);
        cell.addEventListener("click", (e) => {
          e.stopPropagation();
          insertAtCursor(em);
        });
        grid.appendChild(cell);
      });
      frag.appendChild(grid);
    }
    picker.appendChild(frag);
    built = true;
  }

  function toggle(open) {
    if (open === undefined) open = picker.classList.contains("hidden");
    if (open) {
      build();
      picker.classList.remove("hidden");
    } else {
      picker.classList.add("hidden");
    }
  }

  function insertAtCursor(str) {
    const start = target.selectionStart ?? target.value.length;
    const end   = target.selectionEnd   ?? target.value.length;
    target.value = target.value.slice(0, start) + str + target.value.slice(end);
    const pos = start + str.length;
    target.selectionStart = target.selectionEnd = pos;
    target.focus();
    onInsert?.();
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  picker.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => toggle(false));

  return { close: () => toggle(false) };
}
