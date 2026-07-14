import type { Transform } from "@6g-path/shared";

export interface GaussianSequenceManifest {
  version: string;
  id: string;
  durationSeconds: number;
  frameRate: number;
  frameCount: number;
  staticObjects: StaticSceneObject[];
  dynamicSequences: DynamicGaussianSequence[];
  meshObjects?: MeshSceneObject[];
  audio?: MediaTrack;
  metadata?: Record<string, unknown>;
}

export interface StaticSceneObject {
  id: string;
  url: string;
  transform?: Transform;
  priority?: number;
  byteSize?: number;
}

export interface DynamicGaussianSequence {
  id: string;
  frameCount: number;
  frameRate: number;
  frames: GaussianFrameSource[];
  transform?: Transform;
  priority?: number;
}

export interface GaussianFrameSource {
  frameIndex: number;
  timestampSeconds: number;
  url: string;
  byteSize?: number;
  metadataUrl?: string;
}

export interface MeshSceneObject {
  id: string;
  url: string;
  transform?: Transform;
  priority?: number;
}

export interface MediaTrack {
  url: string;
  contentType?: string;
  offsetSeconds?: number;
}
