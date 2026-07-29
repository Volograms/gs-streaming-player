# Playback performance report

This is the living measurement record for dynamic Gaussian playback. It preserves
important results, test conditions, interpretations, and limitations independently of
chat history. Update it when a renderer, decoder, scheduler, content encoding, browser,
or device change materially affects the pipeline.

Last updated: 2026-07-21.

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

### 11. CPU flat sort: medium and full streaming — 2026-07-20

These runs exercised the optional CPU sort-key provider during normal 30 fps playback,
using official SPZ v4 frames, four Spark packing workers, a 200 MB compressed cache, and
no preload-all mode:

```text
VITE_DYNAMIC_PRELOAD_ALL_FRAMES=false
VITE_DYNAMIC_FRAME_CODEC=spz-v4
VITE_DYNAMIC_PACK_CONCURRENCY=4
VITE_DYNAMIC_SORT_SOURCE=cpu-flat
```

The frame range was 1–100. The camera and remaining worker/browser/machine details were
not explicitly captured. The medium cache contained the entire tier when its summary was
recorded; the full cache contained 65 of 100 frames and was at its 200 MB limit.

| Metric                        | Medium, ~139k | Full, ~274k |
| ----------------------------- | ------------: | ----------: |
| Base samples                  |            84 |          82 |
| Queue p50/p95                 |        0/0 ms |  420/546 ms |
| Compressed fetch p50/p95      |       waiting |  211/256 ms |
| Renderer minimum-ready p50/95 |      54/63 ms |  195/233 ms |
| Neutral SPZ v4 decode p50/95  |      33/41 ms |  126/163 ms |
| Spark pack total p50/p95      |      54/63 ms |  195/233 ms |
| Pack worker p50/p95           |      52/60 ms |  193/230 ms |
| Pack result transfer p50/p95  |        1/4 ms |     2/12 ms |
| Presentation cadence p50/p95  |      34/44 ms |   36/222 ms |
| Player presentation rate      |      29.0 fps |    12.5 fps |
| Actual Spark display commits  |      28.9 fps |    12.3 fps |
| Dropped frames                |             0 |           0 |
| Spark sort p50/p95            |        6/9 ms |    21/34 ms |
| CPU sort keys p50/p95         |        2/3 ms |      7/9 ms |
| Sort worker p50/p95           |        2/3 ms |     9/20 ms |
| Sort order upload p50/p95     |        0/1 ms |      0/0 ms |
| GPU readback                  |      bypassed |    bypassed |

The CPU sort experiment succeeds. Compared with the immediately preceding full-tier
manual GPU-readback result, full sorting fell from 104/122 ms to 21/34 ms, approximately
a 5.0x p50 and 3.6x p95 improvement. Actual Spark commits now track player handoffs to
within 0.2 fps at both tiers, so the renderer is no longer silently coalescing most
presentations. Medium playback is consequently visually near the 30 fps target.

Full-tier playback remains preparation-bound. Its 126 ms median neutral decode followed
by 195 ms median packing is about 321 ms of per-frame CPU work across two pipeline
stages. Four packing workers have an optimistic isolated capacity of about 20.5 frames/s
at the median and 17.2 frames/s at p95, before worker contention and other browser work.
The 420/546 ms outer queue confirms that this stage is saturated. Internal pack queue
time remains zero because admitted jobs obtain a packing worker immediately; the wait
occurs before that pool and the running worker jobs themselves slow under concurrent
load.

The full run also cannot sustain its payload rate from delivery alone. Approximately
3.05 MB at 30 fps requires about 732 Mbps, while the measured aggregate compressed
throughput was 124.8 Mbps. The 200 MB cache masks this temporarily but holds only about
65 full frames. This does not explain the medium result because all medium bytes were
resident and its decode/pack pipeline maintained 29 fps.

Individual full trace events recorded packing around 134–152 ms for frames 15–17 while
their total base readiness was about 676–679 ms. Individual medium events recorded
approximately 56 ms packing and 36 ms decode. The distribution summaries are preferred
for capacity conclusions because they include the contention across the whole run.

#### Fully compressed-byte-resident full-tier follow-up

The compressed cache was increased to 400 MB and allowed to fill before playback. At
capture time it held 391/400 MB, reported 200 cached resources and no active fetches.
This removes compressed delivery from the measured playback interval without retaining
all 100 decoded renderer frames.

