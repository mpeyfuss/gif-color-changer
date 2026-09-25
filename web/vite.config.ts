import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the site works from any path, e.g. GitHub Pages'
  // /gif-color-changer/.
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022" },
});
