import { waitWithAbort } from "./abort.js";
import { SparkRendererStateError } from "./errors.js";

import type {
  FramePreparationOptions,
  GaussianFrameSource,
  PreparedFrame,
  RendererResourceMetrics,
} from "@6g-path/gaussian-player";
import type { SplatMesh, SplatMeshOptions } from "@sparkjsdev/spark";
import type { Scene } from "three";

export type SparkFrameSlotState =
  "cancelled" | "empty" | "failed" | "loading" | "ready" | "released";

export interface SparkFrameSlotSnapshot {
  error?: unknown;
  frameIndex?: number;
  loadedBytes?: number;
  qualityLevel?: number;
  sequenceId?: string;
  slotId: number;
  source?: GaussianFrameSource;
  state: SparkFrameSlotState;
  totalBytes?: number;
  visible: boolean;
}

export interface SparkFrameSlotOptions {
  createSplatMesh(options: SplatMeshOptions): SplatMesh;
  scene: Scene;
  slotId: number;
}

export class SparkFrameSlot {
  readonly slotId: number;
  private abortController: AbortController | undefined;
  private errorValue: unknown;
  private frameValue: PreparedFrame | undefined;
  private loadedBytesValue: number | undefined;
  private meshValue: SplatMesh | undefined;
  private readonly options: SparkFrameSlotOptions;
  private sequenceIdValue: string | undefined;
  private sourceValue: GaussianFrameSource | undefined;
  private stateValue: SparkFrameSlotState = "empty";
  private totalBytesValue: number | undefined;

  constructor(options: SparkFrameSlotOptions) {
    this.options = options;
    this.slotId = options.slotId;
  }

  get frame(): PreparedFrame | undefined {
    return this.frameValue;
  }

  get mesh(): SplatMesh | undefined {
    return this.meshValue;
  }

  get snapshot(): SparkFrameSlotSnapshot {
    return {
      ...(this.errorValue === undefined ? {} : { error: this.errorValue }),
      ...(this.frameValue === undefined
        ? this.sequenceIdValue === undefined
          ? {}
          : { sequenceId: this.sequenceIdValue }
        : {
            frameIndex: this.frameValue.frameIndex,
            qualityLevel: this.frameValue.qualityLevel,
            sequenceId: this.frameValue.sequenceId,
          }),
      ...(this.loadedBytesValue === undefined
        ? {}
        : { loadedBytes: this.loadedBytesValue }),
      slotId: this.slotId,
      ...(this.sourceValue === undefined ? {} : { source: this.sourceValue }),
      state: this.stateValue,
      ...(this.totalBytesValue === undefined
        ? {}
        : { totalBytes: this.totalBytesValue }),
      visible: this.meshValue?.visible ?? false,
    };
  }

  get state(): SparkFrameSlotState {
    return this.stateValue;
  }

