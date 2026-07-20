# Playback performance report

This is the living measurement record for dynamic Gaussian playback. It preserves
important results, test conditions, interpretations, and limitations independently of
chat history. Update it when a renderer, decoder, scheduler, content encoding, browser,
or device change materially affects the pipeline.

Last updated: 2026-07-20.

## Measurement rules

- Record the content representation and quality tier, splat count, SH degree, frame
  range, decoded window, compressed-byte budget, fetch/decode concurrency, browser,
  machine, and whether bytes were already resident.
- Use a production build for performance captures. Development React instrumentation, an
  open DevTools profiler, and rendered console/trace output can change the result.
- Treat localhost transfer as **compressed-byte delivery**, not network bandwidth. It
  includes the preview server, browser HTTP stack, OS page cache or SSD, memory copies,
  and CPU contention, but no WAN link.
- Distinguish player handoff cadence from Spark display-mapping commits and the
  browser's render cadence.
- Record sample counts with p50/p95 when they are available. Mark summaries recovered
  from screenshots when their per-metric sample counts were not retained. Ranges copied
  from individual trace events are observations rather than distributions.
- Keep measurements from unoptimised `rafa-pitch` content as pipeline baselines, not
  production content targets.

## Pipeline terminology

| Stage                   | Meaning                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compressed fetch        | Whole flat-SPZ payload delivery into the byte-budgeted cache. A cache hit has no fetch wait.                                                      |
| Decode queue            | Wait after compressed bytes are resident and before a Spark worker is available.                                                                  |
| Legacy Spark SPZ decode | Spark worker RPC that inflates SPZ v3, reconstructs and packs every splat into `PackedSplats`, and returns typed arrays.                          |
| Neutral codec decode    | Official SPZ v4 WASM decompression and reconstruction into renderer-neutral Gaussian attribute arrays in the codec worker pool.                   |
| Spark adapter pack      | Renderer-worker conversion from neutral attributes into Spark arrays, plus result transfer and lightweight main-thread `PackedSplats` binding.    |
| RAD root preparation    | Paged RAD metadata, root chunk fetch/decode, GPU-page allocation/upload, tree registration/update/traversal, and minimum-renderable confirmation. |
| Refinement              | Work required to reach the configured presentation-quality target after base readiness.                                                           |
| Flat frame copy         | CPU attribute copy from a buffered frame into the one reusable GPU-facing `PackedSplats` allocation.                                              |
| Spark sort              | GPU depth readback, worker index sort, and ordering-texture upload/submission. It is separate from SPZ decode.                                    |
| Presentation gate       | Final achieved-quality check immediately before handoff.                                                                                          |
| Handoff                 | Visibility/display-resource switch after the gate passes.                                                                                         |

## Test content and expected rate

The current dynamic fixture is the unoptimised `rafa-pitch` sequence at 30 fps. Early
tests used frames 40–50; later SPZ tests used a generated 100-frame tier set. Typical
flat tiers observed in these tests were:

| Tier         | Approximate splats/frame | Compressed bytes/frame |
| ------------ | -----------------------: | ---------------------: |
| Minimum, 25% |            69,000–70,000 |                0.86 MB |
| Medium, 50%  |            About 139,000 |                1.64 MB |
| Full, 100%   |            About 279,000 |           3.18–3.21 MB |

At 30 fps, the full tier represents approximately 96 MB/s or 768 Mbps of compressed
payload before HTTP and container overhead. A 200 MB compressed cache holds roughly 62
full frames, or 2.1 seconds, but substantially more minimum and medium frames.

## Recorded results

### 1. Paged RAD baseline — 2026-07-15

Source: committed measurement
[`2026-07-15-local-chromium.json`](measurements/2026-07-15-local-chromium.json).

Configuration:

- frames 40–50, quality-LoD RAD, 30 fps target;
- local Chromium through Playwright on the development machine;
- two base preparations, one refinement;
- 25% presentation detail and at least 100 selected splats.

