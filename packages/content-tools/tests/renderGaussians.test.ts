import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { encodePng } from "../src/explainer/encodePng.js";
import { renderGaussians } from "../src/explainer/renderGaussians.js";

import type { GaussianCloud, PinholeCamera } from "../src/explainer/renderGaussians.js";

const SH_C0 = 0.28209479177387814;
const camera: PinholeCamera = {
  eye: [0, 0, 5],
  height: 32,
  lookAt: [0, 0, 0],
  verticalFovDegrees: 40,
  width: 48,
};

/** Isotropic gaussians with SH degree 0 colours given in 0..1. */
function cloud(
  gaussians: {
    colour: [number, number, number];
    opacity: number;
    position: [number, number, number];
    sigma: number;
  }[],
): GaussianCloud {
  const count = gaussians.length;
  const result: GaussianCloud = {
    count,
    opacities: new Float32Array(count),
    positions: new Float32Array(count * 3),
    rotations: new Float32Array(count * 4),
    scales: new Float32Array(count * 3),
    shDc: new Float32Array(count * 3),
    shRest: undefined,
  };
  gaussians.forEach(({ colour, opacity, position, sigma }, i) => {
    result.opacities[i] = opacity;
    result.positions.set(position, i * 3);
    result.rotations.set([1, 0, 0, 0], i * 4);
    result.scales.set([sigma, sigma, sigma], i * 3);
    result.shDc.set(
      colour.map((value) => (value - 0.5) / SH_C0),
      i * 3,
    );
  });
  return result;
}

const pixel = (image: Uint8ClampedArray, x: number, y: number) =>
  Array.from(
    image.subarray((y * camera.width + x) * 4, (y * camera.width + x) * 4 + 4),
  );

describe("renderGaussians", () => {
  it("draws a gaussian at the image centre and leaves the background transparent", () => {
    const image = renderGaussians(
      cloud([{ colour: [1, 0, 0], opacity: 0.9, position: [0, 0, 0], sigma: 0.2 }]),
      camera,
    );
    const [r, g, b, a] = pixel(image, 24, 16);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(10);
    expect(b).toBeLessThan(10);
    expect(a).toBeGreaterThan(200);
    expect(pixel(image, 0, 0)[3]).toBe(0);
  });

  it("composites front to back, so the nearer gaussian wins", () => {
    const image = renderGaussians(
      cloud([
        { colour: [0, 0, 1], opacity: 0.99, position: [0, 0, -1], sigma: 0.3 },
        { colour: [1, 0, 0], opacity: 0.99, position: [0, 0, 1], sigma: 0.3 },
      ]),
      camera,
    );
    const [r, , b] = pixel(image, 24, 16);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(40);
  });

  it("places points right of and above the view centre on the right and top", () => {
    const image = renderGaussians(
      cloud([
        { colour: [0, 1, 0], opacity: 0.99, position: [0.8, 0.5, 0], sigma: 0.08 },
      ]),
      camera,
    );
    let best = { alpha: -1, x: 0, y: 0 };
    for (let y = 0; y < camera.height; y += 1) {
      for (let x = 0; x < camera.width; x += 1) {
        const alpha = pixel(image, x, y)[3]!;
        if (alpha > best.alpha) best = { alpha, x, y };
      }
    }
    expect(best.x).toBeGreaterThan(24);
    expect(best.y).toBeLessThan(16);
  });
});

describe("encodePng", () => {
  it("writes a valid RGBA PNG whose pixels round-trip", () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 9,
    ]);
    const png = encodePng(rgba, 2, 2);
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(png.toString("latin1", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png[25]).toBe(6);
    const idatLength = png.readUInt32BE(33);
    expect(png.toString("latin1", 37, 41)).toBe("IDAT");
    const rows = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...rows]).toEqual([0, ...rgba.subarray(0, 8), 0, ...rgba.subarray(8, 16)]);
  });
});