| Metric                       |      p50 |    p95 |
| ---------------------------- | -------: | -----: |
| Base samples                 |       88 |      — |
| Outer preparation queue      |   241 ms | 336 ms |
| Renderer minimum-ready       |   129 ms | 158 ms |
| Neutral SPZ v4 decode        |    84 ms | 103 ms |
| Spark pack total             |   129 ms | 157 ms |
| Pack worker                  |   126 ms | 154 ms |
| Pack result transfer         |     2 ms |   5 ms |
| Presentation cadence         |    34 ms | 137 ms |
| Player presentation rate     | 19.1 fps |      — |
| Actual Spark display commits | 18.7 fps |      — |
| Spark sort                   |    12 ms |  20 ms |
| CPU sort keys                |     4 ms |   7 ms |
| Sort worker                  |     6 ms |   8 ms |
| Dropped frames               |        0 |      — |

Removing delivery raised full-tier presentation from 12.5 to 19.1 fps and reduced
decode, pack, and outer-queue latency, confirming that delivery and CPU preparation had
previously contended with each other. It did not make preparation fast enough for 30
fps. With four concurrent base preparations, the median sequential decode-plus-pack cost
predicts `4 / (0.084 + 0.129) = 18.8` prepared frames/s, almost exactly the observed
19.1 fps. The four-slot preparation scheduler is therefore saturated by useful work
rather than by an unmeasured delay.

Individual events agree with this attribution: full packing took approximately 114–131
ms for frames 63–65, result transfer was 1.4–1.9 ms, and internal pack queue time was
zero. The player again stalled instead of discarding deadlines, so zero reported drops
does not imply uninterrupted 30 fps; cadence p95 reached 137 ms.

### 12. Initial Babylon SPZ v4 inspection — 2026-07-21

The first Babylon comparison run used the same neutral SPZ v4 sequence and player-core
buffer. The following values are individual paused/manual observations copied from the
demo rather than percentile distributions. Delivery was constrained, so the medium and
full total preparation values are not codec/adapter throughput measurements.

| Tier / rendered splats | SPZ decode | Babylon pack | Total prepare | Mesh update | Render loop |
| ---------------------- | ---------: | -----------: | ------------: | ----------: | ----------: |
| Minimum, about 69.5k   |    25.4 ms |       5.8 ms |       31.4 ms |     23.0 ms |    59.5 fps |
| Medium, about 137.2k   |    29.5 ms |      12.6 ms |    1,687.2 ms |     48.9 ms |    59.2 fps |
| Full, about 275.6k     |    62.1 ms |      31.3 ms |    3,319.2 ms |     95.8 ms |    59.9 fps |

The Babylon renderer loop remained near 60 fps while paused, but manual frame changes
visibly flickered even at the smallest tier. This isolated the artifact from network and
codec cost. Inspection showed that the adapter was overwriting its sole visible
`GaussianSplattingMesh`: Babylon defers replacement texture application until a depth
sort completes, so the active mesh could be unavailable or internally transitional. The
follow-up adapter uses two persistent mesh slots, waits for the staging slot's depth
sort fence, and swaps visibility in `onBeforeRender`. Its continuity and doubled bounded
GPU capacity still require browser and target-device measurement.

### 13. Babylon main-thread upload attribution — 2026-07-21

A short desktop DevTools capture of the Babylon demo recorded 42 draw frames over about
868 ms. Its two SPZ decoder workers handled frames in roughly 15–22 ms and its packing
workers in roughly 8–9 ms. In contrast, 16 long main-thread timer continuations were
attributed directly to `GaussianSplattingMesh.updateDataAsync()` during
`commitPreparedFrame()`: 29.0 ms p50, 36.6 ms p95, and 38.2 ms maximum. The capture also
reported 17 dropped-frame events, so this conversion path is already marginal at 30 fps
on desktop before target-device scaling.

Quest Browser measurements with a full compressed cache and 11 decoded frames ahead
showed the same boundary much more clearly at the 25% tier: 42.5 ms SPZ decode, 44.8 ms
Babylon packing, and 122.6 ms native mesh update. The byte cache was not the limiting
stage. The native-texture packing experiment moves the covariance conversion out of this
main-thread upload path; it must now be compared against the documented `.splat` path at
unchanged 25%, 50%, and 100% tiers.

### 14. Babylon native-texture single-sort experiment — 2026-07-21

The first post-native-packing desktop samples used an RTX 3070 and the same dynamic
sequence at unchanged transfer quality. These are individual displayed samples rather
than a percentile distribution, so they establish the experiment baseline but should not
be treated as a stable benchmark by themselves.

