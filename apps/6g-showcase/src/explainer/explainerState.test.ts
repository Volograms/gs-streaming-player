import { evaluateTimeline, parseCueTimeline } from "@6g-path/cue-timeline";
import { describe, expect, it } from "vitest";

import cues from "../../explainer/cues.json";

import { parseExplainerAssets } from "./explainerAssets.js";
import { explainerTimeSeconds } from "./explainerClock.js";
import { parseExplainerSceneConfig } from "./explainerSceneConfig.js";
import { computeExplainerState, trainingIterationAt } from "./explainerState.js";

const iterations = [0, 50, 100, 200, 300, 500, 2000, 7000, 15000, 30000];
const assets = parseExplainerAssets(
  {
    checkpoints: iterations.map((iteration) => ({
      iteration,
      splatCount: 1000,
      url: `checkpoints/iteration-${iteration}.sog`,
    })),
    cameras: {
      aspect: 1.8,
      cameras: Array.from({ length: 6 }, (_, index) => ({
        image: `images/${index}.jpg`,
        position: [index, 1, 3],
        rotation: [1, 0, 0, 0],
      })),
      verticalFovDegrees: 50,
    },
    sparsePoints: {
      colorsByteOffset: 32,
      count: 2,
      positionsByteOffset: 0,
      scalesByteOffset: 24,
      url: "sparse-points.bin",
    },
    trainingCounts: [
      { iteration: 0, splatCount: 65102 },
      { iteration: 500, splatCount: 65102 },
      { iteration: 15000, splatCount: 307952 },
      { iteration: 30000, splatCount: 226785 },
    ],
    version: 1,
  },
  "https://example.test/assets/explainer/truck/explainer-assets.json",
);
const timeline = parseCueTimeline(cues);
const at = (time: number) =>
  computeExplainerState(timeline, evaluateTimeline(timeline, time), assets);

describe("computeExplainerState with the talk's cues", () => {
  it("fades the stage in and keeps the object hidden before the reveal", () => {
    expect(at(0).stage.visibility).toBe(0);
    expect(at(2).stage.visibility).toBe(1);
    expect(at(19).demo).toMatchObject({ iteration: undefined, scale: 0 });
  });

  it("grows the final model during the reveal and turns it once", () => {
    const revealing = at(21.5).demo;
    expect(revealing.iteration).toBe(30000);
    expect(revealing.scale).toBeGreaterThan(0);
    expect(revealing.scale).toBeLessThan(1);
    expect(at(25.5).demo.yawDegrees).toBeCloseTo(180, 6);
    expect(at(27.99).demo.yawDegrees).toBeCloseTo(360, 0);
  });

  it("dissolves the model through its initial fog into the sparse cloud", () => {
    expect(at(28.5).demo).toMatchObject({ iteration: 30000, scale: 1 });
    expect(at(30).demo).toMatchObject({ iteration: 0, scale: 1 });
    expect(at(40).demo.iteration).toBeUndefined();
    expect(at(29).cloud.visibility).toBeGreaterThan(0);
    expect(at(33).cloud).toMatchObject({ swell: 0, visibility: 1 });
  });

  it("swells the points into initial gaussians and dims them for the hero", () => {
    expect(at(36.5).cloud.swell).toBeCloseTo(0.5, 6);
    expect(at(39).cloud).toMatchObject({ swell: 1, visibility: 1 });
    expect(at(50).cloud.visibility).toBeCloseTo(0.25, 6);
    expect(at(50).cloud.swell).toBe(1);
  });

  it("shows the camera ring, then one highlighted training camera", () => {
    expect(at(40).cameras).toMatchObject({ highlight: undefined, ringVisibility: 1 });
    expect(at(70).cameras).toMatchObject({
      highlight: { camera: 5, visibility: 1 },
      ringVisibility: 0,
    });
  });

  it("steps through the early checkpoints and counts iterations", () => {
    const start = at(66);
    expect(start.demo).toMatchObject({ iteration: 0, scale: 1 });
    expect(start.counters.iteration).toMatchObject({ label: "Iteración", value: 0 });
    expect(at(70).demo.iteration).toBe(50);
    expect(at(82.5).demo.iteration).toBe(7000);
  });

  it("brings the object to the close-up pose for the training beats", () => {
    expect(at(60).demo.focus).toBe(0);
    expect(at(65).demo.focus).toBeGreaterThan(0);
    expect(at(65).demo.focus).toBeLessThan(1);
    expect(at(90).demo.focus).toBe(1);
    expect(at(110).demo.focus).toBe(0);
  });

  it("shows real gaussian counts at the densification peak", () => {
    const peak = at(95);
    expect(peak.demo.iteration).toBe(15000);
    expect(peak.counters.gaussians).toMatchObject({
      label: "Gaussianas",
      value: 307952,
      visibility: 1,
    });
  });

  it("keeps the final model on the pedestal through the last beats", () => {
    expect(at(112).demo).toMatchObject({ iteration: 30000, scale: 1 });
    expect(at(131).demo.iteration).toBe(30000);
    expect(at(112).counters.iteration.visibility).toBe(0);
  });

  it("gives each shipped checkpoint an equal share of a training cue", () => {
    const cue = evaluateTimeline(timeline, 66).get("b4-training");
    const halfway = { ...cue, progress: 0.5 };
    // Eight checkpoints between 0 and 7000: halfway is 3.5 steps in.
    expect(trainingIterationAt(halfway, iterations)).toEqual({
      checkpoint: 200,
      continuous: 250,
    });
  });
});

