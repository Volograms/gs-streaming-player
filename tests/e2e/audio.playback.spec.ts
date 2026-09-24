import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import type {
  GaussianRendererAdapter,
  GaussianStreamingPlayer,
} from "../../packages/player-core/src/index.js";

interface AudioHarness {
  audio: HTMLAudioElement;
  errors: string[];
  player: GaussianStreamingPlayer;
  presentations: { frameIndex: number; atMs: number }[];
  url: string;
}

declare global {
  interface Window {
    audioHarness: AudioHarness;
  }
}

const showcaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_SHOWCASE_PORT ?? "4180"}`;
const sourceUrl = `/@fs/${fileURLToPath(new URL("../../packages/player-core/src/index.ts", import.meta.url)).replaceAll("\\", "/")}`;

for (const { frameRate, manifestVersion } of [
  { frameRate: 25, manifestVersion: "1.0" },
  { frameRate: 30, manifestVersion: "1.1" },
]) {
  test(`native browser audio loops, pauses, and seeks at ${frameRate} fps (manifest ${manifestVersion})`, async ({
    page,
  }) => {
    await page.goto(`${showcaseUrl}/#/demo`);
    await page.evaluate(
      async ({ frameRate, manifestVersion, sourceUrl }) => {
        const { GaussianStreamingPlayer } = (await import(
          sourceUrl
        )) as typeof import("../../packages/player-core/src/index.js");
        // A small silent PCM track exercises the browser decoder without external media.
        const sampleRate = 8_000;
        const duration = 0.4;
        const sampleCount = sampleRate * duration;
        const wav = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(wav);
        const text = (offset: number, value: string) => {
          for (let index = 0; index < value.length; index += 1)
            view.setUint8(offset + index, value.charCodeAt(index));
        };
        text(0, "RIFF");
        view.setUint32(4, wav.byteLength - 8, true);
        text(8, "WAVE");
        text(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        text(36, "data");
        view.setUint32(40, sampleCount * 2, true);
        const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
        const audio = new Audio(url);
        const presentations: AudioHarness["presentations"] = [];
        const quality = {
          detailLevel: 1,
          selectedSplatCount: 1_000,
          state: "presentable" as const,
        };
        const renderer: GaussianRendererAdapter = {
          initialise: async () => undefined,
          dispose: () => undefined,
          getFramePresentationQuality: () => quality,
          getMetrics: () => ({
            failedResourceLoadCount: 0,
            loadedMeshObjectCount: 0,
            loadedStaticObjectCount: 0,
            loadingResourceCount: 0,
            preparedFrameCount: 0,
            resources: [],
          }),
          loadMesh: async (object) => ({ id: object.id, kind: "mesh" }),
          loadStaticObject: async (object) => ({ id: object.id, kind: "static-splat" }),
          prepareFrame: async (sequenceId, source) => ({
            frameIndex: source.frameIndex,
            qualityLevel: 1,
            rendererResource: {},
            sequenceId,
            source,
          }),
          presentFrame: (frame) => {
            presentations.push({
              frameIndex: frame.frameIndex,
              atMs: performance.now(),
            });
          },
          refineFrame: async () => quality,
          hideFrame: () => undefined,
          releaseFrame: () => undefined,
          releaseObject: () => undefined,
          setFrameRefinement: () => undefined,
          setFrameTransform: () => undefined,
          setObjectTransform: () => undefined,
          setObjectVisibility: () => undefined,
          setRenderQuality: () => undefined,
        };
        const frameCount = duration * frameRate;
        const player = await GaussianStreamingPlayer.create({
          audioElementFactory: () => audio,
          buffer: { futureFrameCount: 3, minimumReadyFrames: 1, previousFrameCount: 1 },
          loop: true,
          renderer,
          manifest: {
            version: manifestVersion,
            id: "browser-audio",
            frameRate,
            frameCount,
            durationSeconds: duration,
            audio: { url },
            staticObjects: [],
            dynamicSequences: [
              {
                id: "actor",
                frameRate,
                frameCount,
                ...(manifestVersion === "1.1" ? { regularTiming: true } : {}),
                frames: Array.from({ length: frameCount }, (_, frameIndex) => ({
                  ...(manifestVersion === "1.1"
                    ? {}
                    : {
                        frameIndex,
                        timestampSeconds: frameIndex / frameRate,
                      }),
                  url: `frames/${frameIndex}.sog`,
                })),
              },
            ],
          },
        });
        const errors: string[] = [];
        player.subscribe((snapshot) => {
          if (snapshot.error !== undefined) errors.push(String(snapshot.error));
        });
        window.audioHarness = { audio, player, presentations, errors, url };
        const button = document.createElement("button");
        button.textContent = "Start audio regression";
        button.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647";
        button.onclick = () => {
          void player.play().catch((error: unknown) => errors.push(String(error)));
        };
        document.body.append(button);
      },
      { frameRate, manifestVersion, sourceUrl },
    );

    await page.getByRole("button", { name: "Start audio regression" }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const frames = window.audioHarness.presentations;
            return frames.filter(
              (frame, index) =>
                index > 0 && frame.frameIndex < frames[index - 1]!.frameIndex,
            ).length;
          }),
        { timeout: 5_000 },
      )
      .toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => window.audioHarness.errors)).toEqual([]);

    const paused = await page.evaluate(() => {
      const { audio, player, presentations } = window.audioHarness;
      player.pause();
      return { audioTime: audio.currentTime, count: presentations.length };
    });
    // Give native media enough time to expose an unwanted outstanding resume.
    await page.waitForTimeout(120);
    const afterPause = await page.evaluate(() => ({
      audioTime: window.audioHarness.audio.currentTime,
      count: window.audioHarness.presentations.length,
      paused: window.audioHarness.audio.paused,
    }));
    expect(afterPause.paused).toBe(true);
    expect(afterPause.count).toBe(paused.count);
    expect(afterPause.audioTime).toBeCloseTo(paused.audioTime, 2);

    await page.evaluate(async () => {
      await window.audioHarness.player.seek(0.2);
    });
    await expect
      .poll(() => page.evaluate(() => window.audioHarness.audio.currentTime))
      .toBeCloseTo(0.2, 2);
    await page.getByRole("button", { name: "Start audio regression" }).click();
    await expect
      .poll(() => page.evaluate(() => window.audioHarness.presentations.length))
      .toBeGreaterThan(paused.count + 3);
    const disposed = await page.evaluate(() => {
      const { audio, player, errors, url } = window.audioHarness;
      player.dispose();
      URL.revokeObjectURL(url);
      return { paused: audio.paused, src: audio.getAttribute("src"), errors };
    });
    expect(disposed).toEqual({ paused: true, src: null, errors: [] });
  });
}