| Transfer tier | Rendered splats | Render fps (paused) | SPZ decode | Babylon pack | Frame prepare | Mesh update |
| ------------- | --------------: | ------------------: | ---------: | -----------: | ------------: | ----------: |
| minimum (25%) |          69,703 |            60.2 fps |    14.6 ms |      21.7 ms |       36.5 ms |     10.1 ms |
| medium (50%)  |         139,138 |            59.5 fps |    27.9 ms |      36.7 ms |      384.4 ms |     23.4 ms |
| full (100%)   |         278,270 |            59.9 fps |    52.6 ms |      69.8 ms |      686.2 ms |     63.0 ms |

The near-60 paused render rate at every tier shows that full-tier steady rendering is
not GPU-raster limited on this machine. The serial presentation boundary is the
immediate full-tier limit: a 63.0 ms mesh commit permits at most about 15.9 commits/s.
With two packing workers, 69.8 ms of packing supplies at most about 28.7 frames/s, so
packing is expected to become the next limit if presentation reaches the 30 fps budget.

`Frame prepare` measures from the player's base-frame request through `base-ready`; it
includes scheduler waiting, compressed-cache access, decode, packing, and transfer. Its
384–686 ms samples therefore demonstrate accumulated queue pressure and are not direct
single-stage CPU timings.

Source inspection found two full depth sorts on reused native-texture mesh slots.
Babylon's `_updateTextures()` already posts the replacement-frame sort, while the
adapter also marked the sort dirty and forced a post. When the first result arrived,
Babylon therefore posted a redundant second sort before allowing the staging-mesh
handoff to settle. The adapter now explicitly posts one sort only for a mesh's first
texture upload; reused slots rely on `_updateTextures()`'s existing post. Splat count,
SH data, and transfer quality are unchanged.

A same-machine rerun after the single-sort change produced the following displayed
samples:

| Transfer tier | Rendered splats | Render fps (paused) | SPZ decode | Babylon pack | Frame prepare | Mesh update | Mesh-update change |
| ------------- | --------------: | ------------------: | ---------: | -----------: | ------------: | ----------: | -----------------: |
| minimum (25%) |          69,875 |            60.6 fps |    13.4 ms |      21.9 ms |       35.7 ms |     17.9 ms |   +7.8 ms (+77.2%) |
| medium (50%)  |         136,034 |            60.2 fps |    31.4 ms |      33.2 ms |      320.6 ms |     22.1 ms |    -1.3 ms (-5.6%) |
| full (100%)   |         274,071 |            88.5 fps |    77.4 ms |      79.6 ms |      825.3 ms |     28.7 ms |  -34.3 ms (-54.4%) |

The targeted full-tier mesh update improved from 63.0 to 28.7 ms: a 54.4% latency
reduction and 2.20x commit-throughput increase. The corresponding serial ceiling rose
from about 15.9 to 34.8 commits/s, moving this sample just inside a 30 fps budget.
Medium improved by 5.6%. The minimum-tier sample regressed from 10.1 to 17.9 ms; because
these are isolated displayed values and the removed work scales with splat count, this
small-tier result must be treated as run-to-run noise or fixed handoff overhead until a
multi-frame percentile capture confirms it.

Decode, packing, and end-to-end preparation varied materially between the two runs—most
notably full-tier decode increased from 52.6 to 77.4 ms—so those changes are not
attributed to the sorting patch. The next experiment may now target SPZ decode while
keeping this single-sort renderer path and all quality settings fixed.

### 15. SPZ v4 decode baseline and hotspot attribution — 2026-07-21

The post-single-sort full-tier sample establishes a 77.4 ms SPZ decode baseline at
274,071 rendered splats. This displayed value includes decoder scheduling, the
compressed input copy, worker execution, and delivery of the transferred neutral
attribute buffers.

Sampling the previously supplied desktop CPU trace and excluding idle samples attributed
about 68.9% of active SPZ-worker time to the official WASM decode plus its JS/WASM call
bridge, and about 18.9% to the repository's `copyAttribute` conversion/copy function.
The remaining samples were spread across worker dispatch, allocation/runtime support,
garbage collection, and profiling noise. A synthetic 274k-splat JavaScript run also made
the typed-array bounds fallback removal effectively neutral, so that edit is not a
useful performance experiment.

The first SPZ change should therefore target the WASM decode boundary or remove a whole
neutral-attribute materialization pass. Queue tuning, input-buffer allocation reuse, and
minor loop rewrites are explicitly deferred because the trace does not identify them as
material contributors. Any renderer-specific fusion must remain a separate experiment
from the renderer-neutral decoder so its architectural and timing effects are visible.

