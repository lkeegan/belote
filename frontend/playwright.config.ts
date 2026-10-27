import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  testMatch: "**/*.browser.ts",
  timeout: 180000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4175/belote/",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175/belote/voice.html",
    reuseExistingServer: false,
  },
});
