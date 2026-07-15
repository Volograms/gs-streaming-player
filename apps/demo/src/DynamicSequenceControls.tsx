interface DynamicSequenceControlsProps {
  disabled: boolean;
  frameCount: number;
  frameIndex: number;
  isBuffering: boolean;
  isPlaying: boolean;
  onNext(): void;
  onPlayPause(): void;
  onPrevious(): void;
  preparedFrameCount: number;
  sourceFrameIndex: number;
  status: "failed" | "loading" | "ready";
}

export function DynamicSequenceControls({
  disabled,
  frameCount,
  frameIndex,
  isBuffering,
  isPlaying,
  onNext,
  onPlayPause,
  onPrevious,
  preparedFrameCount,
  sourceFrameIndex,
  status,
}: DynamicSequenceControlsProps) {
  return (
    <section
      className="dynamic-sequence-controls"
      data-frame-index={frameIndex}
      data-playback-state={isBuffering ? "buffering" : isPlaying ? "playing" : "paused"}
      aria-label="Dynamic sequence preview"
    >
      <button
        aria-label="Previous dynamic frame"
        disabled={disabled}
        onClick={onPrevious}
        type="button"
      >
        Previous
      </button>
      <button
        aria-label={isPlaying ? "Pause dynamic sequence" : "Play dynamic sequence"}
        disabled={disabled}
        onClick={onPlayPause}
        type="button"
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <button
        aria-label="Next dynamic frame"
        disabled={disabled}
        onClick={onNext}
        type="button"
      >
        Next
      </button>
      <output aria-live="polite">
        {status === "loading"
          ? `Preparing dynamic RAD ${preparedFrameCount}/${frameCount}`
          : status === "failed"
            ? "Dynamic RAD failed"
            : `${isBuffering ? "Buffering dynamic RAD" : "Dynamic RAD ready"} · Source ${sourceFrameIndex} · ${frameIndex + 1}/${frameCount}`}
      </output>
    </section>
  );
}
