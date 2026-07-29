# ADR 0012: Support multiple renderer adapters and dedicated demos

- Status: Accepted
- Date: 2026-07-20

## Context

The Spark adapter proved the renderer-neutral player and SPZ v4 codec boundary, and it
remains useful for persistent paged RAD scenes. Measurements also show that converting
every decoded dynamic frame into Spark's packed texture representation is a significant
renderer-specific cost. The project must distinguish a format limitation from an adapter
limitation without rewriting byte buffering, playback, or quality policy.

Embedding several rendering engines into one application would couple their canvas,
scene, lifecycle, dependency, XR, and diagnostic assumptions. It would also make
performance comparisons harder to reproduce.

## Decision

Treat Spark, Babylon.js, PlayCanvas, and later renderers as co-equal implementations of
`GaussianRendererAdapter`. Spark remains a supported package and is not a migration
scaffold.

Each rendering engine receives a dedicated demo application. Demos may share
renderer-neutral sequence loading, playback controls, diagnostics, and styling, but they
own their engine-specific canvas, scene controls, renderer settings, and XR entry point.
A demo must not initialise an unused rendering engine.

The first additional path is official SPZ v4 decoded through the existing neutral codec
and presented by a Babylon.js adapter. A later PlayCanvas demo will test SPZ where
practical and native SOG v2. Renderer/codec combinations are explicit capabilities; a
demo must report an unsupported combination instead of silently changing format or
renderer.

Where the engine supports it, its demo exposes an optional immersive-VR/WebXR entry
point. Desktop playback remains available when XR is unsupported or no headset is
connected.

## Consequences

Renderer packages may have different native packing, sorting, static-scene, mesh, and XR
capabilities while sharing the same clock, compressed cache, codec registry, scheduler,
and quality decisions. Performance results identify the selected adapter and codec.

Dedicated demos add build targets and browser smoke coverage. Shared integration code
must be extracted rather than copied as each demo is added. Cross-engine composition in
one canvas is not required; applications select one renderer backend for a player
instance.
