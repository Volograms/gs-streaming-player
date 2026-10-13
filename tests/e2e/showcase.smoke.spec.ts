import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const showcaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_SHOWCASE_PORT ?? "4180"}`;

test("cached timeline ranges preserve gaps and keyboard seeking at desktop and narrow widths", async ({
  page,
}, testInfo) => {
  await page.goto(`${showcaseUrl}/#/demo`);
  const sourceUrl = (path: string) =>
    `/@fs/${fileURLToPath(new URL(path, import.meta.url)).replaceAll("\\", "/")}`;
  await page.evaluate(
    async ({ playerUrl, rendererUrl }) => {
      const { GaussianStreamingPlayer } = (await import(
        playerUrl
      )) as typeof import("../../packages/player-core/src/index.js");
      const { PlayCanvasGaussianRendererAdapter } = (await import(
        rendererUrl
      )) as typeof import("../../packages/renderer-playcanvas/src/index.js");
      // Exercise the real React transport without downloading or rendering a scene.
      PlayCanvasGaussianRendererAdapter.prototype.getXrSupportInfo = async () => ({
        available: false,
        backendCompatible: true,
        reason: "session-unsupported",
        sessionSupported: false,
      });
      const snapshot = {
        audio: { configured: false, muted: false, volume: 1 },
        bufferedTimeRanges: [
          { startSeconds: 0, endSeconds: 60 },
          { startSeconds: 90, endSeconds: 108 },
        ],
        currentTimeSeconds: 30,
        durationSeconds: 120,
        isPlaying: false,
        lifecycle: "PAUSED",
        qualityMode: { mode: "automatic" },
        renderer: {},
      };
      let notify: () => void = () => undefined;
      GaussianStreamingPlayer.create = async () =>
        ({
          snapshot,
          sequence: { frames: [] },
          subscribe(listener: (value: typeof snapshot) => void) {
            notify = () => listener(snapshot);
            notify();
            return () => undefined;
          },
          async seek(seconds: number) {
            snapshot.currentTimeSeconds = seconds;
            snapshot.bufferedTimeRanges = [{ startSeconds: 30, endSeconds: 72 }];
            notify();
          },
          dispose() {},
        }) as unknown as import("../../packages/player-core/src/index.js").GaussianStreamingPlayer;
    },
    {
      playerUrl: sourceUrl("../../packages/player-core/src/index.ts"),
      rendererUrl: sourceUrl("../../packages/renderer-playcanvas/src/index.ts"),
    },
  );
  await page.getByLabel("Manifest URL").fill("/timeline-test.json");
  await page.getByRole("button", { name: "Load scene" }).click();
  const controls = page.getByRole("region", { name: "Playback controls" });
  const position = page.getByRole("slider", { name: "Playback position" });
  const ranges = controls.locator(".timeline-buffer-range");
  await expect(position).toHaveValue("30");
  await expect(ranges).toHaveCount(2);
  await expect(ranges.nth(0)).toHaveCSS("background-color", "rgb(142, 137, 149)");
  await expect(ranges.nth(0)).toHaveAttribute("style", /width: 50%/);
  await expect(ranges.nth(1)).toHaveAttribute("style", /left: 75%; width: 15%/);
  await controls.screenshot({ path: testInfo.outputPath("buffered-timeline.png") });

  await position.press("ArrowRight");
  await expect(position).toHaveValue("30.01");
  await expect(ranges).toHaveCount(1);
  await expect(ranges).toHaveAttribute("style", /left: 25%; width: 35%/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(position).toBeVisible();
  const bounds = await controls.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await position.press("ArrowRight");
  await expect(position).toHaveValue("30.02");
  await controls.screenshot({
    path: testInfo.outputPath("buffered-timeline-narrow.png"),
  });
});

test("showcase landing and manifest picker are usable without bundled content", async ({
  page,
}) => {
  await page.goto(`${showcaseUrl}/#/`);
  await expect(
    page.getByRole("heading", { name: /volumetric video.*built for the web/i }),
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
