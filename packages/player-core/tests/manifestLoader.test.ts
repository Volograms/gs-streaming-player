import { describe, expect, it } from "vitest";

import validManifest from "../../../test-data/manifests/minimal-valid.json";
import {
  ManifestAbortError,
  ManifestLoadValidationError,
  ManifestNetworkError,
  ManifestParseError,
  loadManifest,
} from "../src/index.js";

describe("loadManifest", () => {
  it("loads an already parsed object without rewriting relative URLs", async () => {
    const manifest = await loadManifest(validManifest);

    expect(manifest.staticObjects[0]?.url).toBe("../splats/room.rad");
  });

  it("loads Blob and File sources", async () => {
    const json = JSON.stringify(validManifest);
    const blobManifest = await loadManifest(new Blob([json]));
    const fileManifest = await loadManifest(
      new File([json], "minimal-valid.json", { type: "application/json" }),
    );

    expect(blobManifest.id).toBe("minimal-sequence");
    expect(fileManifest.id).toBe("minimal-sequence");
  });

  it("resolves all asset URLs relative to a URL manifest", async () => {
    const manifestWithOptionalAssets = {
      ...validManifest,
      audio: { url: "../audio/narration.mp3" },
      dynamicSequences: [
        {
          ...validManifest.dynamicSequences[0],
          frames: [
            {
              ...validManifest.dynamicSequences[0]!.frames[0],
              metadataUrl: "../metadata/frame_00000.json",
            },
            ...validManifest.dynamicSequences[0]!.frames.slice(1),
          ],
        },
      ],
    };
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify(manifestWithOptionalAssets), {
        headers: { "content-type": "application/json" },
        status: 200,
      });

    const manifest = await loadManifest(
      "https://media.example.test/lessons/lesson.json",
      { fetch: fetchMock },
    );

    expect(manifest.staticObjects[0]?.url).toBe(
      "https://media.example.test/splats/room.rad",
    );
    expect(manifest.dynamicSequences[0]?.frames[0]?.url).toBe(
      "https://media.example.test/splats/presenter/frame_00000.rad",
    );
    expect(manifest.meshObjects?.[0]?.url).toBe(
      "https://media.example.test/meshes/desk.glb",
    );
    expect(manifest.dynamicSequences[0]?.frames[0]?.metadataUrl).toBe(
      "https://media.example.test/metadata/frame_00000.json",
    );
    expect(manifest.audio?.url).toBe("https://media.example.test/audio/narration.mp3");
  });

  it("distinguishes network, parse, and validation errors", async () => {
    const networkFetch: typeof fetch = async () =>
      new Response("missing", { status: 404, statusText: "Not Found" });
    const parseFetch: typeof fetch = async () => new Response("not-json");
    const validationFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ version: "1.0" }));

    await expect(
      loadManifest("https://example.test/missing.json", { fetch: networkFetch }),
    ).rejects.toBeInstanceOf(ManifestNetworkError);
    await expect(
      loadManifest("https://example.test/broken.json", { fetch: parseFetch }),
    ).rejects.toBeInstanceOf(ManifestParseError);
    await expect(
      loadManifest("https://example.test/invalid.json", {
        fetch: validationFetch,
      }),
    ).rejects.toBeInstanceOf(ManifestLoadValidationError);
  });

  it("honours a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadManifest(validManifest, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ManifestAbortError);
  });

  it("cancels an in-flight network load", async () => {
    const controller = new AbortController();
    const fetchMock: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });

    const loading = loadManifest("https://example.test/manifest.json", {
      fetch: fetchMock,
      signal: controller.signal,
    });
    controller.abort();

    await expect(loading).rejects.toBeInstanceOf(ManifestAbortError);
  });
});