### 16. Babylon fused SPZ-to-native implementation — 2026-07-21

Babylon can now advertise direct handling of `spz-v4` compressed frames. Its existing
packing worker invokes the shared SPZ streaming decoder and writes each scratch chunk
directly into Babylon's final center, covariance, RGBA, and SH texture arrays. The
renderer-neutral decoder and neutral-to-Babylon packer remain available by setting
`useFusedSpzPacking: false`, so this experiment does not change other renderers.

For SH degree 3, the old neutral frame allocates 236 bytes per splat: positions, scales,
rotations, alpha, RGB, and 45 SH float values. The fused writer does not allocate that
frame. It retains only 12 temporary bytes per splat for positive scales until the
sequential rotation stream arrives, then emits the existing native texture payload. The
compressed cache is not detached; a compact compressed-input clone is still required
when ownership transfers to the worker.

New trace phases split SPZ input allocation, input copy, exclusive WASM decode, native
output allocation, attribute writing/packing, and worker-result transfer. In fused mode,
the `SPZ decode` card sums only input and WASM time; `Babylon pack` sums native
allocation and attribute writes, avoiding double-counting the combined worker
invocation.

A same-machine desktop rerun produced the following displayed samples. As in the
single-sort experiment, these are individual paused observations rather than percentile
distributions. The neutral comparison is the post-single-sort run in section 14.

| Transfer tier | Rendered splats | Render fps (paused) | SPZ decode | Babylon pack | Decode + pack | Frame prepare | Mesh update |
| ------------- | --------------: | ------------------: | ---------: | -----------: | ------------: | ------------: | ----------: |
| minimum (25%) |          68,518 |            59.9 fps |     7.2 ms |      21.9 ms |       29.1 ms |       29.8 ms |      6.4 ms |
| medium (50%)  |         139,333 |            59.5 fps |    16.5 ms |      45.2 ms |       61.7 ms |       63.7 ms |     14.3 ms |
| full (100%)   |         279,486 |            60.2 fps |    38.6 ms |      86.1 ms |      124.7 ms |      663.9 ms |     38.3 ms |

The fused path reduced the displayed SPZ decode stage by 46.3%, 47.5%, and 50.1% at
minimum, medium, and full respectively. That is not the complete speedup because native
attribute writing is now charged to `Babylon pack`; pack was unchanged at minimum, 36.1%
slower at medium, and 8.2% slower at full. The cross-path `decode + pack` total is the
fairer comparison:

| Transfer tier | Neutral decode + pack | Fused decode + pack |            Change | Throughput gain |
| ------------- | --------------------: | ------------------: | ----------------: | --------------: |
| minimum (25%) |               35.3 ms |             29.1 ms |  -6.2 ms (-17.6%) |           1.21x |
| medium (50%)  |               64.6 ms |             61.7 ms |   -2.9 ms (-4.5%) |           1.05x |
| full (100%)   |              157.0 ms |            124.7 ms | -32.3 ms (-20.6%) |           1.26x |

This validates removal of the renderer-neutral materialisation pass, with the clearest
absolute gain at full quality. It does not yet make full-quality 30 fps preparation
possible: 124.7 ms of serial worker time is about 8 frames/s per worker, before queueing
and presentation. `Frame prepare` again includes scheduler and queue delay, so its large
full-tier value is not attributed directly to fusion. Mesh-update variation is also not
attributed to the codec change because fusion does not alter the native payload or the
single-sort presentation algorithm. A multi-frame trace is still required to quantify
allocation, transfer, and garbage-collection changes rather than inferring them from
these cards.

#### Full-tier sampled CPU trace

`Trace-20260721T170152.json` captured about 6.7 seconds of full-tier preparation with
the two fused packing workers. Detailed profiling adds overhead, so its absolute task
latencies are not directly interchangeable with the unprofiled timing cards above. It
does establish worker saturation and the relative CPU distribution.

The two workers completed 69 long decode-and-pack tasks in a 6.714-second active window,
or 10.28 tasks/s in aggregate. Their task latency was 182.8 ms p50, 230.9 ms p95, and
281.8 ms maximum. The tasks occupied 12.978 of the available 13.428 worker-seconds,
confirming that preparation throughput, rather than the main thread or renderer loop,
limited this capture.

