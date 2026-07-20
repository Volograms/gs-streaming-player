import { expect, test } from "@playwright/test";

test("loads the demo application and workspace packages", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  const dynamicStartFrame = Number(process.env.VITE_DYNAMIC_RAD_START_FRAME ?? 40);
  const dynamicEndFrame = Number(process.env.VITE_DYNAMIC_RAD_END_FRAME ?? 50);
  const dynamicSequenceConfigured =
    process.env.VITE_DYNAMIC_RAD_BASE_URL !== undefined ||
    process.env.VITE_DYNAMIC_QUALITY_INDEX_URL !== undefined;
  const requestedDynamicFrames = new Set<number>();
  page.on("request", (request) => {
    const match = /\/frame(\d+)-(?:lod\.rad|[a-z0-9_-]+\.spz)(?:\?|$)/i.exec(
      request.url(),
    );
    if (match?.[1] !== undefined) {
      requestedDynamicFrames.add(Number(match[1]));
    }
  });
  test.setTimeout(
    dynamicSequenceConfigured
      ? 180_000
      : process.env.VITE_STATIC_RAD_URL !== undefined
        ? 90_000
        : 30_000,
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
  await expect(page.getByRole("group", { name: "Object scale" })).toBeEnabled();
  await expect(page.getByLabel("Renderer metrics")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Playback performance summary" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Playback trace" })).toBeVisible();
  const automaticQuality = page.getByLabel("Automatic buffer-aware quality");
  await expect(automaticQuality).not.toBeChecked();
  await automaticQuality.check();
  await expect(page.getByLabel("Splat budget")).toBeDisabled();
  await automaticQuality.uncheck();

  await page.getByLabel("Static detail").fill("0.75");
  await expect(page.locator('output[for="static-detail"]')).toHaveText("0.75×");
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
    await page.getByLabel("Static scene scale").fill("1.1");
    await expect(page.locator('output[for="static-object-scale"]')).toHaveText("1.10×");
  }

  if (dynamicSequenceConfigured) {
    await expect(page.getByText(/Dynamic GS ready/)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator('[data-trace-type="presented"]')).toHaveCount(1, {
      timeout: 120_000,
    });
    if (
      process.env.VITE_DYNAMIC_FRAME_CODEC === "spz-v4" &&
      process.env.VITE_DYNAMIC_SORT_SOURCE !== "gpu-readback" &&
      process.env.VITE_STATIC_RAD_URL === undefined
    ) {
      const performanceSummary = page.getByRole("region", {
        name: "Playback performance summary",
      });
      await expect
        .poll(
          async () => {
            const value = await performanceSummary.getAttribute(
              "data-performance-summary",
            );
            return value === null
              ? 0
              : ((JSON.parse(value) as { sortCpuKeys?: { count?: number } }).sortCpuKeys
                  ?.count ?? 0);
          },
          { timeout: 120_000 },
        )
        .toBeGreaterThan(0);
    }
    const expectedInitialWindow = new Set([
      dynamicStartFrame,
      Math.min(dynamicStartFrame + 1, dynamicEndFrame),
      Math.min(dynamicStartFrame + 2, dynamicEndFrame),
      Math.min(dynamicStartFrame + 3, dynamicEndFrame),
      dynamicEndFrame,
    ]);
    expect([...requestedDynamicFrames].sort((a, b) => a - b)).toEqual(
      [...expectedInitialWindow].sort((a, b) => a - b),
    );
    const dynamicScale = page.getByLabel("Dynamic actor scale");
    await dynamicScale.fill("0.8");
    await expect(page.locator('output[for="dynamic-object-scale"]')).toHaveText(
      "0.80×",
    );
    const dynamicControls = page.getByRole("region", {
      name: "Dynamic sequence preview",
    });
    const nextButton = page.getByRole("button", { name: "Next dynamic frame" });
    await expect(nextButton).toBeEnabled();
    await nextButton.click({ force: true });
    await expect(
      page.getByText(
        new RegExp(`Source ${Math.min(dynamicStartFrame + 1, dynamicEndFrame)}`),
      ),
    ).toBeVisible({ timeout: 120_000 });
    const previousButton = page.getByRole("button", {
      name: "Previous dynamic frame",
    });
    await expect(previousButton).toBeEnabled();
    await previousButton.click({ force: true });
    await expect(page.getByText(new RegExp(`Source ${dynamicStartFrame}`))).toBeVisible(
      { timeout: 120_000 },
    );

    const playButton = page.getByRole("button", { name: "Play dynamic sequence" });
    await expect(playButton).toBeEnabled();
    await playButton.click({ force: true });
    await expect(
      page.getByRole("button", { name: "Pause dynamic sequence" }),
    ).toBeVisible();
    await expect(page.getByLabel("Dynamic actor scale")).toBeDisabled();
    await expect(dynamicControls).toHaveAttribute("data-frame-index", /^(?!0$)\d+$/, {
      timeout: 10_000,
    });
    await page
      .getByRole("button", { name: "Pause dynamic sequence" })
      .click({ force: true });
    await expect(page.getByLabel("Dynamic actor scale")).toBeEnabled();
    await expect(dynamicControls).toHaveAttribute("data-playback-state", "paused");
    await expect(page.locator("[data-player-lifecycle]")).toHaveAttribute(
      "data-player-lifecycle",
      "PAUSED",
    );
  }
});
