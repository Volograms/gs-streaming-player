import { defineConfig, devices } from "@playwright/test";

const devServerPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const devServerUrl = `http://127.0.0.1:${devServerPort}`;
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_SERVER === "true" || !process.env.CI;
const externalServers = process.env.PLAYWRIGHT_EXTERNAL_SERVERS === "true";

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
  ...(externalServers
    ? {}
    : {
        webServer: {
          command: "node scripts/start-e2e-servers.mjs",
          reuseExistingServer,
          stderr: "pipe" as const,
          stdout: "ignore" as const,
          timeout: 120_000,
          url: devServerUrl,
        },
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
