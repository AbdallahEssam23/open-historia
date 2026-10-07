/*! Open Historia — visual regression runner © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Boots the web build (no Express server, no API key, no OH_DATA_DIR: web mode
// seeds its own default scenario into IndexedDB) and screenshots the views in
// views.mjs. Everything here is opt-in and advisory; the workflow that calls it
// is continue-on-error, and OH_VISUAL_STRICT is the only way a diff blocks.
import { defineConfig } from "@playwright/test";

import { visualPolicy } from "./views.mjs";

const policy = visualPolicy(process.env);

export default defineConfig({
  testDir: ".",
  testMatch: /visual\.spec\.mjs$/,
  outputDir: "../test-results/visual",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../visual-report" }],
  ],
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: policy.timeoutMs,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: policy.maxDiffPixels,
      maxDiffPixelRatio: policy.maxDiffPixelRatio,
      threshold: policy.threshold,
      animations: "disabled",
    },
  },
  use: {
    baseURL: policy.baseURL,
    viewport: policy.viewport,
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: "npm run dev:web -- --port 4173 --strictPort",
    url: policy.baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium-swiftshader",
      use: {
        browserName: "chromium",
        // MapLibre renders blank headless without a software WebGL context.
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
});