| Metric                        | Samples |        p50 |        p95 |
| ----------------------------- | ------: | ---------: | ---------: |
| Base preparation              |       9 | 1,857.5 ms | 3,366.2 ms |
| Minimum renderable/root ready |       9 | 1,449.8 ms | 3,365.3 ms |
| Refinement                    |       7 |   484.7 ms | 1,212.2 ms |
| Decode/preparation queue      |      10 |     0.3 ms | 1,463.4 ms |
| Presentation wait             |       6 |    22.9 ms |   896.2 ms |
| Visibility handoff            |       6 |     0.1 ms |     0.2 ms |

Observed handoffs selected approximately 8,300–8,600 splats. The handoff itself was
already negligible; preparation and presentation readiness were the limiting stages.

One later instrumented RAD frame exposed the internal shape of the delay:

| Phase                                | Observed stage duration |
| ------------------------------------ | ----------------------: |
| Tree registration                    |                  0.9 ms |
| Root chunk fetch                     |                 30.9 ms |
| Root chunk decode                    |                 41.1 ms |
| Preallocated page allocation         |                  0.0 ms |
| Tree update                          |                  0.8 ms |
| Tree traversal                       |                862.4 ms |
| GPU upload                           |                  0.1 ms |
| Total minimum-renderable preparation |              2,634.5 ms |
| 25% refinement                       |                892.9 ms |

This single-frame trace is not a percentile distribution, but it identified Spark tree
traversal and large gaps between internal operations as major RAD-path costs. Removing
the persistent static scene in a later manual test kept the decoded dynamic buffer at
four or more frames while stepping, showing that concurrent static Spark work also
affected the shared renderer path.

Decision resulting from this baseline: retain paged RAD for static scenes, but export
camera-independent flat quality tiers for dynamic playback.

### 2. Initial flat-SPZ playback

Replacing per-frame RAD traversal with flat SPZ removed dynamic LoD-tree work. An early
minimum-tier performance-panel screenshot reported the following; its per-metric sample
counts and detailed machine specification were not retained:

- root-ready p50/p95: 86/113 ms;
- observed switching rate: 21.4 fps;
- approximately 69,830 splats in the displayed frame.

This established that flat frames were substantially faster than paged RAD but still did
not sustain 30 fps while transfer, decode, allocation, presentation, and diagnostic work
overlapped.

Subsequent work separated the compressed-byte cache from decoded frame ownership,
increased Spark decoding to four frames concurrently, reused one grow-only GPU-facing
allocation, and removed high-frequency React/console diagnostics.

#### Diagnostic overhead correction

The earlier local Chrome capture `Trace-20260717T114030.json` was 243 MB and showed that
development trace formatting, React presentation, and console-style output materially
disturbed the main thread—approximately half of the inspected capture was associated
with diagnostic/UI work rather than playback. The demo subsequently moved event
retention outside React, bounded it to 2,000 entries, refreshed visible trace rows at no
more than 4 Hz, refreshed statistics at 1 Hz, throttled playback snapshots, and stopped
normal console emission. Results collected before and after that change are not directly
comparable unless diagnostic settings are recorded.

### 3. Fully resident playback isolates presentation — 2026-07-17

The full 100-frame sequence was preloaded to remove compressed transfer and SPZ decode
from the playback interval. These values were recovered from performance-panel
screenshots; their per-metric sample counts and detailed machine specification were not
retained.

#### Minimum tier

| Metric                       |   Result |
| ---------------------------- | -------: |
| Presentation cadence p50/p95 | 33/38 ms |
| Presentation rate            | 30.0 fps |
| Dropped frames               |        0 |
| Spark sort p50/p95           | 25/29 ms |
| Sort GPU readback p50/p95    | 22/26 ms |
| Sort worker p50/p95          |   1/2 ms |
| Sort ordering upload p50/p95 |   0/0 ms |
| Flat frame copy p50/p95      |   0/0 ms |

#### Full tier

| Metric                       |   Result |
| ---------------------------- | -------: |
| Presentation cadence p50/p95 | 33/36 ms |
| Presentation rate            | 29.9 fps |
| Dropped frames               |        0 |
| Spark sort p50/p95           | 49/54 ms |
| Sort GPU readback p50/p95    | 43/47 ms |
| Sort worker p50/p95          |   4/5 ms |
| Sort ordering upload p50/p95 |   0/0 ms |
| Flat frame copy p50/p95      |   0/1 ms |

