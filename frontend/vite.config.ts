import { defineConfig } from "vite";

// GitHub Pages serves the site at https://keegan.ch/belote/.
export default defineConfig({
  base: "/belote/",
  build: {
    rollupOptions: {
      input: { game: "index.html", voice: "voice.html" },
    },
  },
});
