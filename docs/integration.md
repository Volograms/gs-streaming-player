# Integrating the player

The public-preview entry point is `GaussianStreamingPlayer` from
`@6g-path/gaussian-player`. Packages are source-only and are consumed with pnpm
workspace links. Preserve the existing `@6g-path/*` identifiers until an npm release is
designed.

## Create and own one player

Create a renderer adapter, pass it to the facade, subscribe to state, and dispose the
facade when the canvas or page is removed. The facade takes ownership of the adapter.

```ts
const renderer = new PlayCanvasGaussianRendererAdapter({
  canvas,
  graphicsBackend: "webgpu",
  gaussianSort: "auto",
  manageResize: true,
});

const player = await GaussianStreamingPlayer.create({
  manifest: manifestUrl,
  renderer,
  sequenceId: "performance", // required only when the manifest has >1 sequence
  loop: true,
  signal: abortController.signal,
});
```

Only one dynamic sequence can be active. A manifest may list several alternatives, but
the caller must choose one with `sequenceId`; simultaneous sequences are unsupported.

## Playback API

- `play()` and `pause()` control the timeline. `play()` can reject when browser audio
  autoplay policy requires a gesture.
- `seek(seconds)` seeks in media time; `stepFrames(delta)` pauses and advances frames.
- `setQualityMode({ mode: "automatic" })` restores adaptation;
  `setQualityMode({ mode: "manual", detailLevel: 0.5 })` requests the smallest dynamic
  frame tier meeting 50% detail.
- `setMuted(boolean)` and `setVolume(0..1)` control the manifest audio track.
- `subscribe(listener)` immediately emits a snapshot and returns an unsubscribe
  function.
- `dispose()` cancels work and releases frame, static, mesh, audio, and renderer
  resources.

Automatic quality starts at the manifest's minimum playable tier (or its lowest
available tier). Content without an authored tier ladder retains the 25% progressive
detail default. Buffer defaults are a five-second decoded lookahead, one previous frame,
a 200 MB compressed cache, a separate 500 MB estimated decoded CPU/GPU budget, six
concurrent fetches, two initial preparations, and two ready startup frames. The
downloaded cache keeps filling its byte budget. The decoded window grows toward the time
target as preparation completes, and shortens when its memory budget requires it. It no
longer stops at ten future frames. Explicit `buffer.futureFrameCount` overrides the
time-based frame limit. Configure the budgets with `buffer.compressedBufferMaximumBytes`
and `buffer.decodedBufferMaximumBytes`, the target with `buffer.targetBufferSeconds`,
and startup with `buffer.minimumReadyFrames`. Inject a custom policy with
`qualityController`. Automatic policy can adjust preparation concurrency while playing.

Both showcases accept `VITE_COMPRESSED_BUFFER_MB` (decimal MB, default `200`) and
`VITE_DECODED_BUFFER_MB` (default `500`) and `VITE_TARGET_BUFFER_SECONDS` (default `5`)
in their app's `.env.local`. For example:

```dotenv
VITE_COMPRESSED_BUFFER_MB=400
VITE_DECODED_BUFFER_MB=750
VITE_TARGET_BUFFER_SECONDS=5
```

Restart the Vite dev server after changing these settings. The compressed budget is
additional to decoded frames, renderer resources, static content, and in-flight
transfers. For a tier averaging `B` bytes per frame at `F` fps, five seconds needs
approximately `5 * F * B` bytes, plus the current payload. Auto selects the highest tier
that fits both the transfer budget and this reserve; manual quality may leave a shorter
reserve.

Compressed file size is not decoded memory size. PlayCanvas reports texture allocation
and center storage, conservatively allowing a CPU upload copy as well as GPU textures.
The ring learns the expansion factor for subsequent frames; other adapters can report
`PreparedFrame.estimatedMemoryBytes`, with conservative metadata-based estimates used
until measurements exist. Static content, temporary decode work, in-flight preparation
and a visible frame awaiting replacement are additional allocations. At least the
current/startup frames remain usable even when individual frames exceed the budget.

Compressed prefetch planning stops at the byte budget instead of scanning the remaining
sequence on every window update. Cached assets use their observed byte sizes. When sizes
are missing or zero, speculative lookahead admits at most one fetch batch of
unknown-size assets at a time. Successful batches reveal a conservative size estimate
and extend the plan automatically, including while paused, until the budget is filled or
the clip ends. Frames needed for presentation can still be fetched on demand. Prefetch
stops at a native progressive-frame boundary, where the renderer manages its own reads.