These results prove that the absolute playback clock, handoff, reusable packed
allocation, and asynchronous Spark sort path can present both tested tiers at 30 fps
once frames are decoded and resident. Sorting remains expensive—mostly GPU readback—but
was not the source of the measured SPZ preparation delay.

### 4. Five-frame full-tier streaming does not sustain 30 fps

A full-tier performance-panel screenshot with only the rolling decoded window available
reported the following; its per-metric sample counts were not retained:

| Metric                       |     Result |
| ---------------------------- | ---------: |
| Queue p50/p95                |  97/147 ms |
| Root-ready p50/p95           | 195/215 ms |
| Presentation cadence p50/p95 |  44/257 ms |
| Presentation rate            |    9.2 fps |
| Spark sort p50/p95           |   29/32 ms |
| Sort GPU readback p50/p95    |   22/26 ms |
| Sort worker p50/p95          |     5/7 ms |
| Flat frame copy p50/p95      |     1/1 ms |

The buffer repeatedly drained because fetching and decoding were still coupled too
closely to the short decoded window. This motivated the independent 200 MB compressed
cache and a normal lookahead of ten future decoded frames.

The throughput value shown by the demo at that time was based on individual request
rates. Overlapping requests mean it must not be interpreted as aggregate delivery
throughput; aggregate measurement remains a diagnostics follow-up.

### 5. Localhost full-tier trace with ten-frame lookahead — 2026-07-17

Source: local Chrome trace `Trace-20260717T150901.json` (29 MB, intentionally not
committed). The analysed breadcrumb window covered 2.331 seconds in a production preview
at `127.0.0.1`.

Compressed-byte delivery observations:

- 20 full-SPZ requests started and 17 completed in the sampled interval;
- completed payload: 54.3 MB over 1.761 seconds, approximately 246.6 Mbps aggregate;
- at about 3.2 MB per frame, this is approximately 9.6 delivered frames/s;
- trace event accounting reached eight nominally unfinished requests when older requests
  with no `ResourceFinish` event were included;
- frames 71 and 72 remained partially delivered at 2.64 MB and 2.16 MB while later
  requests completed; frame 86 was still active at trace end.

Because this was localhost, 246.6 Mbps is not a WAN limit. It measures the combined
preview-server, HTTP, browser, page-cache/SSD, copying, and CPU-contention path. The
partial older requests may represent cancellation without a finish marker,
browser/server scheduling, or a real stalled fetch. They do not prove that the
configured six-request scheduler admitted eight active transfers, but they justify
explicit scheduler-level fetch instrumentation.

Worker observations:

- four Spark load workers repeatedly ran long `onMessage` tasks;
- 19 observed long decode RPCs occupied about 6.05 worker-seconds;
- typical individual tasks were approximately 280–340 ms, with a 487.5 ms maximum;
- four workers at about 318 ms/frame imply a rough ceiling near 12–13 decoded frames/s
  during this instrumented capture.

Chrome CPU profiling itself can increase these absolute worker durations, so the result
is stronger as stage attribution than as a release decoder benchmark. It nevertheless
shows that the long tasks belong to SPZ loading/decoding workers, not Spark's separate
sort worker.

Main-thread animation was comparatively light:

| Metric                       |    Result |
| ---------------------------- | --------: |
| `FireAnimationFrame` samples |       120 |
| Callback p50                 |  0.629 ms |
| Callback p95                 |  2.475 ms |
| Maximum                      | 82.497 ms |
| Callbacks over 16.7 ms       |         1 |

Conclusion: the ten-frame decoded window adds only 333 ms of headroom. It cannot sustain
30 fps when both local compressed-byte delivery and SPZ decode produce fewer than 30
frames/s. The main presentation loop is not the steady-state bottleneck.

### 6. Renderer-native packed-memory experiment — 2026-07-17

