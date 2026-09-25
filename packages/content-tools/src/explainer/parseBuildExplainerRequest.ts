import type { BuildExplainerAssetsRequest } from "./buildExplainerAssets.js";

/** Parses `build-explainer` arguments; returns an error message instead of a request. */
export function parseBuildExplainerRequest(
  args: readonly string[],
): BuildExplainerAssetsRequest | string {
  const request: BuildExplainerAssetsRequest = {
    configPath: "",
    force: false,
    maxWorkers: 4,
    outputDir: "",
    shIterations: 10,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) {
      if (request.configPath !== "")
        return "build-explainer accepts exactly one config.";
      request.configPath = argument;
      continue;
    }
    if (argument === "--force") {
      request.force = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return `Option ${argument} requires a value.`;
    }
    index += 1;
    if (argument === "--output-dir") {
      request.outputDir = value;
    } else if (argument === "--max-workers" || argument === "--sh-iterations") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return `${argument} must be a non-negative integer.`;
      }
      if (argument === "--max-workers") request.maxWorkers = parsed;
      else request.shIterations = parsed;
    } else {
      return `Unknown option: ${argument}`;
    }
  }
  if (request.configPath === "" || request.outputDir === "") {
    return "An explainer config and --output-dir are required.";
  }
  return request;
}
