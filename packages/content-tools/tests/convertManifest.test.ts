import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertValidManifest } from "@6g-path/gaussian-player";
import { describe, expect, it } from "vitest";

import legacy from "../../../test-data/manifests/minimal-valid.json";
import { runCli } from "../src/cli/runCli.js";
import { convertManifest } from "../src/convert-manifest/convertManifest.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gs-manifest-convert-"));
  const inputPath = join(root, "manifest.json");
  const source = `${JSON.stringify(legacy, null, 2)}\n`;
  await writeFile(inputPath, source);
  const messages: string[] = [];
  const io = {
    stdout: (message: string) => messages.push(message),
    stderr: (message: string) => messages.push(message),
  };
  return { root, inputPath, source, messages, io };
}

describe("convert-manifest", () => {
  it("converts metadata without assets, preserves input and refuses accidental overwrite", async () => {
    const { root, inputPath, source, messages, io } = await fixture();
    expect(await runCli(["convert-manifest", inputPath], io)).toBe(0);
    const outputPath = join(root, "manifest.v1.1.json");
    const json = await readFile(outputPath, "utf8");
    expect(json.trim().split("\n")).toHaveLength(1);
    const converted = assertValidManifest(JSON.parse(json) as unknown);
    expect(converted).toEqual({
      ...legacy,
      version: "1.1",
      $schema: converted.$schema,
    });
    expect(await readFile(inputPath, "utf8")).toBe(source);
    expect(messages.join("\n")).toContain("encoded assets unchanged");
    expect(await runCli(["convert-manifest", inputPath], io)).toBe(1);
    expect(await readFile(outputPath, "utf8")).toBe(json);
    expect(
      await runCli(["convert-manifest", inputPath, "--output", inputPath], io),
    ).toBe(1);
    expect(await readFile(inputPath, "utf8")).toBe(source);
    expect(
      await runCli(
        ["convert-manifest", inputPath, "--output", inputPath, "--force", "--pretty"],
        io,
      ),
    ).toBe(0);
    expect((await readFile(inputPath, "utf8")).split("\n").length).toBeGreaterThan(1);
  });

  it("retains explicit timing, rejects unsafe forced timing and reports malformed input before overwriting", async () => {
    const { root, inputPath, io } = await fixture();
    const outputPath = join(root, "existing.json");
    await writeFile(outputPath, "preserve me");
    expect(
      await runCli(
        [
          "convert-manifest",
          inputPath,
          "--output",
          outputPath,
          "--regular-timing",
          "true",
          "--force",
        ],
        io,
      ),
    ).toBe(1);
    expect(await readFile(outputPath, "utf8")).toBe("preserve me");
    expect(
      await runCli(["convert-manifest", inputPath, "--regular-timing", "false"], io),
    ).toBe(0);
    const converted = JSON.parse(
      await readFile(join(root, "manifest.v1.1.json"), "utf8"),
    ) as { dynamicSequences: Array<{ regularTiming: boolean }> };
    expect(converted.dynamicSequences[0]!.regularTiming).toBe(false);
    await writeFile(inputPath, "{}");
    expect(await convertManifest({ inputPath, outputPath, force: true }, io)).toBe(1);
    expect(await readFile(outputPath, "utf8")).toBe("preserve me");
  });

  it("rebases all relative asset URLs when the output directory changes", async () => {
    const { root, inputPath, io } = await fixture();
    const manifest = assertValidManifest(structuredClone(legacy));
    manifest.audio = { url: "audio/voice%20over.ogg?download=1#start" };
    manifest.staticObjects[0]!.qualityLevels = [{ level: 0, url: "static/room.sog" }];
    manifest.dynamicSequences[0]!.frames[0]!.metadataUrl = "meta/0.json";
    manifest.dynamicSequences[0]!.frames[1]!.url = "https://example.test/frame.rad";
    manifest.dynamicSequences[0]!.frames[2]!.url = "/root/frame.rad";
    await writeFile(inputPath, JSON.stringify(manifest));
    await mkdir(join(root, "converted"));
    const outputPath = join(root, "converted", "manifest.json");
    expect(await convertManifest({ inputPath, outputPath }, io)).toBe(0);
    const result = assertValidManifest(
      JSON.parse(await readFile(outputPath, "utf8")) as unknown,
    );
    expect(result.audio!.url).toBe("../audio/voice%20over.ogg?download=1#start");
    expect(result.staticObjects[0]!.url).toBe("../../splats/room.rad");
    expect(result.staticObjects[0]!.qualityLevels![0]!.url).toBe("../static/room.sog");
    expect(result.meshObjects![0]!.url).toBe("../../meshes/desk.glb");
    expect(result.dynamicSequences[0]!.frames[0]!.metadataUrl).toBe("../meta/0.json");
    expect(result.dynamicSequences[0]!.frames[0]!.qualityLevels![0]!.url).toBe(
      "../../splats/presenter/frame_00000-minimum.spz",
    );
    expect(
      result.dynamicSequences[0]!.frames.slice(1).map((frame) => frame.url),
    ).toEqual(["https://example.test/frame.rad", "/root/frame.rad"]);
  });

  it.each([
    [],
    ["input.json", "--regular-timing", "yes"],
    ["input.json", "--output"],
    ["input.json", "extra.json"],
    ["input.json", "--unknown"],
  ])("rejects invalid usage %j", async (...args) => {
    const messages: string[] = [];
    const io = {
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => messages.push(message),
    };
    expect(await runCli(["convert-manifest", ...args], io)).toBe(2);
  });
});
