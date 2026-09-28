import { evaluateTimeline, parseCueTimeline } from "@6g-path/cue-timeline";

import cueDocument from "../../explainer/cues.json";

import { loadEllipsoids, loadSparsePoints } from "./explainerAssets.js";
import { explainerTimeSeconds } from "./explainerClock.js";
import { ExplainerScene } from "./ExplainerScene.js";
import { computeExplainerState } from "./explainerState.js";

import type { ComparisonIndex, ExplainerAssets } from "./explainerAssets.js";
import type { ExplainerVisualToggles } from "./ExplainerScene.js";
import type { ExplainerSceneConfig } from "./explainerSceneConfig.js";
import type { ComparisonImages } from "./visuals/ComparisonPanels.js";
import type { CueTimeline } from "@6g-path/cue-timeline";
import type { GaussianStreamingPlayer } from "@6g-path/gaussian-player";
import type { PlayCanvasGaussianRendererAdapter } from "@6g-path/gaussian-renderer-playcanvas";

export interface ExplainerDebugInfo {
  activeCueIds: readonly string[];
  frameIndex: number;
  timeSeconds: number;
}

/**
 * Drives the explainer scene from the presenter frame on screen. Each render update
 * evaluates the cue timeline at that frame's time, so the layer has no state of its own
 * to drift, and seeking or stalling the player moves it too.
 */
export class ExplainerController {
  readonly timeline: CueTimeline;
  readonly toggles: ExplainerVisualToggles = {
    cameras: true,
    cloud: true,
    comparison: true,
    counters: true,
    demo: true,
    densify: true,
    ellipsoids: true,
    hero: true,
    projection: true,
    stage: true,
  };
  private readonly adapter: PlayCanvasGaussianRendererAdapter;
  private readonly assets: ExplainerAssets;
  private debug: ExplainerDebugInfo = {
    activeCueIds: [],
    frameIndex: 0,
    timeSeconds: 0,
  };
  private disposed = false;
  private readonly frameTimestamps: readonly number[];
  private readonly player: GaussianStreamingPlayer;
  private readonly scene: ExplainerScene;
  private readonly updateListener = () => this.update();

  static async create(
    adapter: PlayCanvasGaussianRendererAdapter,
    player: GaussianStreamingPlayer,
    assets: ExplainerAssets,
    config: ExplainerSceneConfig,
    signal?: AbortSignal,
  ): Promise<ExplainerController> {
    const timeline = parseCueTimeline(cueDocument);
    validateAcrossTimeline(timeline, assets);
    const [sparsePoints, projectionImage, ellipsoids, comparison] = await Promise.all([
      loadSparsePoints(assets.sparsePoints, signal),
      assets.projectionView === undefined
        ? Promise.resolve(undefined)
        : loadImage(assets.projectionView.url, signal),
      assets.ellipsoids === undefined
        ? Promise.resolve(undefined)
        : loadEllipsoids(assets.ellipsoids, signal),
      assets.comparison === undefined
        ? Promise.resolve(undefined)
        : loadComparison(assets.comparison, signal),
    ]);
    const scene = await ExplainerScene.create(
      adapter,
      assets,
      { comparison, ellipsoids, projectionImage, sparsePoints },
      config,
      signal,
    );
    return new ExplainerController(adapter, player, assets, timeline, scene);
  }

  private constructor(
    adapter: PlayCanvasGaussianRendererAdapter,
    player: GaussianStreamingPlayer,
    assets: ExplainerAssets,
    timeline: CueTimeline,
    scene: ExplainerScene,
  ) {
    this.adapter = adapter;
    this.player = player;
    this.assets = assets;
    this.timeline = timeline;
    this.scene = scene;
    const { frameRate, frames } = player.sequence;
    this.frameTimestamps = frames.map(
      (frame, index) => frame.timestampSeconds ?? index / frameRate,
    );
    adapter.application.on("update", this.updateListener);
    this.update();
  }

  get debugInfo(): Readonly<ExplainerDebugInfo> {
    return this.debug;
  }

  /** Re-applies the current state, e.g. after a debug toggle while paused. */
  refresh(): void {
    this.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.adapter.application.off("update", this.updateListener);
    this.scene.dispose();
  }

  private update(): void {
    if (this.disposed) return;
    const snapshot = this.player.snapshot;
    const frameIndex = snapshot.renderer.activeFrameIndex ?? snapshot.currentFrameIndex;
    const timeSeconds = explainerTimeSeconds({
      clockSeconds: snapshot.currentTimeSeconds,
      durationSeconds: snapshot.durationSeconds,
      frameIndex,
      frameTimestamps: this.frameTimestamps,
    });
    const state = evaluateTimeline(this.timeline, timeSeconds);
    this.scene.apply(
      computeExplainerState(this.timeline, state, this.assets),
      this.toggles,
    );
    this.debug = {
      activeCueIds: state.cues
        .filter(({ phase }) => phase === "active")
        .map(({ cue }) => cue.id),
      frameIndex,
      timeSeconds,
    };
  }
}

/**
 * Decodes to an ImageBitmap, which both the WebGPU and WebGL2 uploads accept,
 * optionally downscaled to `width` pixels (keeping the aspect ratio).
 */
async function loadImage(
  url: string,
  signal?: AbortSignal,
  width?: number,
): Promise<ImageBitmap> {
  const response = await fetch(url, signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new Error(`Explainer image unavailable (${response.status}): ${url}`);
  }
  return createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
    ...(width === undefined ? {} : { resizeQuality: "high", resizeWidth: width }),
  });
}

/** Panels are small, so their images are decoded at reduced size to save memory. */
const COMPARISON_TEXTURE_WIDTH = 512;

async function loadComparison(
  index: ComparisonIndex,
  signal?: AbortSignal,
): Promise<ComparisonImages> {
  const width = Math.min(COMPARISON_TEXTURE_WIDTH, index.width);
  const [photo, ...renders] = await Promise.all([
    loadImage(index.photoUrl, signal, width),
    ...index.renders.map(({ url }) => loadImage(url, signal, width)),
  ]);
  return {
    photo: photo!,
    renders: new Map(
      index.renders.map(({ iteration }, order) => [iteration, renders[order]!]),
    ),
  };
}

/** Fails at load, not mid-talk, if a cue's params do not fit the shipped assets. */
function validateAcrossTimeline(timeline: CueTimeline, assets: ExplainerAssets): void {
  const comparisonCamera = assets.comparison?.camera;
  for (const cue of timeline.cues) {
    if (cue.type !== "camera-ring.highlight" || comparisonCamera === undefined)
      continue;
    if (cue.params.camera !== comparisonCamera) {
      throw new Error(
        `Cue '${cue.id}' highlights camera ${String(cue.params.camera)}, but the ` +
          `comparison panels show camera ${comparisonCamera}.`,
      );
    }
  }
  const times = timeline.cues.flatMap(({ endSeconds, startSeconds }) => [
    startSeconds,
    (startSeconds + endSeconds) / 2,
    endSeconds,
  ]);
  for (const time of times) {
    computeExplainerState(timeline, evaluateTimeline(timeline, time), assets);
  }
}