| Sampled fused-worker work                        | Share of two-worker profile time |
| ------------------------------------------------ | -------------------------------: |
| Babylon covariance construction                  |                            23.5% |
| Identified SPZ WASM decode functions             |                            21.6% |
| Float32-to-half conversion and table access      |                            13.0% |
| Scale exponentiation                             |                             9.6% |
| Rotation-loop overhead around covariance packing |                             6.0% |
| Alpha, colour, and position writers              |                            16.1% |
| Garbage collection                               |                             3.2% |
| Idle                                             |                             3.9% |

Covariance construction, its rotation loop, and half-float conversion therefore account
for about 42.5% of sampled worker CPU. Including scale exponentiation raises the native
scale/rotation-to-covariance path to about 52.1%, well above the identifiable WASM
decode share. The next isolated CPU experiment should target this native packing path
while preserving the same covariance calculation, splat count, and visual quality. A
deeper SPZ WASM change should follow that measurement rather than being selected from
the UI's stage name alone.

The workers performed 2,482 minor and 34 major collections, reclaiming about 2.49 GB in
total (about 36 MB of young-generation allocation per completed task). Collection pauses
used about 410 ms across both workers, so GC is visible allocation churn but only about
3% of sampled worker CPU. Reusing callback and scratch state remains worthwhile for
memory bandwidth and Quest thermals, but GC elimination alone cannot close the full-tier
throughput gap.

The renderer main thread had only three tasks longer than 16.7 ms; its one 102 ms task
was CPU-profiler startup. The sampled Babylon upload calls and GPU-process tasks did not
form the sustained bottleneck, consistent with the near-60 fps paused render loop.

### 17. Native half-float covariance encoding — 2026-07-22

Babylon 9.17's `ToHalfFloat` implementation performs six JavaScript table-based
conversions per splat and truncates discarded mantissa bits. Modern runtimes expose
`Float16Array`, which converts in native code using IEEE nearest-even rounding. Trying
to adjust the native result back to Babylon's truncation was about 1.9x slower than the
existing converter in a local conversion-only benchmark, so it is not a useful fast
path.

The implemented Babylon-specific path feature-detects `Float16Array` and creates a
native float view over the final covariance `Uint16Array` buffers. It therefore adds no
payload allocation or copy. Runtimes without `Float16Array` retain Babylon's exact
truncating converter. Nearest-even can change the least-significant half-float bit—about
half of random normalised test inputs differed from truncation—but remains within one
encoded ULP and is the more accurate representation of the same covariance value.

A synthetic Node 24 benchmark packed a 274,140-splat SH0 frame ten times through each
path after warm-up. Native conversion reduced median complete native packing from 48.9
ms to 37.6 ms, a 23.1% latency reduction and 1.30x throughput increase. Its p95 was 54.5
ms versus 80.0 ms for the fallback.

`Trace-20260722T110451.json` then captured the native path with the same full-tier fused
worker pipeline used by the previous trace. These are separate profiled sessions rather
than an interleaved benchmark, but the old `ToHalfFloat` conversion and table-access
samples disappear from both workers, confirming that `Float16Array` was active.

| Full-tier worker measurement | Babylon truncation trace | Native Float16 trace |         Change |
| ---------------------------- | -----------------------: | -------------------: | -------------: |
| Long decode-and-pack tasks   |                       69 |                   71 |              — |
| Active capture window        |                  6.714 s |              6.037 s |              — |
| Aggregate worker throughput  |            10.28 tasks/s |        11.76 tasks/s | +14.4% (1.14x) |
| Task latency p50             |                 182.8 ms |             163.3 ms |         -10.7% |
| Task latency p95             |                 230.9 ms |             193.1 ms |         -16.4% |
| Task latency maximum         |                 281.8 ms |             205.5 ms |         -27.1% |
| Two-worker occupancy         |                    96.6% |                97.1% |    +0.5 points |

The native trace spent about 26.0% of sampled worker time in the remaining covariance
calculation and 27.7% across sampled SPZ WASM functions. Removing the old 13.0%
half-conversion/table category therefore translated into a 14.4% aggregate throughput
gain rather than merely moving that cost elsewhere. Full-tier preparation is still
worker-bound and, at about 2.55x below 30 freshly prepared frames/s, now makes SPZ WASM
decode the next appropriate isolated experiment.

