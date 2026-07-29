# ADR 0014: Use native PlayCanvas SOG ingestion for the first SOG path

- Status: Accepted
- Date: 2026-07-22

## Context

The Babylon/SPZ measurements show that expanding every frame into neutral floating-point
attributes and then rebuilding renderer-native covariance and texture data can dominate
frame preparation. PlayCanvas supports SOG v2 as a WebP-backed Gaussian representation
whose compressed attributes can remain in engine-native textures and whose scale and
rotation expansion is performed by its splat shaders.

SOG is not a drop-in replacement for SPZ in every renderer. Treating it as a universal
neutral decoded frame would either recreate the expansion and copies being measured or
leak PlayCanvas types into `player-core`.

## Decision

The first SOG v2 runtime path uses PlayCanvas's native SOG asset ingestion through a
dedicated `@6g-path/gaussian-renderer-playcanvas` adapter and demo.

`player-core` continues to own tier selection, compressed fetching and caching,
scheduling, playback timing, and prepared-frame lifetime. The PlayCanvas adapter
explicitly advertises `sog-v2`, receives the selected compressed bytes, creates the
engine-native asset, and swaps it through one persistent dynamic splat entity. It does
not first expand the frame through a renderer-neutral Gaussian codec.

Existing flat SPZ quality cuts are converted offline into separately addressable SOG
files with equivalent tier detail and splat-count metadata. Content declares `sog-v2`
explicitly. An unsupported renderer/codec pair fails clearly instead of transcoding or
selecting another representation at runtime.

## Consequences

This path measures a lower-copy, GPU-oriented representation without changing the
manifest, byte-cache, playback, or quality-policy boundaries. It remains a
PlayCanvas-specific ingestion optimisation: another renderer needs an explicit SOG
implementation or continues using its existing codec path.

PlayCanvas may still generate/read back centers and CPU-sort splats on WebGL devices.
Those costs, browser WebP decode, texture upload, frame handoff, memory residency, and
stereo correctness must be measured on desktop and Quest 3 before deciding whether to
replace PlayCanvas sorting or rendering shaders. SOG conversion is an offline content
preparation step and does not reduce the selected quality tier at runtime.
