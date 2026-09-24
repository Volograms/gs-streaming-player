import { convertManifest } from "./convertManifest.js";

import type { ConvertManifestRequest } from "./convertManifest.js";
import type { CliIo } from "../cli/runCli.js";

export async function runConvertManifestCli(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const request: ConvertManifestRequest = { inputPath: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--force") request.force = true;
    else if (argument === "--pretty") request.pretty = true;
    else if (argument === "--output" || argument === "--regular-timing") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) {
        io.stderr(`Option ${argument} requires a value.`);
        return 2;
      }
      if (argument === "--output") request.outputPath = value;
      else if (value === "true" || value === "false")
        request.regularTiming = value === "true";
      else {
        io.stderr("--regular-timing must be true or false (omit to auto-detect).");
        return 2;
      }
    } else if (argument.startsWith("--")) {
      io.stderr(`Unknown option: ${argument}`);
      return 2;
    } else if (request.inputPath === "") request.inputPath = argument;
    else {
      io.stderr("convert-manifest accepts exactly one input manifest.");
      return 2;
    }
  }
  if (request.inputPath === "") {
    io.stderr("convert-manifest requires an input manifest.");
    return 2;
  }
  return convertManifest(request, io);
}
