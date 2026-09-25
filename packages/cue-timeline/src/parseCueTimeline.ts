import type { Cue, CueTimeline } from "./types.js";

/**
 * Validates a `cues.json` document (version 1). Cue `params` stay application-defined;
 * this checks structure, ordering-independent timing and string references.
 */
export function parseCueTimeline(value: unknown): CueTimeline {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Cue timeline must be an object with version 1.");
  }
  const durationSeconds = value.durationSeconds;
  if (typeof durationSeconds !== "number" || !(durationSeconds > 0)) {
    throw new Error("durationSeconds must be a positive number.");
  }
  const strings = value.strings ?? {};
  if (
    !isRecord(strings) ||
    !Object.values(strings).every((text) => typeof text === "string")
  ) {
    throw new Error("strings must map keys to text.");
  }
  if (!Array.isArray(value.cues)) throw new Error("cues must be a list.");

  const ids = new Set<string>();
  const cues = value.cues.map((entry, index): Cue => {
    const label = `cues[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label} must be an object.`);
    const id = entry.id;
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(`${label}.id must be a non-empty string.`);
    }
    if (ids.has(id)) throw new Error(`Duplicate cue id '${id}'.`);
    ids.add(id);
    if (typeof entry.type !== "string" || entry.type.trim() === "") {
      throw new Error(`Cue '${id}' needs a type.`);
    }
    const start = entry.start;
    const end =
      entry.end ??
      (typeof start === "number" ? addDuration(start, entry.duration) : undefined);
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
      throw new Error(`Cue '${id}' start must be a non-negative number of seconds.`);
    }
    if (entry.end !== undefined && entry.duration !== undefined) {
      throw new Error(`Cue '${id}' must define end or duration, not both.`);
    }
    if (typeof end !== "number" || !Number.isFinite(end) || end <= start) {
      throw new Error(`Cue '${id}' needs an end (or duration) after its start.`);
    }
    if (end > durationSeconds) {
      throw new Error(`Cue '${id}' ends after the timeline duration.`);
    }
    const fadeInSeconds = readFade(entry.fadeIn, id, "fadeIn");
    const fadeOutSeconds = readFade(entry.fadeOut, id, "fadeOut");
    if (fadeInSeconds + fadeOutSeconds > end - start + 1e-9) {
      throw new Error(`Cue '${id}' fades are longer than the cue.`);
    }
    const params = entry.params ?? {};
    if (!isRecord(params)) throw new Error(`Cue '${id}' params must be an object.`);
    for (const key of stringReferences(params)) {
      if (!(key in strings)) {
        throw new Error(`Cue '${id}' references unknown string '${key}'.`);
      }
    }
    return {
      endSeconds: end,
      fadeInSeconds,
      fadeOutSeconds,
      id,
      params,
      startSeconds: start,
      type: entry.type,
    };
  });
  cues.sort((left, right) => left.startSeconds - right.startSeconds);
  return { cues, durationSeconds, strings: strings as Record<string, string> };
}

/** Looks up a display string; parse-time validation guarantees referenced keys exist. */
export function cueString(timeline: CueTimeline, key: string): string {
  const text = timeline.strings[key];
  if (text === undefined) throw new RangeError(`Unknown timeline string '${key}'.`);
  return text;
}

/** Params named `label` or ending in `Label` hold string keys. */
function stringReferences(params: Record<string, unknown>): string[] {
  return Object.entries(params)
    .filter(
      ([name, value]) =>
        (name === "label" || name.endsWith("Label")) && typeof value === "string",
    )
    .map(([, value]) => value as string);
}

function addDuration(start: number, duration: unknown): number | undefined {
  return typeof duration === "number" ? start + duration : undefined;
}

function readFade(value: unknown, id: string, name: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Cue '${id}' ${name} must be a non-negative number of seconds.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
