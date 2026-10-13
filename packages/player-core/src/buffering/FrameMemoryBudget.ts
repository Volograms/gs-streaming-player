import type { GaussianFrameSource } from "../manifest/types.js";
import type { FrameTransferQuality, PreparedFrame } from "../renderer/types.js";

/** Learn expansion from compressed bytes to resident renderer resources. */
export class FrameMemoryBudget {
  private readonly expansion = new Map<string, number>();

  observe(frame: PreparedFrame): void {
    const bytes = frame.estimatedMemoryBytes;
    const compressed = frame.source.byteSize;
    if (
      bytes === undefined ||
      !Number.isFinite(bytes) ||
      bytes <= 0 ||
      compressed === undefined ||
      compressed <= 0
    )
      return;
    const key = frame.source.codec ?? frame.transferQuality?.codec ?? "native";
    this.expansion.set(key, Math.max(this.expansion.get(key) ?? 0, bytes / compressed));
  }

  estimate(
    source: GaussianFrameSource,
    transfer?: FrameTransferQuality,
    prepared?: PreparedFrame,
  ): number {
    const measured = prepared?.estimatedMemoryBytes;
    if (measured !== undefined && Number.isFinite(measured) && measured > 0)
      return measured;
    const bytes = source.byteSize ?? 0;
    const factor = this.expansion.get(source.codec ?? transfer?.codec ?? "native");
    if (factor !== undefined && bytes > 0) return Math.ceil(bytes * factor);
    // Until a renderer reports its allocation, reserve room for expansion, GPU
    // resources and CPU attributes instead of treating compressed bytes as RAM use.
    return Math.max(
      bytes * 8,
      (transfer?.splatCount ?? 0) * 64,
      bytes > 0 ? 1 : 1_000_000,
    );
  }
}