The experiment snapshots the currently decoded frame's base and SH typed arrays into one
temporary contiguous buffer, then measures full-buffer ownership cloning separately from
synchronous zero-copy `PackedSplats` construction. It does not define or persist a file
format. Clone work is capped at approximately 64 MB per run.

Validated minimum-tier result in production-preview headless Chromium:

| Property or metric     |          Result |
| ---------------------- | --------------: |
| Splat count            |          69,703 |
| SH degree              |               0 |
| Raw packed payload     | 1,146,880 bytes |
| Snapshot construction  |         0.70 ms |
| Payload clone p50/p95  |    0.60/0.70 ms |
| Zero-copy bind p50/p95 |    0.00/0.10 ms |
| Passes                 |               8 |
| Browser errors         |               0 |

This is an order-of-magnitude result rather than a target-device conclusion. It supports
the hypothesis that binding renderer-native memory is cheap and that the large flat
preparation time comes from SPZ inflation, attribute reconstruction/repacking, worker
coordination, and typed-array transfer/initialisation—not from constructing the
`PackedSplats` wrapper.

The equivalent full-tier SH3 hardware result is still required. It must record the raw
payload expansion as well as clone and bind time before any renderer-native runtime
format is accepted.

### 7. Official SPZ v4 neutral-path smoke test — 2026-07-20

An actual 27,882-splat, SH0 preview frame was round-tripped from the Spark-generated v3
file through the official Niantic native tools (`spz_to_ply`, then `ply_to_spz`). The
source was approximately 351 KB and the v4 output approximately 347 KB. These rounded
sizes are a format-path sanity check, not a compression comparison because the PLY
intermediate can quantise or normalise attributes.

The official v4 WASM decoder then loaded that output in a persistent browser worker,
returned renderer-neutral attribute arrays, and the Spark adapter packed and presented
the result in the Playwright Chromium demo smoke test. This validates integration and
lifecycle only: headless software WebGL took about 1.2 minutes and is not a useful
throughput measurement.

Diagnostics now report neutral codec decode and Spark adapter packing separately from
the legacy Spark-owned v3 decode path. A controlled hardware A/B measurement over the
same complete tier set remains pending.

### 8. Full-tier SPZ v4 over office network — 2026-07-20

This quick run used the 100 Mbps office path and full 100% frames of approximately
279,000 splats and 3.09–3.11 MB each. It is useful for stage attribution, not as a local
decode-throughput result, because compressed delivery dominated the run.

| Metric                         |        p50 |       p95 |
| ------------------------------ | ---------: | --------: |
| Compressed fetch               |   4,027 ms |  4,901 ms |
| Official neutral SPZ v4 decode |      67 ms |     98 ms |
| Synchronous Spark adapter pack |      79 ms |    115 ms |
| Presentation rate              |    1.7 fps |         — |
| Dropped frames                 |         94 |         — |
| Compressed cache at capture    | 197/200 MB | 64 frames |

Individual trace samples placed codec decode near 69–74 ms and Spark packing near
105–123 ms. That made renderer packing the largest local synchronous stage even though
the 3.9–5.2 second fetches controlled end-to-end cadence. Packing now runs in a
renderer-owned persistent worker pool and records queue, worker, result-transfer, and
main-thread-bind time separately. A post-change hardware run is still required; this
entry is the comparison baseline.

### 9. Post-worker minimum and medium SPZ v4 — 2026-07-20

These local-device runs used the persistent codec and Spark packing worker pools with no
active network limitation reported. The captured summaries showed no compressed fetch
samples, a full minimum-tier byte cache, and a nearly full mixed medium-tier cache.
Machine/browser details and explicit worker counts were not captured; if the environment
was unchanged, the demo defaults were four codec and four packing workers.

