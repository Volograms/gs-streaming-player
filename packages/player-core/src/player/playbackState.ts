export type PlayerLifecycleState =
  | "IDLE"
  | "LOADING"
  | "READY"
  | "PLAYING"
  | "PAUSED"
  | "BUFFERING"
  | "SEEKING"
  | "ENDED"
  | "ERROR"
  | "CLOSED";

export interface PlaybackState {
  lifecycle: PlayerLifecycleState;
  currentTimeSeconds: number;
  currentFrameIndex: number;
  playbackRate: number;
  isPlaying: boolean;
  bufferAheadSeconds: number;
  minimumReadyFrames: number;
}

export function createInitialPlaybackState(): PlaybackState {
  return {
    lifecycle: "IDLE",
    currentTimeSeconds: 0,
    currentFrameIndex: 0,
    playbackRate: 1,
    isPlaying: false,
    bufferAheadSeconds: 0,
    minimumReadyFrames: 1,
  };
}
