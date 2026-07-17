import type { FrameRingBufferTraceEvent } from "@6g-path/gaussian-player";

/** Fixed-capacity trace history that can receive hot-path events without React work. */
export class PlaybackTraceBuffer {
  private count = 0;
  private nextIndex = 0;
  private readonly slots: Array<Readonly<FrameRingBufferTraceEvent> | undefined>;
  private versionValue = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Playback trace capacity must be a positive integer.");
    }
    this.slots = new Array<Readonly<FrameRingBufferTraceEvent> | undefined>(capacity);
  }

  get version(): number {
    return this.versionValue;
  }

  append(event: Readonly<FrameRingBufferTraceEvent>): void {
    this.slots[this.nextIndex] = event;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.versionValue += 1;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.count = 0;
    this.nextIndex = 0;
    this.versionValue += 1;
  }

  snapshot(): readonly Readonly<FrameRingBufferTraceEvent>[] {
    const firstIndex = (this.nextIndex - this.count + this.capacity) % this.capacity;
    const events: Readonly<FrameRingBufferTraceEvent>[] = [];
    for (let offset = 0; offset < this.count; offset += 1) {
      const event = this.slots[(firstIndex + offset) % this.capacity];
      if (event !== undefined) {
        events.push(event);
      }
    }
    return events;
  }
}
