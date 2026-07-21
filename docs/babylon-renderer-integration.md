# Babylon.js Renderer Integration

`@6g-path/gaussian-renderer-babylon` is an independent `GaussianRendererAdapter`. It
does not replace the Spark adapter and does not add Babylon.js to `player-core` or the
Spark application.

## Current capability

The first comparison path supports renderer-neutral decoded Gaussian frames, currently
produced by the official SPZ v4 codec. The adapter:

- converts neutral positions, scales, RGBA, XYZW rotations, and SH0-SH3 data into
  Babylon's 32-byte `.splat` memory layout in a persistent worker pool;
- retains two front/back `GaussianSplattingMesh` slots instead of creating one Babylon
  mesh per buffered frame;
- serialises asynchronous mesh updates, keeps the current slot visible while the other
  is updated, waits for Babylon's first valid depth ordering, and swaps slots at a
  render boundary so rapid seeks cannot overlap uploads or expose an incomplete frame;
- keeps compressed buffering, codec decoding, scheduling, playback, and tier selection
  in renderer-independent packages;
- loads ordinary Babylon-supported splat and mesh assets, but explicitly rejects Spark
  `.RAD` static assets;
- optionally creates Babylon's standard immersive-VR WebXR experience and entry UI.

Babylon still derives covariances, updates Gaussian textures, and depth-sorts inside
`GaussianSplattingMesh.updateDataAsync()`. This comparison therefore measures a real
Babylon ingestion path; it is not a custom Babylon shader or a claim that the current
handoff is already optimal.

The front/back handoff intentionally keeps two dynamic GPU allocations resident. The
`dynamicGpuCapacity` renderer metric reports their combined capacity. Record this cost
when testing memory limits on Quest and mobile devices. A caller-owned scene must keep
rendering while `presentFrame()` is pending because the final slot switch is fenced to
`Scene.onBeforeRenderObservable`.

## Run the dedicated demo

The Babylon application reuses the assets exposed under `apps/demo/public`. Copy its
example environment, or provide equivalent values in the shell:

```bash
cp apps/demo-babylon/.env.example apps/demo-babylon/.env.local
pnpm dev:babylon
```

The default development URL is `http://127.0.0.1:4175`. For measurements, use the
production build on port 4176:

```bash
pnpm profile:babylon
```

The demo requires `VITE_DYNAMIC_FRAME_CODEC=spz-v4`; it fails clearly rather than
passing SPZ v3 or RAD bytes to the neutral decoder. Its tier selector, 200 MB compressed
cache, decoded lookahead, and playback controller are the same player-core path used by
the Spark comparison.

Set `VITE_ENABLE_XR=false` to skip WebXR initialisation. Otherwise Babylon adds its VR
entry control when the browser, headset, or simulator exposes `immersive-vr`. Failure to
create an XR session does not prevent desktop playback.

## Comparison rules

Use the same `quality-cuts.json`, frame range, transfer tier, compressed-cache state,
decode concurrency, and hardware for Spark/Babylon results. Report Babylon's neutral
codec decode, adapter pack, total frame preparation, persistent-mesh update, renderer
FPS, and buffer state separately. Do not compare a warm fully resident run with a cold
network-limited run.
