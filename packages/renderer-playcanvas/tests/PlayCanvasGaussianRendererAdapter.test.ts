import { describe, expect, it, vi } from "vitest";

import {
  PLAYCANVAS_SOG_CODEC_ID,
  PlayCanvasGaussianRendererAdapter,
} from "../src/index.js";

import type { GaussianFrameSource, PreparedFrame } from "@6g-path/gaussian-player";

const FRAME: GaussianFrameSource = {
  codec: PLAYCANVAS_SOG_CODEC_ID,
  frameIndex: 7,
  timestampSeconds: 0.25,
  url: "/sequence/frame-0007.sog",
};

function createApplicationEvents() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    fire(name: string): void {
      for (const listener of [...(listeners.get(name) ?? [])]) {
        listener();
      }
    },
    once: vi.fn((name: string, callback: () => void) => {
      const callbacks = listeners.get(name) ?? new Set<() => void>();
      let active = true;
      const wrapped = () => {
        if (!active) {
          return;
        }
        active = false;
        callbacks.delete(wrapped);
        callback();
      };
      callbacks.add(wrapped);
      listeners.set(name, callbacks);
      return {
        off: () => {
          active = false;
          callbacks.delete(wrapped);
        },
      };
    }),
  };
}

describe("PlayCanvasGaussianRendererAdapter", () => {
  it("requires a canvas when it owns the application", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});

    await expect(adapter.initialise()).rejects.toThrow(/canvas is required/i);
  });

  it("rejects prepare calls before initialization", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});

    await expect(adapter.prepareFrame("sequence", FRAME, {})).rejects.toThrow(
      /has not been initialised/i,
    );
  });

  it("requires complete compressed bytes for native SOG preparation", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});
    // This validation precedes PlayCanvas asset creation; mark the adapter as
    // initialized to exercise the public input contract without a WebGL DOM.
    Object.assign(adapter as unknown as { initialised: boolean }, {
      initialised: true,
    });

    await expect(adapter.prepareFrame("sequence", FRAME, {})).rejects.toThrow(
      /requires complete compressed SOG bytes/i,
    );
  });

  it("rejects renderer-neutral and unsupported compressed frame paths", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});
    Object.assign(adapter as unknown as { initialised: boolean }, {
      initialised: true,
    });

    await expect(
      adapter.prepareFrame(
        "sequence",
        { ...FRAME, codec: "spz-v4" },
        {
          compressedBytes: new ArrayBuffer(4),
        },
      ),
    ).rejects.toThrow(/requires 'sog-v2' compressed frames/i);
  });

  it("rejects a SOG-labelled frame whose URL selects another parser", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});
    Object.assign(adapter as unknown as { initialised: boolean }, {
      initialised: true,
    });

    await expect(
      adapter.prepareFrame(
        "sequence",
        { ...FRAME, url: "/sequence/frame-0007.spz" },
        { compressedBytes: new ArrayBuffer(4) },
      ),
    ).rejects.toThrow(/requires a \.sog frame URL/i);
  });

  it("commits normal playback without waiting for the diagnostic sort fence", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});
    const asset = {};
    const gsplat = {
      asset: undefined as unknown,
      enabled: false,
      layers: [0],
    };
    const dynamicEntity = {
      gsplat,
      setLocalPosition: vi.fn(),
      setLocalRotation: vi.fn(),
      setLocalScale: vi.fn(),
    };
    const prepared: PreparedFrame = {
      frameIndex: FRAME.frameIndex,
      qualityLevel: 0,
      rendererResource: asset,
      sequenceId: "sequence",
      source: FRAME,
    };
    const resource = {
      asset,
      numSplats: 42,
      presentationUseCount: 0,
      quality: { detailLevel: 1, state: "presentable" },
      releaseFinalisationScheduled: false,
      releaseRequested: false,
    };
    const events = createApplicationEvents();
    const application = {
      ...events,
      renderNextFrame: false,
      stats: { frame: { fps: 0, gsplatSort: -1, ms: 0, renderTime: -1 } },
    };
    Object.assign(adapter as unknown as Record<string, unknown>, {
      applicationValue: application,
      dynamicEntityValue: dynamicEntity,
      initialised: true,
      preparedFrames: new Map([[prepared, resource]]),
    });

    const presentation = adapter.presentFrame(prepared);
    await vi.waitFor(() => expect(application.renderNextFrame).toBe(true));
    application.fire("prerender");
    await expect(presentation).resolves.toBeUndefined();

    expect(gsplat.asset).toBe(asset);
    expect(gsplat.enabled).toBe(true);
    expect(application.renderNextFrame).toBe(true);
    expect(adapter.getMetrics().activeFrameIndex).toBe(FRAME.frameIndex);
  });

  it("resolves the presentation fence for PlayCanvas's camera component", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({});
    const camera = {};
    const component = { camera };
    const dynamicLayer = {};
    const otherLayer = {};
    const event = { off: vi.fn() };
    let frameReady:
      | ((
          camera: unknown,
          layer: unknown,
          ready: unknown,
          loadingCount: unknown,
        ) => void)
      | undefined;
    const system = {
      on: vi.fn(
        (
          _name: string,
          callback: (
            camera: unknown,
            layer: unknown,
            ready: unknown,
            loadingCount: unknown,
          ) => void,
        ) => {
          frameReady = callback;
          return event;
        },
      ),
    };
    Object.assign(adapter as unknown as Record<string, unknown>, {
      applicationValue: {
        scene: { layers: { getLayerById: () => dynamicLayer } },
        systems: { gsplat: system },
      },
      cameraEntityValue: { camera: component },
      dynamicEntityValue: { gsplat: { layers: [0] } },
      initialised: true,
    });

    const ready = (
      adapter as unknown as { waitForFrameReady(): Promise<void> }
    ).waitForFrameReady();
    frameReady?.(camera, otherLayer, true, 0);
    frameReady?.(camera, dynamicLayer, true, 1);
    expect(event.off).not.toHaveBeenCalled();
    frameReady?.(component, dynamicLayer, true, 0);

    await expect(ready).resolves.toBeUndefined();
    expect(event.off).toHaveBeenCalledOnce();
  });

  it("defers release until a pending frame-ready presentation settles", async () => {
    const adapter = new PlayCanvasGaussianRendererAdapter({ waitForFrameReady: true });
    const underlyingCamera = {};
    const cameraComponent = { camera: underlyingCamera };
    const dynamicLayer = {};
    const frameReadyEvent = { off: vi.fn() };
    let frameReady:
      | ((
          camera: unknown,
          layer: unknown,
          ready: unknown,
          loadingCount: unknown,
        ) => void)
      | undefined;
    const asset = { unload: vi.fn() };
    const assets = { remove: vi.fn() };
    const gsplat = {
      asset: undefined as unknown,
      enabled: false,
      hide: vi.fn(),
      layers: [0],
      resource: undefined as unknown,
      show: vi.fn(),
    };
    const dynamicEntity = {
      gsplat,
      setLocalPosition: vi.fn(),
      setLocalRotation: vi.fn(),
      setLocalScale: vi.fn(),
    };
    const system = {
      on: vi.fn(
        (
          _name: string,
          callback: (
            camera: unknown,
            layer: unknown,
            ready: unknown,
            loadingCount: unknown,
          ) => void,
        ) => {
          frameReady = callback;
          return frameReadyEvent;
        },
      ),
    };
    const prepared: PreparedFrame = {
      frameIndex: FRAME.frameIndex,
      qualityLevel: 0,
      rendererResource: asset,
      sequenceId: "sequence",
      source: FRAME,
    };
    const resource = {
      asset,
      numSplats: 42,
      presentationUseCount: 0,
      quality: { detailLevel: 1, state: "presentable" },
      releaseFinalisationScheduled: false,
      releaseRequested: false,
    };
    const events = createApplicationEvents();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      applicationValue: {
        ...events,
        assets,
        renderNextFrame: false,
        scene: { layers: { getLayerById: () => dynamicLayer } },
        stats: { frame: { fps: 0, gsplatSort: -1, ms: 0, renderTime: -1 } },
        systems: { gsplat: system },
      },
      cameraEntityValue: { camera: cameraComponent },
      dynamicEntityValue: dynamicEntity,
      initialised: true,
      preparedFrames: new Map([[prepared, resource]]),
    });

    const presentation = adapter.presentFrame(prepared);
    await vi.waitFor(() =>
      expect(
        (adapter as unknown as { application: { renderNextFrame: boolean } })
          .application.renderNextFrame,
      ).toBe(true),
    );
    events.fire("prerender");
    await vi.waitFor(() => expect(frameReady).toBeTypeOf("function"));

    adapter.releaseFrame(prepared);

    expect(asset.unload).not.toHaveBeenCalled();
    expect(assets.remove).not.toHaveBeenCalled();

    frameReady?.(cameraComponent, dynamicLayer, true, 0);
    await expect(presentation).resolves.toBeUndefined();

    expect(asset.unload).not.toHaveBeenCalled();
    expect(gsplat.enabled).toBe(false);
    events.fire("frameend");

    expect(adapter.getMetrics().activeFrameIndex).toBeUndefined();
    expect(adapter.getMetrics().preparedFrameCount).toBe(0);
    expect(assets.remove).toHaveBeenCalledTimes(1);
    expect(assets.remove).toHaveBeenCalledWith(asset);
    expect(asset.unload).toHaveBeenCalledOnce();
  });
});