describe("explainerTimeSeconds", () => {
  const frameTimestamps = [0, 0.5, 1, 1.5];

  it("follows the clock inside the frame on screen", () => {
    expect(
      explainerTimeSeconds({
        clockSeconds: 1.2,
        durationSeconds: 2,
        frameIndex: 2,
        frameTimestamps,
      }),
    ).toBe(1.2);
  });

  it("holds at the displayed frame while playback stalls", () => {
    const time = explainerTimeSeconds({
      clockSeconds: 1.9,
      durationSeconds: 2,
      frameIndex: 1,
      frameTimestamps,
    });
    expect(time).toBeGreaterThan(0.99);
    expect(time).toBeLessThan(1);
  });

  it("uses the sequence duration after the last frame", () => {
    expect(
      explainerTimeSeconds({
        clockSeconds: 1.8,
        durationSeconds: 2,
        frameIndex: 3,
        frameTimestamps,
      }),
    ).toBe(1.8);
  });
});

describe("explainer configuration", () => {
  it("resolves checkpoint URLs against the asset index", () => {
    expect(assets.checkpoints[0]!.url).toBe(
      "https://example.test/assets/explainer/truck/checkpoints/iteration-0.sog",
    );
    expect(() => parseExplainerAssets({ checkpoints: [], version: 1 }, "x:")).toThrow(
      /no checkpoints/,
    );
  });

  it("reads stage placement and honours an assets URL override", () => {
    const config = parseExplainerSceneConfig(
      {
        assetsUrl: "a.json",
        counters: { offset: [0, 0.4, 0], width: 0.5 },
        densify: { labelOffset: [0, 0.3, 0], position: [3, 1, 0], scale: 1 },
        hero: {
          labelOffset: [0, 0.15, 0],
          position: [0, 2, 2],
          sigma: 0.3,
          tiltDegrees: 20,
        },
        focus: {
          countersOffset: [0, 0.5, 0],
          objectScale: 0.25,
          position: [0.7, 0.6, 0.4],
          yawDegrees: -120,
        },
        stage: {
          objectScale: 0.1,
          pedestalHeight: 1.2,
          pedestalRadius: 0.3,
          position: [1, 0, 1],
          yawDegrees: -90,
        },
        version: 1,
      },
      "https://cdn.test/explainer-assets.json",
    );
    expect(config.assetsUrl).toBe("https://cdn.test/explainer-assets.json");
    expect(config.stage.position).toEqual([1, 0, 1]);
    expect(() => parseExplainerSceneConfig({ version: 1, assetsUrl: "a" })).toThrow();
  });
});
