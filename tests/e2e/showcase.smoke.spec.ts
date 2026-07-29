import { expect, test } from "@playwright/test";

const showcaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_SHOWCASE_PORT ?? "4180"}`;

test("showcase landing and manifest picker are usable without bundled content", async ({
  page,
}) => {
  await page.goto(`${showcaseUrl}/#/`);
  await expect(
    page.getByRole("heading", { name: /stream volumetric moments/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /open the player/i })).toBeVisible();

  await page.getByRole("link", { name: /open the player/i }).click();
  await expect(page).toHaveURL(/#\/demo$/);
  await expect(
    page.getByRole("heading", { name: "Open a 4DGS manifest" }),
  ).toBeVisible();
  await expect(page.getByLabel("Manifest URL")).toBeFocused();
});

test("manifest override rejects mixed content on an HTTPS-equivalent route", async ({
  page,
}) => {
  await page.goto(`${showcaseUrl}/#/demo`);
  await page.getByLabel("Manifest URL").fill("ftp://example.com/manifest.json");
  await page.getByRole("button", { name: "Load scene" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Manifest URL must use HTTP or HTTPS",
  );
});