Allocation churn did not improve: the workers reclaimed about 2.65 GB across 1,946 minor
and 37 major collections, approximately 37 MB per completed task. GC pause time fell
from about 410 ms to 351 ms and represented about 2.9% of sampled worker time, but the
reclaimed-byte evidence does not support claiming an allocation reduction from this
change. The renderer main thread had no application task over 16.7 ms; its only long
task was 145 ms of CPU-profiler startup. GPU-main tasks remained 1.27 ms p95 with three
isolated tasks above 16.7 ms, so neither formed the sustained throughput limit.

This desktop trace validates the native half-float experiment. Quest 3 still needs the
same full-tier measurement and a visual check for the nearest-even covariance encoding.

## PlayCanvas native SOG baseline

The PlayCanvas adapter and offline SOG conversion path were implemented on 2026-07-22 to
test whether a native WebP-backed representation removes the CPU expansion and repacking
seen in the Babylon/SPZ trace. Device performance is not yet measured, so no speedup is
attributed to this change.

The first production PlayCanvas run must report SOG asset preparation, presentation
handoff, PlayCanvas sorting, renderer FPS, achieved presentation cadence, compressed
cache state, and memory at minimum, medium, and full quality. Inspect a Quest trace for
center generation/readback, CPU sort, browser WebP decode, and texture upload before
changing PlayCanvas's renderer or shaders. This is a pipeline comparison rather than an
isolated codec benchmark because SPZ and SOG are different compressed representations.

### WebGPU GPU-sort experiment

An opt-in PlayCanvas WebGPU path was added on 2026-07-23. It creates the graphics device
asynchronously, requires the browser to return an actual WebGPU device, selects
PlayCanvas's raster GPU-sort renderer, and disables SOG center preparation before any
asset load. This targets the traced `generateCenters`, GPU readback, center-array clone,
worker transfer, and CPU sort path without changing the selected frame tier or SOG
payload.

Compare production builds with `VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgl2` and `webgpu`,
and reject the WebGPU sample unless diagnostics report `webgpu` and
`gpu (no CPU centers)`. For each 25%, 50%, and 100% tier, record SOG preparation
p50/p95, sort p50/p95, renderer FPS, actual presentation cadence, long tasks, GPU work,
peak memory, and visual correctness with the same frame range, cache state, camera
motion, viewport, and browser version. Record non-immersive and immersive-WebXR results
separately.

#### First desktop WebGPU full-tier result - 2026-07-23

The first laptop production run confirms that the intended PlayCanvas WebGPU path is
active at full quality. The diagnostics reported `Graphics webgpu`,
`Sort path gpu (no CPU centers)`, `Sort 0.0 ms`, and `Presented tier 1`; playback felt
smooth at about 59 fps with the full 100% tier selected.

| State   | Rendered splats | Render FPS | SOG fetch | SOG prepare | Frame commit |   Sort |
| ------- | --------------: | ---------: | --------: | ----------: | -----------: | -----: |
| paused  |         278,592 |   59.0 fps |   83.4 ms |     22.7 ms |       1.5 ms | 0.0 ms |
| playing |         278,847 |   59.0 fps |  157.4 ms |     50.3 ms |      10.4 ms | 0.0 ms |

This is not yet a controlled p50/p95 benchmark, but it is the first hardware evidence
that moving PlayCanvas SOG sorting to WebGPU and disabling CPU center preparation
removes the full-resolution stall observed on the earlier PlayCanvas path. The next
useful measurement is the same full-tier WebGPU run on Quest 3, followed by a
same-session desktop WebGL2/WebGPU comparison if we still need exact attribution.

#### First Quest 3 WebGPU result - 2026-07-23

Quest 3 also initialised the PlayCanvas WebGPU path. Minimum quality was reported as
fine, medium quality was slower but acceptable, and full quality was too slow. A medium
quality screenshot showed `Graphics webgpu`, `Sort path gpu (no CPU centers)`,
`Sort 0.0 ms`, and `Presented tier 0.5`, so the GPU-sort path is active on the headset.

| Tier         | State   | Rendered splats | Render FPS | Prepared ahead |   Byte cache | SOG fetch | SOG prepare | Frame commit |   Sort |
| ------------ | ------- | --------------: | ---------: | -------------: | -----------: | --------: | ----------: | -----------: | -----: |
| medium (50%) | playing |         137,581 |   52.0 fps |              2 | 198 / 200 MB |  208.5 ms |    407.3 ms |       3.1 ms | 0.0 ms |

This moves the Quest bottleneck away from application-side sorting and frame commit. The
remaining headset limit is SOG fetch/asset preparation and resource upload. WebXR worked
in the PlayCanvas WebGL2 configuration but not in the WebGPU configuration, which
matches PlayCanvas's requirement for a browser-exposed `XRGPUBinding` when WebGPU hosts
an immersive session. Treat WebGPU non-immersive performance and WebGL2 immersive-XR
validation as separate modes until Quest exposes that binding reliably.

