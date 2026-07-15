import { expect, test } from "@playwright/test";

test("loads the demo application and workspace packages", async ({ page }) => {
  test.setTimeout(
    process.env.VITE_DYNAMIC_RAD_BASE_URL === undefined ? 30_000 : 180_000,
  );
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Adaptive Gaussian Splat Streaming" }),
  ).toBeVisible();
  await expect(page.getByText("Framework-independent player core")).toBeVisible();
  await expect(page.getByText("supported", { exact: true })).toBeVisible();
  await expect(page.getByText("Renderer ready", { exact: true })).toBeVisible();
  await expect(page.getByText(/Drag to orbit/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Render quality" })).toBeEnabled();
  await expect(page.getByLabel("Renderer metrics")).toBeVisible();

  await page.getByLabel("Static detail").fill("1.5");
  await expect(page.locator('output[for="static-detail"]')).toHaveText("1.50×");
  await page.getByLabel("Maximum SH").selectOption("2");
  await expect(page.getByLabel("Maximum SH")).toHaveValue("2");

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

  if (process.env.VITE_DYNAMIC_RAD_BASE_URL !== undefined) {
    await expect(page.getByText(/Dynamic RAD ready/)).toBeVisible({
      timeout: 120_000,
    });
    await page.getByRole("button", { name: "Next dynamic frame" }).click();
    await expect(page.getByText(/Source 41/)).toBeVisible();
    await page.getByRole("button", { name: "Previous dynamic frame" }).click();
    await expect(page.getByText(/Source 40/)).toBeVisible();
  }
});