Set the minimum dynamic tier in the dataset recipe's `dynamic.minimumPlayable`, using an
existing tier name: for example, `"minimumPlayable": "basic"` when `dynamic.tiers`
contains `basic`. The generated manifest marks that tier with `minimumPlayable: true`;
in compact manifests the marker may live in `dynamicSequences[].qualityDefaults`. To
change an existing manifest without regenerating assets, move the marker from Preview to
Basic for each frame, or in the corresponding shared quality defaults, removing any
per-frame override that still marks Preview. The player never selects below that marker.
See [content preparation](content-preparation.md) for the recipe and
`generate-tiers --minimum-playable` option.

If an independently addressable tier returns HTTP 404 or 410, the player excludes that
tier for the current player session and falls back to an available tier without crossing
the authored minimum. Auto then chooses the highest remaining sustainable tier. Reload
the player after restoring missing assets. If no playable tier remains, loading fails;
other HTTP and decoding failures are still reported as errors.

The showcase exposes the same modes in the compact quality menu beside the timeline.
`Auto` is the normal buffer-aware policy; the named percentage entries pin a dynamic
transfer tier and remain selected when entering XR. Static Streamed SOG keeps its own
camera-dependent spatial hierarchy in every mode—the dynamic tier menu does not freeze
or replace static-scene LoD.

Player snapshots expose `bufferedTimeRanges` as sorted `{ startSeconds, endSeconds }`
intervals on the sequence timeline. These combine completed compressed downloads in the
active quality plan with presentation-ready frames. The showcase draws them in grey
behind the played progress, including separate ranges at loop boundaries and gaps where
downloads are still pending. Ranges update when the cache or prepared frame window
changes; they do not represent the browser's HTTP cache or guarantee that downloaded
frames have finished decoding and GPU preparation.

Snapshots also expose `decodedTimeRanges` and `decodedFrameCount`. These include only
resident frames ready for presentation, excluding downloaded-only data, unfinished base
preparation, and refinement below the selected detail. They use the same authored timing
and gap preservation as the downloaded ranges and update from emitted buffer snapshots.
The showcases draw decoded-ready ranges in a thin green lane and show a visible
`Ready N frames` count. Grey means downloaded, green means decoded and prepared for
playback, and pink means played. A long grey reserve can coexist with an empty green
reserve; downloaded capacity alone does not establish decoder or renderer capacity.
Desktop controls also show both reserves in seconds. Hover over either count for
compressed and estimated decoded memory usage and limits, available in manual and Auto
modes. `bufferDiagnostics` exposes the same values in player snapshots.

In Auto, the quality menu reports the requested authored dynamic tier rather than the
renderer-wide splat count, which may include static content. Its tooltip shows the
latest automatic-policy download/decoded reserve and throughput evidence, plus renderer
FPS, frame handoff time, lifecycle, and dropped frames. Optional `qualityDiagnostics` in
player snapshots supplies the latest policy inputs; these refresh with automatic quality
observations, not on every UI read. Existing prepared frames can briefly remain at an
older tier during an automatic switch.

Optional `presentationTiming` separates playback-clock deadline lateness, wall-clock
timer lateness, the full presentation pipeline, and synchronous snapshot listeners. It
reports the most recently completed playback advance and lifetime peak pipeline and
deadline lateness. Unlike renderer handoff time, the pipeline includes preparation,
buffer updates, listeners, and any readiness wait before scheduling the next frame.
These measurements use a separate monotonic clock and do not drive playback timing. The
Auto tooltip includes them when available. A healthy green reserve can still coexist
with dropped frames if presentation or scheduling misses the source cadence.

See [automatic quality](automatic-quality.md) for tier selection, throughput
measurement, switching behavior, and policy configuration.

## Backend selection

Prefer WebGPU only after checking both `navigator.gpu` and the immersive WebXR binding
on XR-targeted applications. If initialization fails, construct a fresh WebGL2 adapter
once and report the actual backend to users. The showcase is the reference
implementation.

Do not put renderer dependencies into player-core. Custom integrations implement the
renderer adapter contract and register codecs explicitly when native compressed input is
unavailable.