## Current conclusions

1. Player scheduling, handoff, and the reusable display allocation can sustain 30 fps
   for both minimum and full tiers when all decoded frames are resident.
2. Paged RAD tree work is unsuitable for the current per-frame dynamic use case; it
   remains valuable for large persistent static scenes.
3. Flat SPZ removes dynamic tree traversal but full-tier SPZ decoding remains too slow
   for 30 freshly decoded frames/s on the measured development setup.
4. Spark sorting is a separate cost. The `cpu-flat` provider removes GPU readback for an
   eligible flat dynamic mapping and reduced measured full-tier sorting from 104/122 ms
   to 21/34 ms. Actual Spark display commits then closely tracked player handoffs.
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
9. The first `cpu-flat` runs reached 29.0 player handoffs and 28.9 actual display
   commits per second at medium quality. This is the first evidence that the streaming
   path can produce visually distinct near-30-fps medium-tier playback.
10. Full-tier `cpu-flat` playback is no longer sort-bound. With all compressed bytes
    resident, four concurrent sequential decode-and-pack preparations produced 19.1 fps,
    matching their measured 18.8 fps capacity estimate. Compressed delivery lowers this
    further when it overlaps the preparation workload.
11. Babylon's native-texture single-sort change reduced the sampled full-tier mesh
    update from 63.0 to 28.7 ms (54.4%, 2.20x commit throughput) without changing the
    100% splat payload. Full-tier SPZ decode and Babylon packing are now the measured
    desktop limits.
12. Babylon's fused SPZ-to-native worker path removed the renderer-neutral
    materialisation and reduced the sampled combined decode-plus-pack time by 17.6% at
    minimum, 4.5% at medium, and 20.6% at full quality. This optimisation is
    Babylon-specific above the shared streaming decoder; other renderers need their own
    native output writer to obtain the same copy/allocation reduction.
13. The full-tier fused CPU trace places about 52% of worker time in Babylon's scale,
    covariance, and half-float packing path versus about 22% in identifiable SPZ WASM
    decode functions. Both packing workers were saturated, while the main thread and
    renderer loop retained headroom.
14. Feature-detected native half-float writes increased sampled full-tier browser worker
    throughput from 10.28 to 11.76 tasks/s (14.4%). Worker p50 fell by 10.7% and p95 by
    16.4%; Quest measurement and visual validation remain outstanding.
15. The first PlayCanvas WebGPU SOG run reached smooth full-tier desktop playback at
    about 59 fps with the demo reporting `webgpu`, `gpu (no CPU centers)`,
    `Sort 0.0 ms`, and `Presented tier 1`. This is a preliminary hardware result, not a
    controlled p50/p95 benchmark.
16. Quest 3 can run the PlayCanvas WebGPU SOG path with GPU sort active. Medium quality
    was acceptable at about 52 fps, but SOG preparation was still about 407 ms in the
    screenshot and full quality remained too slow. WebGL2 remains the working PlayCanvas
    XR path on that device.

## Public-preview findings

These conclusions summarize the recorded experiments; they are not renderer-wide claims
or guaranteed frame rates.

| Path                | Recorded conclusion                                                                              | Conditions / limitation                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Spark 2.x paged RAD | Runtime tree merging and decode were CPU-bound and too slow for dynamic Quest delivery.          | Tested implementation; a future end-to-end WebGPU path could change the result.                               |
| Quality-LoD RAD     | The tree is useful for producing flat LoD cuts shared by downstream formats.                     | Authoring intermediate, not the recommended runtime payload.                                                  |
| SPZ v3              | Decode cost was unusable for the target playback workload.                                       | Experimental Spark compatibility path.                                                                        |
| SPZ v4              | Materially better than v3, but CPU decode still competes with XR and application work on mobile. | Babylon comparison path; content and worker configuration matter.                                             |
| SOG v2              | GPU decoding and GPU sorting make it the recommended web delivery path.                          | WebGPU/WebXR remains experimental on Quest; WebGL2 is the fallback.                                           |
| Quest 3 stereo      | The recorded roughly 500k-splat PlayCanvas case approached 20 ms for stereo rendering.           | Specific Quest 3, browser, engine build, scene, view, tier, and measurement session; no frame-rate guarantee. |