| Metric                        | Minimum, ~69.7k | Medium, ~139.7k |
| ----------------------------- | --------------: | --------------: |
| Base samples                  |              80 |              84 |
| Renderer minimum-ready p50/95 |        28/33 ms |        57/69 ms |
| Neutral SPZ v4 decode p50/95  |        23/30 ms |        37/48 ms |
| Spark pack total p50/p95      |        28/33 ms |        57/69 ms |
| Pack queue p50/p95            |          0/0 ms |          0/0 ms |
| Pack worker p50/p95           |        27/32 ms |        56/69 ms |
| Pack result transfer p50/p95  |          0/2 ms |          2/4 ms |
| Pack main bind p50/p95        |          0/0 ms |          0/0 ms |
| Presentation cadence p50/p95  |        34/40 ms |        34/41 ms |
| Player presentation rate      |        29.1 fps |        28.8 fps |
| Dropped frames                |               0 |               0 |
| Actual Spark display commits  |         8.2 fps |        22.5 fps |
| Spark sort p50/p95            |      124/137 ms |        14/65 ms |
| Sort GPU readback p50/p95     |      116/133 ms |        11/60 ms |
| Sort worker p50/p95           |          2/4 ms |          2/4 ms |

The renderer-worker boundary is behaving efficiently: queue wait is absent, returned
array transfer is small, and main-thread binding is below the displayed resolution.
Packing time approximately doubles with the splat count, indicating a predictable
per-splat CPU conversion rather than fixed worker or messaging overhead. With multiple
workers it can overlap across buffered frames.

Player handoff cadence is not yet proof of visual 30 fps. Both runs advanced near 29
frames/s with no player-level drops, while Spark committed sorted display mappings at a
lower rate. The minimum-tier sort/readback result is unexpectedly much worse than the
medium result and is not physically explained by splat count. It should be repeated in a
controlled stationary-camera production run before treating it as a stable renderer
cost. Until then, actual display commits—not player handoffs—remain the limiting visual
presentation metric.

### 10. Post-worker full SPZ v4, manual handoff — 2026-07-20

The trace was cleared and two frames were advanced manually on the local device. Full
frames contained approximately 274,000 splats and 3.03–3.04 MB. The displayed summary
contained four base samples. Because handoffs were manual and separated by roughly 1.6
seconds, presentation cadence/rate, display-commit rate, and dropped-frame values are
not playback-throughput measurements in this run.

| Metric                         |        p50 |    p95 |
| ------------------------------ | ---------: | -----: |
| Base preparation               |     168 ms | 185 ms |
| Renderer minimum-ready         |     110 ms | 121 ms |
| Neutral SPZ v4 decode          |      63 ms |  73 ms |
| Spark pack total               |     110 ms | 121 ms |
| Pack queue                     |       0 ms |   0 ms |
| Pack worker                    |     108 ms | 119 ms |
| Pack result transfer           |       2 ms |   2 ms |
| Pack main bind                 |       0 ms |   0 ms |
| Spark sort                     |     104 ms | 122 ms |
| Sort GPU readback              |      98 ms | 117 ms |
| Sort worker                    |       3 ms |   5 ms |
| Sort order upload              |       0 ms |   0 ms |
| Future compressed fetch        |     138 ms | 148 ms |
| Observed compressed throughput | 184.7 Mbps |      — |

Individual F12/F13 events agree with the summary: codec decode took 73.2/63.2 ms,
packing took 109.5/102.5 ms, worker conversion accounted for 107.8/100.8 ms, and result
transfer took 1.6/1.7 ms. Base readiness at 185.2/167.9 ms is therefore explained by
sequential codec decode and renderer preparation rather than an unmeasured gap.

The sort result isolates the next renderer problem. Approximately 95% of sort latency is
GPU-to-CPU depth readback; CPU index sorting and ordering upload are small. At 104–122
ms per completed ordering, invalidating the mapping at 30 handoffs/s necessarily causes
intermediate handoffs to be coalesced before Spark can commit their sorted display
mapping.

An A/B experiment now extends Spark with an optional sort-key provider. For one eligible
flat dynamic Gaussian mapping, the adapter retains renderer-owned centers and an active
mask, applies the current object transform and Spark camera metric on the CPU, and feeds
the resulting float32 keys to Spark's unchanged worker radix sort. It bypasses depth
readback but preserves the existing ordering upload and mapping-commit checks. Mixed
Gaussian mappings automatically fall back to the original GPU path. Hardware results for
this path are pending.

## Current conclusions

