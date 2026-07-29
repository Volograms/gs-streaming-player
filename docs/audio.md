# Audio synchronization

A sequence manifest can declare one audio track and an `offsetSeconds` position on the
sequence timeline. Media time zero starts at that offset. Audio is authoritative while
its timeline region is active; before or after it, the normal player clock continues.

The player pauses audio when Gaussian frames buffer and resumes only after the startup
reserve is restored. Seek, loop, end, mute, and volume changes are applied to both
timelines. A missing track is valid, and a track shorter than the sequence does not end
Gaussian playback early.

Browsers may reject unmuted autoplay. `player.play()` exposes that rejection so the UI
can ask for a user gesture. Do not hide it behind an infinite retry. Host audio with the
same HTTPS/CORS discipline as the splat assets.
