import { defineConfig, devices } from "@playwright/test";

const devServerPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const devServerUrl = `http://127.0.0.1:${devServerPort}`;

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir: "test-results/playwright",
  reporter: process.env.CI ? [["html"], ["github"]] : "list",
  retries: process.env.CI ? 2 : 0,
  testDir: "tests/e2e",
  use: {
    baseURL: devServerUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm --filter @6g-path/demo dev --port ${devServerPort}`,
    reuseExistingServer: !process.env.CI,
    stderr: "pipe",
    stdout: "ignore",
    timeout: 120_000,
    url: devServerUrl,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
