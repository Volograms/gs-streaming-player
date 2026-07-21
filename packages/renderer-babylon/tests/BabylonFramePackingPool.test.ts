import { describe, expect, it } from "vitest";

import { BabylonFramePackingPool } from "../src/index.js";

import type {
  BabylonFramePackingRequest,
  BabylonFramePackingResponse,
} from "../src/babylonFramePacking.protocol.js";
import type { BabylonPackingWorkerLike } from "../src/index.js";

class FakePackingWorker implements BabylonPackingWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<BabylonFramePackingResponse>) => void) | null = null;
  request: BabylonFramePackingRequest | undefined;
  transfer: Transferable[] | undefined;

  postMessage(message: BabylonFramePackingRequest, transfer: Transferable[]): void {
    this.request = message;
    this.transfer = transfer;
  }

  terminate(): void {}
}

describe("BabylonFramePackingPool", () => {
  it("transfers a compact SPZ clone and returns fused diagnostics", async () => {
    const worker = new FakePackingWorker();
    const pool = new BabylonFramePackingPool({
      maximumWorkers: 1,
      workerFactory: () => worker,
    });
    const compressedBytes = new Uint8Array([1, 2, 3, 4]);

    const pending = pool.packSpz(compressedBytes, "RUB", {
      maximumTextureSize: 4,
      requirePowerOfTwoHeight: false,
    });

    expect(worker.request).toMatchObject({
      constraints: { maximumTextureSize: 4, requirePowerOfTwoHeight: false },
      coordinateSystem: "RUB",
      id: 1,
    });
    expect(worker.request).toHaveProperty("spzBytes");
    const transferredBytes = new Uint8Array(
      (worker.request as { spzBytes: ArrayBuffer }).spzBytes,
    );
    expect([...transferredBytes]).toEqual([1, 2, 3, 4]);
    expect(transferredBytes.buffer).not.toBe(compressedBytes.buffer);
    expect(worker.transfer).toEqual([transferredBytes.buffer]);
    expect(compressedBytes.byteLength).toBe(4);

    worker.onmessage?.({
      data: {
        id: 1,
        nativePayload: {
          boundsMaximum: [0, 0, 0],
          boundsMinimum: [0, 0, 0],
          centers: new Float32Array(4),
          colors: new Uint8Array(4),
          covariancesA: new Uint16Array(4),
          covariancesB: new Uint16Array(2),
          numSplats: 1,
          shDegree: 0,
          sphericalHarmonics: [],
          textureSize: { height: 1, width: 1 },
        },
        ok: true,
        outputAllocatedBytes: 32,
        spzDiagnostics: {
          attributeWriteDurationMs: 2,
          inputAllocationDurationMs: 0.1,
          inputCopyDurationMs: 0.2,
          outputAllocationDurationMs: 0.3,
          totalDurationMs: 5,
          wasmDecodeDurationMs: 2.4,
        },
        temporaryAllocatedBytes: 12,
        workerDurationMs: 6,
      },
    } as unknown as MessageEvent<BabylonFramePackingResponse>);

    const result = await pending;
    expect(result.outputAllocatedBytes).toBe(32);
    expect(result.temporaryAllocatedBytes).toBe(12);
    expect(result.spzDiagnostics?.attributeWriteDurationMs).toBe(2);
    pool.dispose();
  });
});
