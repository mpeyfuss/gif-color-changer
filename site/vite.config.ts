import { defineConfig } from "vite";

export default defineConfig({
  // Served from https://mpeyfuss.github.io/gif-color-changer/
  base: "/gif-color-changer/",
  worker: { format: "es" },
});
