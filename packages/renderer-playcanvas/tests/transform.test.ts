import { Entity, Mat4, Quat, Vec3 } from "playcanvas";
import { describe, expect, it } from "vitest";

import {
  PLAYCANVAS_SOG_CODEC_ID,
  PlayCanvasGaussianRendererAdapter,
  applyPlayCanvasTransform,
} from "../src/index.js";

import type { Transform } from "@6g-path/shared";
import type { AppBase } from "playcanvas";

const testApplication = {} as AppBase;

describe("PlayCanvas renderer capability", () => {
  it("advertises only the native SOG v2 path", () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});

    expect(adapter.canPrepareCompressedFrame(PLAYCANVAS_SOG_CODEC_ID)).toBe(true);
    expect(adapter.canPrepareCompressedFrame("spz-v4")).toBe(false);
    expect(adapter.canPrepareCompressedFrame("sog")).toBe(false);
  });
});

describe("applyPlayCanvasTransform", () => {
  function transformPoint(transform: Transform): Vec3 {
    const entity = new Entity("test", testApplication);
    applyPlayCanvasTransform(entity, transform);
    return entity.getWorldTransform().transformPoint(new Vec3(1, 2, 3));
  }

  it.each([
    { w: 0, x: 0, y: 0.5, z: 0 },
    { w: 0, x: 0, y: 1, z: 0 },
  ])("keeps a Y half-turn free of scaling for %j", (rotation) => {
    const result = transformPoint({ rotation });
    expect(result.x).toBeCloseTo(-1);
    expect(result.y).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(-3);
  });

  it("treats an all-zero quaternion as identity", () => {
    const result = transformPoint({ rotation: { w: 0, x: 0, y: 0, z: 0 } });
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(3);
  });

  it("scales locally, then rotates, then translates", () => {
    const result = transformPoint({
      position: { x: 10, y: 20, z: 30 },
      rotation: { w: 2, x: 0, y: 2, z: 0 },
      scale: { x: 2, y: 3, z: 4 },
    });
    expect(result.x).toBeCloseTo(22);
    expect(result.y).toBeCloseTo(26);
    expect(result.z).toBeCloseTo(28);
  });

  it("applies component transforms and resets omitted components", () => {
    const entity = new Entity("test", testApplication);

    applyPlayCanvasTransform(entity, {
      position: { x: 1, y: 2, z: 3 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 3, z: 4 },
    });

    expect(entity.getLocalPosition().toArray()).toEqual([1, 2, 3]);
    expect(entity.getLocalScale().toArray()).toEqual([2, 3, 4]);

    applyPlayCanvasTransform(entity, undefined);

    expect(entity.getLocalPosition().toArray()).toEqual([0, 0, 0]);
    expect(entity.getLocalScale().toArray()).toEqual([1, 1, 1]);
  });

  it("decomposes matrix transforms", () => {
    const entity = new Entity("test", testApplication);
    const matrix = new Mat4().setTRS(
      new Vec3(3, 4, 5),
      new Quat(0, 0, 0, 1),
      new Vec3(2, 2, 2),
    );

    applyPlayCanvasTransform(entity, {
      matrix: [...matrix.data] as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ],
    });

    expect(entity.getLocalPosition().toArray()).toEqual([3, 4, 5]);
    expect(entity.getLocalScale().toArray()).toEqual([2, 2, 2]);
  });
});
