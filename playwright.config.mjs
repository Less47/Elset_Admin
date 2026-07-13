import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  tsconfig: "./tsconfig.app.json",
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results/playwright",
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: {
      width: 1440,
      height: 900,
    },
  },
});
