# ADR 0011: Separate Gaussian codecs from renderer adapters

- Status: Accepted
- Date: 2026-07-20

## Context

The first flat dynamic path passed SPZ files directly to Spark. Spark therefore owned
fetch-adjacent decoding, reconstruction of Gaussian attributes, and packing into
`PackedSplats`. This was useful for proving the flat-tier approach, but made it
difficult to measure decoding independently, replace the format, or integrate the
reusable player into an application using another renderer.

The player needs to compare official SPZ v4, later SOG v2, and potentially a temporal
container without rewriting its byte buffering or playback scheduler. It likewise needs
to compare Spark, PlayCanvas, and other renderers without making a file format part of
the renderer contract.

## Decision

Split the dynamic pipeline into three independently replaceable stages:

1. `player-core` fetches and retains opaque compressed bytes under a byte budget;
2. a codec selected by an explicit manifest codec ID decodes those bytes in a persistent
   worker pool into renderer-neutral position, scale, rotation, opacity, colour, and SH
   arrays;
3. a concrete renderer adapter converts those arrays to its native representation and
   owns presentation resources.

`@6g-path/gaussian-codec` defines the neutral decoded-frame and registry contracts.
`@6g-path/gaussian-codec-spz` initially implements Niantic SPZ v4 through its official
WASM streaming decoder. The Spark adapter is the first consumer and packs decoded data
into `PackedSplats`.

The existing Spark-owned SPZ v3 route remains available under the explicit
`spark-spz-v3` demo selection. SPZ v4 uses `spz-v4`; files and metadata must match that
selection. The two paths do not silently fall back into each other.

## Consequences

Streaming policy, compressed caching, playback timing, and diagnostics no longer depend
on a particular encoded representation or renderer. Decode time and renderer packing
time can be measured separately, and new codec/renderer combinations do not require
changes to the playback engine.

The neutral arrays create a renderer-independent intermediate allocation. A renderer
adapter may need a second packing pass, so this architecture optimises replaceability
and measurement before it optimises copies. If measurements later justify a native
zero-copy payload, it can be added as another explicit codec/adapter capability rather
than redefining the general player contract.

SPZ v4 is pinned to an upstream revision and its generated WASM is vendored so browser
builds do not depend on an external CDN. The upstream license and reproduction details
remain with the codec package.
