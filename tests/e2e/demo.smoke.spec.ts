import { expect, test } from "@playwright/test";

test("loads the demo application and workspace packages", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Adaptive Gaussian Splat Streaming" }),
  ).toBeVisible();
  await expect(page.getByText("Framework-independent player core")).toBeVisible();
  await expect(page.getByText("supported", { exact: true })).toBeVisible();
  await expect(page.getByText("Renderer ready", { exact: true })).toBeVisible();

  if (process.env.VITE_STATIC_RAD_URL !== undefined) {
    await expect(page.getByText("Static RAD ready", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  }
});
