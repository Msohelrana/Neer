import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Multi-page app. Each HTML file is its own entry point so Vite bundles the
// inline `type="module"` scripts and the `js/` modules they import.
//
// `base: "./"` makes every asset reference relative, so the same build works
// whether GitHub Pages serves it at the repo subpath (https://user.github.io/Neer/)
// or at a custom domain root.
export default defineConfig({
  base: "./",
  build: {
    // The inline page scripts use top-level await (relied on native ESM
    // before the build step), so target a baseline that supports it.
    target: "esnext",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        login: resolve(__dirname, "login.html"),
        chat: resolve(__dirname, "chat.html"),
        admin: resolve(__dirname, "admin.html"),
        approval: resolve(__dirname, "approval.html"),
        verify: resolve(__dirname, "verify.html"),
      },
    },
  },
});
