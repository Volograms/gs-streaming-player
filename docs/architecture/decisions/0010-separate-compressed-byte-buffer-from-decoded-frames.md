# ADR 0010: Separate compressed byte buffering from decoded frame ownership

- Status: Accepted
- Date: 2026-07-17

## Context

The five-frame renderer ring bounds decoded CPU state and Spark resources, but it only
represents about 167 ms at 30 fps. Full SPZ tiers can take longer than that to fetch and
decode even on a fast local network. Scheduling a URL-backed Spark preparation as one
operation also lets network waits occupy decoder slots, so the renderer window can run
dry despite available memory and bandwidth.

Conventional volumetric/video players keep a larger compressed reservoir independently
of the much smaller set of decoded frames. Playback consumes from that reservoir while
network fetching continues according to a byte budget.

## Decision

Add a renderer-neutral, byte-budgeted compressed frame cache in `player-core`:

1. the rolling playback position produces an ordered forward plan of selected flat SPZ
   tier URLs;
2. an independent fetch queue fills the cache up to a byte budget, deduplicates shared
   demand, and evicts old/furthest bytes as the plan advances;
3. caller cancellation stops waiting for bytes without cancelling a fetch still useful
   to the shared prefetch plan;
4. only after a frame's complete bytes are resident is its decode submitted to the
   separately bounded renderer-preparation scheduler;
5. the Spark adapter receives `fileBytes`, so its worker pool decodes the cached SPZ
   without issuing another URL request.

The demo defaults to a 200 MB compressed cache, six network requests, four concurrent
decode preparations, and a five-frame decoded ring. Each value remains configurable.
Paged RAD is not routed through this whole-file cache because its value comes from range
requests; the initial cache path is for independently addressable flat tiers.

## Consequences

Network latency no longer consumes Spark decode concurrency, and the byte buffer can
hold seconds of minimum/medium frames while decoded/GPU ownership remains small. A 200
MB budget holds fewer seconds at full quality, so adaptive policy uses compressed bytes
and contiguous ready frames rather than treating the decoded ring as the network buffer.

Complete compressed payloads and decoded `PackedSplats` coexist briefly, increasing CPU
memory use by the configured budget plus the decoded ring. Fetch and decode are still
whole-frame operations; partial SPZ decoding and temporal compression remain future
format work.

Diagnostics report compressed fetch duration/throughput separately from Spark's combined
worker decode/result-transfer duration, the CPU-to-shared-display copy, and the observed
Spark display mapping commit cadence. A future Spark worker hook may split worker decode
from result transfer more finely.
