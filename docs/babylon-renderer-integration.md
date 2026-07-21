# Babylon.js Renderer Integration

`@6g-path/gaussian-renderer-babylon` is an independent `GaussianRendererAdapter`. It
does not replace the Spark adapter and does not add Babylon.js to `player-core` or the
Spark application.

## Current capability

The first comparison path supports renderer-neutral decoded Gaussian frames, currently
produced by the official SPZ v4 codec. The adapter:

- converts neutral positions, scales, RGBA, XYZW rotations, and SH0-SH3 data into
  Babylon's final covariance/texture layout in a persistent worker pool, avoiding the
  otherwise repeated main-thread `.splat` expansion in the normal dynamic path;
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

The fast path uses Babylon's existing texture upload and depth-sort machinery, but
precomputes the covariance textures before presentation. It depends on Babylon's current
internal texture hooks, so `VITE_BABYLON_NATIVE_TEXTURE_PACKING=false` restores the
documented `.splat` plus `GaussianSplattingMesh.updateDataAsync()` route for an A/B
comparison or compatibility fallback. It remains an experiment until desktop and Quest
measurements show that the removed main-thread work materially improves handoff rate.

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

`VITE_BABYLON_NATIVE_TEXTURE_PACKING` defaults to enabled. Leave it enabled for the new
worker-packed path; set it to `false` only to compare the previous Babylon-native
`.splat` ingestion route. This toggle changes no source tier, splat count, or quality
target.

The comparison demos start at 25% and their adaptive policy never requests less. A 10%
preview cut remains available in the manual selector for explicit diagnostic
comparisons.

## Comparison rules

Use the same `quality-cuts.json`, frame range, transfer tier, compressed-cache state,
decode concurrency, and hardware for Spark/Babylon results. Report Babylon's neutral
codec decode, adapter pack, total frame preparation, persistent-mesh update, renderer
FPS, and buffer state separately. Do not compare a warm fully resident run with a cold
network-limited run.
