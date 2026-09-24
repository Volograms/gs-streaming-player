# Audio synchronization

A sequence manifest can declare one audio track and an `offsetSeconds` position on the
sequence timeline. Media time zero starts at that offset. Audio is authoritative while
its timeline region is active; before or after it, the normal player clock continues.

Use `GaussianStreamingPlayer` for synchronized audio, as the showcase does. The
`demo-playcanvas` diagnostics app creates its own lower-level playback controller and
does not consume the manifest audio track automatically.

For fixed-rate content, author frame timestamps as `frameIndex / fps` and the sequence
duration as `frameCount / fps`, using the source video's rate (typically 25 or 30 fps).
The audio clock keeps presentation on this timeline across loops without resetting the
scheduler's elapsed time. Audio offsets need not coincide with frame boundaries;
negative offsets start partway into the track.

The player pauses audio when Gaussian frames buffer and resumes only after the startup
reserve is restored. If audio stalls, presentation waits for media time to advance.
Seeking and frame stepping pause playback; call `play()` to resume. Pause, seek, step,
and disposal also cancel a pending Play request. Priming the browser media element is
temporarily muted, preserving the user's requested mute and volume settings.

A missing track is valid. A track shorter than the sequence does not end Gaussian
playback early; a longer track restarts at the sequence loop boundary. Frames stay in
the configured rolling buffer, and audio uses the browser media element rather than
decoding the complete track into an in-memory audio buffer.

Call `player.play()` from a user gesture. Handle its rejected promise and subscribe to
snapshots: audio failures, including a rejected resume after buffering, set
`snapshot.lifecycle` to `ERROR`, populate `snapshot.error`, and stop playback. A pending
Play request reports `BUFFERING` with `isPlaying: true` so the UI can offer Pause. An
explicit Play retries after an error; the player does not retry indefinitely. Host audio
with the same HTTPS/CORS discipline as the splat assets.

Automated coverage includes 25/30 fps loops with native Chromium audio and simulated
seeks near the end of a two-minute sequence. Audible synchronization, browser policy,
and sustained playback with the production assets still need validation on Quest.
