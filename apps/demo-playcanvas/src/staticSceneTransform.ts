import type { StaticSceneObject } from "@6g-path/gaussian-player";

export interface StaticSceneTransformConfiguration {
  readonly rotationXDegrees?: string;
  readonly scale?: string;
}

export function createStaticSceneTransform({
  rotationXDegrees: rotationXDegreesValue,
  scale: scaleValue,
}: StaticSceneTransformConfiguration): StaticSceneObject["transform"] | undefined {
  const rotationXDegrees = finiteNumber(rotationXDegreesValue, 0);
  const scale = finiteNumber(scaleValue, 1);
  if (rotationXDegrees === 0 && scale === 1) {
    return undefined;
  }

  const halfRotationXRadians = (rotationXDegrees * Math.PI) / 360;
  return {
    ...(rotationXDegrees === 0
      ? {}
      : {
          rotation: {
            w: Math.cos(halfRotationXRadians),
            x: Math.sin(halfRotationXRadians),
            y: 0,
            z: 0,
          },
        }),
    ...(scale === 1
      ? {}
      : {
          scale: {
            x: scale,
            y: scale,
            z: scale,
          },
        }),
  };
}

function finiteNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