  async prepare(
    sequenceId: string,
    source: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame> {
    if (this.stateValue === "loading" || this.stateValue === "ready") {
      throw new SparkRendererStateError(
        `Frame slot ${this.slotId} already owns an active frame.`,
      );
    }
    if (this.stateValue === "released") {
      throw new SparkRendererStateError(`Frame slot ${this.slotId} has been released.`);
    }

    this.clearFrame();
    this.stateValue = "loading";
    this.sourceValue = source;
    this.sequenceIdValue = sequenceId;
    const controller = new AbortController();
    this.abortController = controller;
    const unlinkExternalSignal = this.linkExternalSignal(options.signal, controller);

    try {
      const mesh = this.options.createSplatMesh({
        editable: false,
        onProgress: (event) => {
          if (controller.signal.aborted) {
            return;
          }
          this.loadedBytesValue = event.loaded;
          this.totalBytesValue = event.lengthComputable ? event.total : undefined;
          options.onProgress?.({
            ...(event.lengthComputable
              ? {
                  fraction: event.total === 0 ? 0 : event.loaded / event.total,
                  totalBytes: event.total,
                }
              : {}),
            loadedBytes: event.loaded,
            objectId: `${sequenceId}:${source.frameIndex}`,
            url: source.url,
          });
        },
        paged: true,
        url: source.url,
      });
      mesh.visible = false;
      this.meshValue = mesh;
      await waitWithAbort(mesh.initialized, controller.signal, () => undefined);
      if (this.isReleased()) {
        throw new SparkRendererStateError(`Frame slot ${this.slotId} was released.`);
      }
      this.options.scene.add(mesh);
      const frame: PreparedFrame = {
        frameIndex: source.frameIndex,
        qualityLevel: options.targetQualityLevel ?? 0,
        rendererResource: this,
        sequenceId,
        source,
      };
      this.frameValue = frame;
      this.stateValue = "ready";
      return frame;
    } catch (error) {
      this.disposeMesh();
      if (!this.isReleased()) {
        this.errorValue = error;
        this.stateValue = controller.signal.aborted ? "cancelled" : "failed";
      }
      throw error;
    } finally {
      unlinkExternalSignal();
      if (this.abortController === controller) {
        this.abortController = undefined;
      }
    }
  }

  present(): void {
    this.requireReadyMesh().visible = true;
  }

  hide(): void {
    this.requireReadyMesh().visible = false;
  }

  cancel(): void {
    this.abortController?.abort();
  }

  setLodScale(scale: number): void {
    const mesh = this.meshValue;
    if (mesh !== undefined) {
      mesh.lodScale = scale;
    }
  }

  setMaximumSphericalHarmonics(maximum: 0 | 1 | 2 | 3): void {
    const mesh = this.meshValue;
    if (mesh !== undefined && mesh.maxSh !== maximum) {
      mesh.maxSh = maximum;
      mesh.updateGenerator();
    }
  }

  getResourceMetrics(): RendererResourceMetrics | undefined {
    if (this.sourceValue === undefined || this.frameValue === undefined) {
      if (this.stateValue !== "loading" || this.sourceValue === undefined) {
        return undefined;
      }
    }

    const sequenceId = this.sequenceIdValue ?? "pending";
    return {
      id: `${sequenceId}:${this.sourceValue.frameIndex}:slot-${this.slotId}`,
      kind: "dynamic-frame",
      ...(this.loadedBytesValue === undefined
        ? {}
        : { loadedBytes: this.loadedBytesValue }),
      state: this.stateValue === "ready" ? "ready" : "loading",
      ...(this.totalBytesValue === undefined
        ? {}
        : { totalBytes: this.totalBytesValue }),
      url: this.sourceValue.url,
      visible: this.meshValue?.visible ?? false,
    };
  }

  release(): void {
    if (this.stateValue === "released") {
      return;
    }
    this.stateValue = "released";
    this.abortController?.abort();
    this.disposeMesh();
    this.frameValue = undefined;
    this.sequenceIdValue = undefined;
  }

  private clearFrame(): void {
    this.disposeMesh();
    this.errorValue = undefined;
    this.frameValue = undefined;
    this.loadedBytesValue = undefined;
    this.sourceValue = undefined;
    this.sequenceIdValue = undefined;
    this.totalBytesValue = undefined;
  }

  private disposeMesh(): void {
    const mesh = this.meshValue;
    if (mesh !== undefined) {
      this.meshValue = undefined;
      mesh.removeFromParent();
      mesh.dispose();
    }
  }

  private linkExternalSignal(
    signal: AbortSignal | undefined,
    controller: AbortController,
  ): () => void {
    if (signal === undefined) {
      return () => undefined;
    }
    if (signal.aborted) {
      controller.abort();
      return () => undefined;
    }
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    return () => signal.removeEventListener("abort", abort);
  }

  private requireReadyMesh(): SplatMesh {
    if (this.stateValue !== "ready" || this.meshValue === undefined) {
      throw new SparkRendererStateError(`Frame slot ${this.slotId} is not ready.`);
    }
    return this.meshValue;
  }

  private isReleased(): boolean {
    return this.stateValue === "released";
  }
}
