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

Defaults are 25% minimum dynamic detail, one previous and ten future frames, a 200 MB
compressed cache, six concurrent fetches, two preparations, and two ready startup
frames. Override them through the facade's `buffer`, `quality`, and `startup` options.

The showcase exposes the same modes in the compact quality menu beside the timeline.
`Auto` is the normal buffer-aware policy; the named percentage entries pin a dynamic
transfer tier and remain selected when entering XR. Static Streamed SOG keeps its own
camera-dependent spatial hierarchy in every mode—the dynamic tier menu does not freeze
or replace static-scene LoD.

## Backend selection

Prefer WebGPU only after checking both `navigator.gpu` and the immersive WebXR binding
on XR-targeted applications. If initialization fails, construct a fresh WebGL2 adapter
once and report the actual backend to users. The showcase is the reference
implementation.

Do not put renderer dependencies into player-core. Custom integrations implement the
renderer adapter contract and register codecs explicitly when native compressed input is
unavailable.
