import { expect, test } from "@playwright/test";

test("loads the demo application and workspace packages", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Adaptive Gaussian Splat Streaming" }),
  ).toBeVisible();
  await expect(page.getByText("Framework-independent player core")).toBeVisible();
  await expect(page.getByText("supported", { exact: true })).toBeVisible();
  await expect(page.getByText("Renderer ready", { exact: true })).toBeVisible();
  await expect(page.getByText(/Drag to orbit/)).toBeVisible();

  const viewport = page.getByLabel("Gaussian scene viewport");
  const bounds = await viewport.boundingBox();
  if (bounds !== null) {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.65,
      bounds.y + bounds.height * 0.4,
    );
    await page.mouse.up();
    await page.mouse.wheel(0, -120);
  }

  await expect(page.getByText("Renderer ready", { exact: true })).toBeVisible();

  if (process.env.VITE_STATIC_RAD_URL !== undefined) {
    await expect(page.getByText("Static RAD ready", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  }
});
