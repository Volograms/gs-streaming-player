export type CueParams = Readonly<Record<string, unknown>>;

/**
 * One timed beat. Times are seconds on the media timeline (the presenter's audio and
 * frame timestamps), never wall-clock time.
 */
export interface Cue {
  /** Seconds after start over which the envelope rises from 0 to 1. */
  fadeInSeconds: number;
  /** Seconds before end over which the envelope falls from 1 to 0. */
  fadeOutSeconds: number;
  endSeconds: number;
  id: string;
  params: CueParams;
  startSeconds: number;
  /** Application-defined kind, e.g. "demo-object.reveal". */
  type: string;
}

export interface CueTimeline {
  cues: readonly Cue[];
  durationSeconds: number;
  /** Display strings referenced by cue params, kept in data for localisation. */
  strings: Readonly<Record<string, string>>;
}

export type CuePhase = "pending" | "active" | "done";

export interface CueState {
  cue: Cue;
  /** 0..1 visibility-style weight including fades; 0 outside the cue. */
  envelope: number;
  phase: CuePhase;
  /** Linear 0..1 position within the cue, clamped (0 before, 1 after). */
  progress: number;
}

export interface TimelineState {
  /** Cue states in timeline order. */
  cues: readonly CueState[];
  get(id: string): CueState;
  timeSeconds: number;
}