Adding a persistent static scene increases render pressure. Streaming SOG plus a global
splat budget is the current mitigation. Fixed foveation and resolution reduction may
help but have not been measured rigorously and remain disabled by default.

The WebGPU-to-WebGL XR mirror was abandoned. A Quest 3 mono handoff sample at 1178 × 620
reported 9.4 ms copy/draw, 1.4 ms source render, and 24.5 mirror fps at the 25% dynamic
tier (~68k splats), while the static SOG failed to load. It did not validate stereo or
head tracking and added substantial complexity, so it is not an active runtime path.

## Next measurements

- Capture fused and neutral multi-frame traces at all three tiers to compare p50/p95,
  allocation, worker-result transfer, and garbage collection; use combined decode-plus-
  pack time for the cross-path throughput comparison.
- Repeat native versus fallback Babylon covariance packing on Quest 3 and visually
  validate the nearest-even result; the desktop full-tier trace measured a 14.4%
  aggregate preparation-throughput gain.
- Profile and optimise one SPZ WASM decode operation without changing the native
  covariance path, tier, splat count, or output quality; record worker p50/p95 and
  aggregate prepared frames/s against the native-half baseline.
- Run the packed-memory experiment on minimum, medium, and full SH3 tiers in the same
  production browser and hardware session.
- Compare legacy Spark SPZ v3 with official neutral SPZ v4 using identical frames,
  tiers, cache state, worker counts, and hardware; report codec decode and Spark adapter
  pack independently.
- Compare Spark packing worker counts 2, 4, and 6 using the new queue, worker,
  result-transfer, and main-thread-bind timers; report aggregate throughput and CPU
  utilisation rather than selecting the lowest isolated latency.
- Repeat minimum, medium, and full playback in the same production session with a
  stationary and moving camera, identical SH/render settings, warm cache, and cleared
  diagnostics. Verify CPU-sort visual correctness as well as timing.
- Compare `cpu-flat` and `gpu-readback` with the same stationary and moving camera,
  minimum/medium/full frames, warm cache, and cleared diagnostics. Record CPU-key or GPU
  readback time, worker sort, total sort, actual display commits, visual artifacts, and
  the 13-byte-per-splat buffered-memory increase.
- For a delivery-independent full-tier run, raise the compressed-byte cache above the
  approximately 305 MB tier size, wait for all 100 byte payloads to become resident,
  clear diagnostics, and then play without using decoded-frame preload-all mode.
- Measure the full-tier decode/pack concurrency matrix (at least 2/2, 4/2, and 4/4 codec
  and pack workers). Report aggregate prepared frames/s, per-stage latency, outer queue,
  and CPU utilisation; more workers may increase contention rather than throughput.
- Measure aggregate localhost delivery correctly across overlapping requests and compare
  fetch concurrency 4, 6, and 8.
- Expose and test Spark decode worker counts 4 and 6, recording CPU utilisation and
  per-frame latency rather than assuming more workers improve throughput.
- Repeat resident and streaming tests on the target desktop, tablet, and mobile device
  matrix with browser/GPU/CPU/SSD details.
- Record memory consumption for compressed bytes, decoded buffered frames, reusable GPU
  capacity, and temporary decode buffers at each tier.
- Verify Babylon front/back handoff continuity at preview, minimum, medium, and full
  tiers, then record both mesh-slot GPU capacity and handoff latency on desktop and
  Quest.
- Run the PlayCanvas/SOG production demo at minimum, medium, and full quality on desktop
  and Quest 3 using both the WebGL2 CPU-sort and WebGPU GPU-sort configurations. The
  first desktop WebGPU full-tier screenshot confirms the path and smooth playback, and
  the first Quest WebGPU screenshot confirms GPU sort at medium quality. Still record
  repeated p50/p95 samples, memory, and traces. Verify both Quest 3 eyes in the WebGL2
  XR path unless WebGPU XR reports an available `XRGPUBinding`.
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
Renderer adapter / codec:
Tier / splats / SH / bytes per frame:
Target FPS:
Compressed cache and residency at start:
Decoded previous/future frames:
Fetch / decode / refinement concurrency:
Static scene enabled: yes/no

Fetch or cache result:
Decode queue p50/p95:
SPZ decode p50/p95:
SOG asset preparation p50/p95:
Packed snapshot / clone / bind:
Flat copy p50/p95:
Sort total / readback / worker / upload p50/p95:
Presentation cadence and rate:
Dropped frames or stalls:
Peak memory:
Trace or result artifact:
Notes and limitations:
```
