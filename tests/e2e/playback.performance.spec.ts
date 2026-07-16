import { expect, test } from "@playwright/test";

test("measures real-asset frame preparation and switching", async ({ page }) => {
  test.skip(
    process.env.RUN_PLAYBACK_BENCHMARK !== "1" ||
      (process.env.VITE_DYNAMIC_RAD_BASE_URL === undefined &&
        process.env.VITE_DYNAMIC_QUALITY_INDEX_URL === undefined),
    "Set RUN_PLAYBACK_BENCHMARK=1 and a dynamic RAD base or quality index to run the real-asset benchmark.",
  );
  test.setTimeout(240_000);
  await page.goto("/");
  await expect(page.getByText(/Dynamic GS ready/)).toBeVisible({
    timeout: 180_000,
  });

  const next = page.getByRole("button", { name: "Next dynamic frame" });
  for (let index = 0; index < 5; index += 1) {
    await expect(next).toBeEnabled({ timeout: 180_000 });
    await next.click();
    await expect(
      page.getByRole("region", { name: "Dynamic sequence preview" }),
    ).toHaveAttribute("data-frame-index", String(index + 1), {
      timeout: 180_000,
    });
  }

  const encodedSummary = await page
    .getByRole("region", { name: "Playback performance summary" })
    .getAttribute("data-performance-summary");
  if (encodedSummary === null) {
    throw new Error("Playback performance summary was not available.");
  }
  const summary = JSON.parse(encodedSummary) as {
    handoff: { p95Ms?: number };
    sampleCount: number;
  };
  console.log("PLAYBACK_PERFORMANCE_SUMMARY", JSON.stringify(summary));
  const presentedRows = await page
    .locator('[data-trace-type="presented"]')
    .allTextContents();
  console.log("PLAYBACK_PRESENTED_ROWS", JSON.stringify(presentedRows));
  expect(summary.sampleCount).toBeGreaterThanOrEqual(5);
  expect(summary.handoff.p95Ms).toBeLessThan(100);
  expect(presentedRows.some((row) => /\b1 splats\b/.test(row))).toBe(false);
});
