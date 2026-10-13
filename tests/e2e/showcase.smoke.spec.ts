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
        decodedTimeRanges: [
          { startSeconds: 15, endSeconds: 33 },
          { startSeconds: 42, endSeconds: 48 },
        ],
        decodedFrameCount: 7,
        bufferDiagnostics: {
          downloadedAheadSeconds: 30,
          decodedAheadSeconds: 3,
          compressedResidentBytes: 100_000_000,
          compressedCapacityBytes: 200_000_000,
          decodedResidentBytes: 50_000_000,
          decodedCapacityBytes: 500_000_000,
          decodedTargetFrames: 152,
        },
        currentTimeSeconds: 30,
        droppedFrameCount: 3,
        durationSeconds: 120,
        isPlaying: false,
        lifecycle: "PAUSED",
        qualityDiagnostics: {
          bufferAheadSeconds: 1.5,
          compressedBufferAheadSeconds: 30,
          dynamicFrameDetailLevel: 0.1004,
          estimatedThroughputBps: 5_000_000,
          networkConfidence: 0.75,
          targetBufferSeconds: 2,
          targetFramesPerSecond: 30,
        },
        qualityMode: { mode: "automatic" },
        renderer: { frameCommitTimeMs: 2.4, renderFramesPerSecond: 59.8 },
      };
      let notify: () => void = () => undefined;
      GaussianStreamingPlayer.create = async () =>
        ({
          snapshot,
          sequence: {
            frames: [
              {
                qualityLevels: [
                  {
                    detailLevel: 0.1,
                    level: 0,
                    metadata: { targetRatio: 0.1, tier: "preview" },
                  },
                  {
                    detailLevel: 0.2,
                    level: 1,
                    metadata: { targetRatio: 0.2, tier: "minimum" },
                  },
                ],
              },
            ],
          },
          subscribe(listener: (value: typeof snapshot) => void) {
            notify = () => listener(snapshot);
            notify();
            return () => undefined;
          },
          async seek(seconds: number) {
            snapshot.currentTimeSeconds = seconds;
            snapshot.lifecycle = "BUFFERING";
            snapshot.bufferedTimeRanges = [{ startSeconds: 30, endSeconds: 72 }];
            snapshot.decodedTimeRanges = [{ startSeconds: 42, endSeconds: 48 }];
            snapshot.decodedFrameCount = 2;
            snapshot.bufferDiagnostics.downloadedAheadSeconds = 42;
            snapshot.bufferDiagnostics.decodedAheadSeconds = 0;
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
  const decodedRanges = controls.locator(".timeline-decoded-range");
  const qualityControl = controls.locator(".quality-control");
  await expect(position).toHaveValue("30");
  await expect(ranges).toHaveCount(2);
  await expect(decodedRanges).toHaveCount(2);
  await expect(controls.getByText("Ready 7 frames")).toBeVisible();
  await expect(controls.getByText("Downloaded 30.0s")).toBeVisible();
  await expect(controls.locator(".timeline-ready-duration")).toHaveText("· 3.0s");
  await expect(controls.locator(".timeline-ready-count")).toHaveAttribute(
    "title",
    /100\.0 \/ 200\.0 MB.*50\.0 \/ 500\.0 MB.*target 152 frames/,
  );
  await expect(position).toHaveAttribute("aria-describedby", "timeline-legend");
  await expect(controls.locator(".timeline-shell")).toHaveAttribute(
    "title",
    /Grey shows downloaded.*Green shows decoded.*Pink shows played/,
  );
  await expect(controls.locator('option[value="automatic"]')).toHaveText(
    "Auto · Preview · 10%",
  );
  await expect(qualityControl).toHaveAttribute(
    "title",
    /Downloaded 30\.00s ahead; decoded 1\.50s ahead; source 30\.0 FPS; render 59\.8 FPS; handoff 2\.4 ms; lifecycle PAUSED; dropped frames 3; Measured 5\.0 Mbps/,
  );
  await expect(ranges.nth(0)).toHaveCSS("background-color", "rgb(142, 137, 149)");
  await expect(ranges.nth(0)).toHaveAttribute("style", /width: 50%/);
  await expect(ranges.nth(1)).toHaveAttribute("style", /left: 75%; width: 15%/);
  await controls.screenshot({ path: testInfo.outputPath("buffered-timeline.png") });

  await position.press("ArrowRight");
  await expect(position).toHaveValue("30.01");
  await expect(page.getByText("Buffering playback")).toBeVisible();
  await expect(ranges).toHaveCount(1);
  await expect(decodedRanges).toHaveCount(1);
  await expect(controls.getByText("Ready 2 frames")).toBeVisible();
  await expect(controls.getByText("Downloaded 42.0s")).toBeVisible();
  await expect(ranges).toHaveAttribute("style", /left: 25%; width: 35%/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(position).toBeVisible();
  await expect(controls.getByText("Ready 2 frames")).toBeVisible();
  await expect(controls.locator(".timeline-download-count")).toBeHidden();
  await expect(controls.locator(".timeline-ready-duration")).toBeHidden();
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