1. Player scheduling, handoff, and the reusable display allocation can sustain 30 fps
   for both minimum and full tiers when all decoded frames are resident.
2. Paged RAD tree work is unsuitable for the current per-frame dynamic use case; it
   remains valuable for large persistent static scenes.
3. Flat SPZ removes dynamic tree traversal but full-tier SPZ decoding remains too slow
   for 30 freshly decoded frames/s on the measured development setup.
4. Spark sorting is a separate cost. GPU readback dominates it, while the worker's index
   sort and ordering upload are relatively small. The asynchronous pipeline sustained 30
   fps in the fully resident tests.
5. A larger compressed buffer absorbs bursts but cannot compensate indefinitely when
   steady-state delivery or decode throughput is below playback consumption.
6. The codec/renderer split permits SPZ v4, SOG v2, and renderer-native experiments to
   share the same compressed buffer, scheduler, clock, and presentation machinery.
7. Renderer-native packed binding is currently the most promising lower-bound path, but
   its storage expansion, SH3 behaviour, portability, and target-device results must be
   measured before a format decision.
8. Moving Spark packing to renderer-owned workers removed meaningful queue, transfer,
   and main-thread-bind overhead in the first local runs. The remaining per-splat pack
   work scales predictably and can overlap across buffered frames.
9. Near-30-fps player handoff can still outrun Spark display-mapping commits. Controlled
   sort/readback measurements are required before claiming visually distinct 30 fps.
10. The full-tier manual test attributes about 95% of Spark sort latency to GPU depth
    readback. Optimising the existing CPU sort or ordering upload cannot materially
    solve the visual presentation limit.

## Next measurements

- Run the packed-memory experiment on minimum, medium, and full SH3 tiers in the same
  production browser and hardware session.
- Compare legacy Spark SPZ v3 with official neutral SPZ v4 using identical frames,
  tiers, cache state, worker counts, and hardware; report codec decode and Spark adapter
  pack independently.
- Compare Spark packing worker counts 2, 4, and 6 using the new queue, worker,
  result-transfer, and main-thread-bind timers; report aggregate throughput and CPU
  utilisation rather than selecting the lowest isolated latency.
- Repeat minimum and medium playback in the same production session with a stationary
  camera, identical SH/render settings, warm cache, and cleared diagnostics. Explain the
  observed minimum-tier 124 ms sort versus medium-tier 14 ms sort before changing
  ordering policy.
- Compare `cpu-flat` and `gpu-readback` with the same stationary and moving camera,
  minimum/medium/full frames, warm cache, and cleared diagnostics. Record CPU-key or GPU
  readback time, worker sort, total sort, actual display commits, visual artifacts, and
  the 13-byte-per-splat buffered-memory increase.
- Measure aggregate localhost delivery correctly across overlapping requests and compare
  fetch concurrency 4, 6, and 8.
- Expose and test Spark decode worker counts 4 and 6, recording CPU utilisation and
  per-frame latency rather than assuming more workers improve throughput.
- Repeat resident and streaming tests on the target desktop, tablet, and mobile device
  matrix with browser/GPU/CPU/SSD details.
- Record memory consumption for compressed bytes, decoded buffered frames, reusable GPU
  capacity, and temporary decode buffers at each tier.
- Use the resulting decode breakdown to compare SPZ with a temporary renderer-native
  payload and one lightweight-compressed packed payload before designing a container.

## Result template

Copy this section for a new run:

```text
Date/time:
Commit:
Machine / CPU / RAM / SSD:
GPU / driver:
OS / browser:
Production or development build:
DevTools profiler open: yes/no
Content and frame range:
Tier / splats / SH / bytes per frame:
Target FPS:
Compressed cache and residency at start:
Decoded previous/future frames:
Fetch / decode / refinement concurrency:
Static scene enabled: yes/no

Fetch or cache result:
Decode queue p50/p95:
SPZ decode p50/p95:
Packed snapshot / clone / bind:
Flat copy p50/p95:
Sort total / readback / worker / upload p50/p95:
Presentation cadence and rate:
Dropped frames or stalls:
Peak memory:
Trace or result artifact:
Notes and limitations:
```
