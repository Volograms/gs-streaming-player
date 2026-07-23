# Dynamic Gaussian-splat streaming pipeline and bottleneck assessment

One limitation first: the connected GitHub app returns `404` for `Volograms/gs-streaming-player`, including the `feature/renderer-neutral-spz-v4-codec` branch. I therefore cannot make code-line-level claims about the current implementation. The assessment below is grounded in the architecture you described, the branch purpose, the earlier project notes, and the current state of the relevant formats and renderers.

## Executive diagnosis

The central problem is probably **not simply that SPZ decoding is slow**.

The deeper architectural issue is that a dynamic splat sequence is still being processed as a sequence of independent static 3DGS models:

```text
download frame
    → decode complete splat model
    → reconstruct attributes
    → sort all splats
    → repack renderer buffers
    → upload all buffers
    → replace rendered model
    → repeat 25–30 times per second
```

For 100k splats, each individual stage may appear acceptable, but their combination introduces:

* repeated whole-frame memory traversal;
* several CPU-side representations of the same frame;
* allocations and garbage collection;
* worker-to-main-thread transfers;
* renderer-specific repacking;
* full sorting for every temporal frame;
* GPU resource updates or recreation;
* stereo fragment processing and overdraw.

The correct abstraction is therefore not a **model loader with animation around it**, but a **temporal media decoder with a persistent GS renderer**.

A second important distinction is:

* **GS content update rate:** 25 or 30 frames per second;
* **Quest XR render/head-tracking rate:** ideally 72 frames per second or more.

The XR loop should continue rendering the most recent available splat frame at 72 Hz while new splat content arrives at 25–30 Hz. Meta’s own Quest guidance uses a minimum 72 Hz target, corresponding to 13.9 ms per rendered XR frame. Rendering the complete XR application at 25–30 Hz would create a poor experience even when the source content itself was captured at 25–30 fps. ([Meta for Developers][1])

## Current logical pipeline

Based on the implementation direction, the pipeline is approximately:

```text
Sequence manifest / frame index
             │
             ▼
    Timeline and prefetch scheduler
             │
             ▼
      HTTP fetch / frame bytes
             │
             ▼
    Compressed-frame queue
             │
             ▼
 SPZ v3/v4 parser and decompressor
             │
             ▼
 Attribute reconstruction / dequantisation
 position, rotation, scale, colour, opacity, SH
             │
             ▼
 Renderer-neutral decoded frame
             │
             ▼
 Renderer-specific conversion
 Spark / Babylon / future PlayCanvas
             │
             ▼
 View-dependent depth calculation and sorting
             │
             ▼
 Texture / buffer preparation
             │
             ▼
 GPU upload and active-buffer swap
             │
             ▼
 Stereo projection, splat evaluation and blending
```

SPZ v4 improves one part of this. Its attributes are stored as independent Zstandard-compressed streams, allowing parallel or selective decompression. But after decompression, positions, packed rotations, scales, colours and other attributes still have to be reconstructed and transformed into the layout expected by the renderer. ([GitHub][2])

## Bottleneck map

| Stage                       | Probable bottleneck                                  | Underlying reason                                                                                                    |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Network fetching            | Variable frame arrival and request overhead          | Independent frame files and attribute streams can create bursty completion even when average bandwidth is sufficient |
| SPZ decompression           | Latency spikes rather than only average throughput   | Several compressed streams, WASM overhead, memory growth and worker communication                                    |
| Attribute unpacking         | Full traversal of 100k splats                        | Fixed-point positions, quaternion reconstruction, scale decoding, colour and SH conversion                           |
| Renderer-neutral conversion | Additional representation and memory copy            | The neutral frame may not match Spark or Babylon’s actual GPU layout                                                 |
| Sorting                     | Complete dynamic data invalidates prior ordering     | Camera movement and actor movement both change depth order                                                           |
| Buffer preparation          | Repacking and allocation                             | Interleaved-to-planar conversion, texture layout generation, padding and index creation                              |
| GPU upload                  | Main-thread and driver synchronization               | Full texture/buffer updates, especially if resources are recreated                                                   |
| Renderer lifecycle          | Hidden engine work                                   | Bounds rebuilding, scene-graph changes, observers, materials, worker state and garbage collection                    |
| Stereo rendering            | Approximately twice the projection/blending workload | Two eye views and potentially separate sorting or culling                                                            |
| Fragment rendering          | Screen-space splat area and overdraw                 | 100k small splats can be cheaper than 50k very large overlapping splats                                              |

### 1. SPZ decoding

SPZ v4 is better suited than v3 because the streams can be decoded independently and in parallel. But it remains primarily a compact **storage representation**, not necessarily a low-latency **playback representation**.

There are likely at least three memory stages:

```text
compressed SPZ bytes
    → decompressed packed SPZ attributes
    → renderer-neutral attributes
    → renderer-specific GPU upload layout
```

Even with fast Zstandard decompression, repeatedly touching several megabytes of memory and allocating typed arrays can dominate on Quest.

The most important measurement is therefore not:

> How quickly can SPZ be decompressed?

It is:

> How long from the first compressed byte being available until the frame is resident in a reusable GPU buffer?

### 2. Sorting

Sorting is probably one of the largest CPU bottlenecks.

For static scenes, the renderer can sort asynchronously and reuse the order over multiple visual frames. Dynamic frames make this harder because both the camera and the Gaussian positions change. In XR there are also two nearby eye viewpoints.

A naive pipeline may do some combination of:

* sort each new source frame;
* resort when the head moves;
* sort independently for both eyes;
* transfer the resulting index array back to the main thread;
* upload that index order every frame.

That can make sorting and index preparation more expensive than SPZ decompression.

Spark has already experimented with stochastic ordering specifically because removing sorting can materially improve performance, at a visual-quality cost. ([GitHub][3]) Sorting-free research is now also credible rather than purely speculative: StochasticSplats reports more than four-times faster rendering at a selected quality level, while weighted-sum rendering demonstrated a smaller but measurable gain on mobile hardware. ([CVF Open Access][4])

### 3. Buffer preparation and upload

Renderer-neutrality is architecturally useful, but it can accidentally add another complete transcode.

For example:

```text
SPZ packed bytes
  → neutral float arrays
  → Spark packed splat representation
```

and:

```text
SPZ packed bytes
  → neutral float arrays
  → Babylon texture representation
```

For playback, the neutral representation should ideally be a **view over reusable memory**, not a fully expanded object model.

The target should be:

```text
decoder writes directly into an inactive frame slot
    → renderer uploads or references that slot
    → active slot is swapped
```

No per-splat JavaScript objects, no array-of-structures intermediate, and preferably no repeated float32 expansion where the shader can decode compact values.

### 4. Rendering and overdraw

Once decode, sort and upload are moved off the critical path, the next ceiling will likely be GPU fragment cost.

Splat count alone is not a sufficient predictor. Important factors include:

* average projected splat radius;
* how much of the headset framebuffer the actor covers;
* opacity distribution;
* number of overlapping splats per pixel;
* per-eye render resolution;
* SH evaluation cost;
* antialiasing and post-processing;
* whether background splats are rendered together with the actor.

Fixed foveation can reduce XR fill cost by lowering peripheral resolution and is exposed through WebXR on supporting devices. ([developer.mozilla.org][5])

## Why the current format and renderer options do not fully solve it

### `.RAD`

The earlier project notes correctly describe `.RAD` as a strong format for progressively paging large static worlds, with hierarchical LOD and virtual splat memory. 

But the earlier proposal to treat each dynamic frame as an independent `.RAD` asset overestimated how well static spatial paging transfers to temporal playback. 

For dynamic actors, per-frame `.RAD` would repeatedly create or traverse separate LOD trees and page sets. It solves:

* large static-scene residency;
* spatial refinement;
* camera-dependent LOD.

It does not inherently solve:

* temporal correspondence;
* per-frame replacement;
* delta compression;
* persistent actor buffers;
* deadline-aware frame dropping.

`.RAD` can still be useful for the **static classroom or environment**, while the dynamic person uses a separate temporal format.

### SPZ v4

SPZ v4 is a meaningful improvement because it has:

* a plaintext header and table of contents;
* independent Zstandard streams;
* parallel decompression potential;
* the possibility of omitting streams such as SH on constrained clients. ([GitHub][2])

However, it still represents each frame independently and does not remove:

* attribute reconstruction;
* renderer repacking;
* sorting;
* upload;
* temporal redundancy.

It is a good ingestion or archival format, but may not be the final Quest playback format.

### Spark

Spark remains useful as:

* a reference renderer;
* a desktop renderer;
* a static background renderer;
* a source of sorting and stochastic-rendering experiments.

Its strengths are broad WebGL2 compatibility, multi-splat support, dynamic transformations and worker/WASM infrastructure. ([GitHub][6])

But replacing or rebuilding a `SplatMesh` for every temporal frame is unlikely to be optimal. The dynamic path needs persistent renderer-owned storage rather than repeated asset loading.

### Babylon.js

Babylon provides mature WebXR integration and is therefore attractive as the application shell. It is also actively adding GS and SOG functionality. ([GitHub][7])

The risk is that its public Gaussian-splat abstraction remains oriented around loading and owning a model. A renderer-neutral player may need to bypass part of `GaussianSplattingMesh` and feed persistent textures or buffers through a custom Babylon rendering feature.

In other words:

> Babylon may remain the XR engine without Babylon’s standard GS loading lifecycle remaining the GS player.

### PlayCanvas and SOG/WebP

PlayCanvas should now be treated as a serious benchmark candidate, not merely another equivalent engine.

Recent versions include:

* GPU-driven GS sorting and culling on WebGPU;
* interval compaction;
* half-precision GS shaders;
* tiled compute GS renderers;
* stereo GS XR examples;
* GS benchmark examples. ([GitHub][8])

Its SOG format stores attributes in WebP images and uses Morton ordering partly to avoid runtime reordering work. Streamed SOG also supports spatial chunks and LOD. ([GitHub][9])

Quest support changed after the original analysis. Meta Quest Browser 146.0 announced experimental WebGPU support on April 21, 2026, and PlayCanvas 2.20 added stereo XR support to its WebGPU GPU-sort renderer. The exact Browser/Horizon OS combination must still be runtime-verified because WebGPU device creation can fall back and PlayCanvas requires the WebGPU-WebXR binding for immersive sessions. This is now a testable path rather than a presumed incompatibility. ([Meta][11]) ([GitHub][12])

Its WebGL2 renderer and SOG loader are nevertheless worth benchmarking.

# Recommended target architecture

## Separate static and dynamic content

```text
Static environment
    → RAD, Streamed SOG, mesh, or static GS
    → loaded and retained normally

Dynamic person
    → temporal GS stream
    → persistent frame ring
    → 25/30 Hz content updates
```

Where possible, render the static environment first and the actor second rather than globally sorting both datasets. For a person standing in front of a classroom background, this approximation may be visually acceptable and avoids a much larger global sort.

A proxy depth mesh or coarse body mesh can provide more robust actor/background compositing if required.

## Decouple content and XR clocks

```text
XR render loop:      72 Hz
Head pose updates:   72 Hz
GS source clock:     25 or 30 Hz
GS sorting:          15–30 Hz or event-driven
Network/decode:      asynchronous and deadline-driven
```

A missed GS frame should produce:

```text
frame N rendered for one extra XR refresh
    → frame N+1 discarded if already obsolete
    → continue with frame N+2
```

It should not produce:

```text
decode all late frames
    → growing queue
    → increasing playback latency
```

Drop frames **before expensive decoding or sorting** whenever their presentation deadline has already passed.

## Persistent frame ring

Use three or four fixed slots:

```text
EMPTY
  → FETCHING
  → DECODING
  → READY_CPU
  → READY_GPU
  → ACTIVE
  → EMPTY
```

Each slot should contain reusable:

* compressed input storage;
* decoded attribute storage;
* sort keys;
* sorted indices;
* renderer upload staging memory;
* GPU texture or buffer allocation.

The active GPU resource should never be destroyed simply because the next temporal frame arrives.

## Direct decoder output

The decoder API should support renderer-provided destination views:

```ts
decodeFrame(compressedFrame, destinationLayout, options)
```

instead of:

```ts
const neutralFrame = decodeFrame(compressedFrame);
const rendererFrame = convertForRenderer(neutralFrame);
```

The neutral interface should describe the layout, ownership and synchronization, not force a particular expanded representation.

# Near-term improvements to the existing SPZ v4 path

## 1. Instrument every stage

Record for each frame:

```text
fetch start / completion
header parsed
stream decompression start / end
attribute unpack start / end
sort start / end
buffer preparation start / end
upload start / end
first XR render
frame dropped
```

Also record:

* compressed bytes;
* decompressed bytes;
* bytes copied;
* number of allocations;
* queue depth;
* worker utilization;
* splat count;
* average and maximum projected radius;
* main-thread long tasks;
* GPU frame time where available.

Without this, “SPZ decode is slow” may actually include buffer conversion or renderer initialization.

## 2. Selectively decode SPZ v4 streams

Because v4 separates attributes, define a Quest profile such as:

```text
required:
  position
  scale
  rotation
  colour
  opacity

optional:
  SH degree 1+
  auxiliary attributes
  high-precision enhancement
```

On Quest, start with SH0/RGB only. Fetch or decode enhancement streams only when the frame deadline and network budget allow.

## 3. Keep packed values packed

Where shader cost permits:

* retain fixed-point positions;
* retain packed quaternion representation;
* retain byte scales, colours and opacity;
* decode them in the vertex shader.

This trades a modest amount of GPU arithmetic for less CPU unpacking, less memory and less upload bandwidth.

## 4. Avoid full sorting every XR refresh

Initial options, in increasing R&D complexity:

1. Sort once per 25/30 Hz content frame using the midpoint between the eyes.
2. Reuse that order for both eyes.
3. Resort only when head rotation or translation crosses a threshold.
4. Use the previous temporal frame’s ordering as the starting permutation.
5. Use coarse depth bins followed by local sorting.
6. Test stochastic or weighted order-independent rendering.

For stable splat identities, temporal order reuse could be especially effective. Most splats will move only a short distance in depth between adjacent 30 Hz frames.

## 5. Double-buffer GPU storage

Allocate the maximum supported actor capacity once, for example:

```text
buffer A: currently rendered
buffer B: receiving next frame
```

Use sub-updates into existing textures or buffers. Swap only references and the active splat count.

# New temporal file-format direction

A custom format is justified if SPZ v4 remains above the latency target after memory reuse and direct output are implemented.

A provisional format could be thought of as a **Gaussian Splat Sequence**, rather than another static GS file.

## Sequence structure

```text
Sequence header
  version
  timebase / frame rate
  frame count
  coordinate system
  maximum splat count
  attribute mask
  quantisation profile
  global bounds

Frame index
  timestamp
  byte offset
  byte size
  keyframe / delta flag
  reference frame
  quality layers
  checksum

Frame or GOP payload
  block table
  spawn/despawn mask
  positions or residuals
  rotations or residuals
  scales or residuals
  colours / opacity
  optional SH layers
```

## Essential properties

### Direct GPU layout

The base frame representation should already match the intended Quest renderer layout. Decoding should mostly consist of:

* entropy decompression;
* bit unpacking;
* writing into persistent destination memory.

### Keyframes plus temporal deltas

A full keyframe every short group of pictures, with intermediate frames encoding:

* position residuals;
* rotation residuals;
* scale residuals;
* opacity changes;
* spawn/despawn masks;
* block-level transformations.

The largest research question is temporal correspondence. If individual splat identity is unstable, correspondence can operate at a block or cluster level instead.

### Quality layers

For example:

```text
Base layer:        50k essential splats
Enhancement 1:    additional 25k
Enhancement 2:    additional 25k+
SH enhancement:   view-dependent colour
```

The 6G adaptation controller can select:

* source frame stride;
* splat layer count;
* SH degree;
* quantisation tier;
* prefetch depth.

This is more useful than only changing network buffering.

### Decoder-speed-first compression

The best codec is not necessarily the smallest file.

Benchmark:

* uncompressed packed GPU layout;
* bit-packed only;
* LZ4-like low-latency compression;
* Zstandard at low levels;
* SPZ v4;
* SOG/WebP;
* temporally coded attribute images.

Evaluate **decode-to-GPU latency and energy**, not just bytes.

# Higher-risk R&D directions

## Video-codec attribute planes

With stable splat ordering, attributes can be placed into 2D images:

```text
position plane sequence
rotation/scale plane sequence
colour/opacity plane sequence
```

These sequences could then be encoded using a temporal video codec and decoded through browser media APIs. This potentially exploits motion compensation and hardware/native decoding.

It is high-risk because:

* stable identity/order is required;
* video codecs introduce quantisation designed for images rather than geometry;
* decoded image access may involve colour conversion;
* efficient zero-copy transfer into WebGL must be validated on Quest;
* several attribute planes may require synchronized decoding.

Nevertheless, this is one of the more promising genuinely new directions.

## Canonical splats plus deformation

Instead of 30 independent point clouds:

```text
canonical actor splats
    + per-frame deformation parameters
```

Possible deformation representations include:

* skeletal or dual-quaternion skinning;
* deformation graph;
* low-rank blendshape basis;
* block transforms plus residuals;
* compact neural deformation field.

This could remove most per-frame colour, opacity and scale transmission. The main risk is the quality of topology-changing regions such as clothing, hair and hands.

## Hybrid mesh plus splat residuals

Use:

* a low-detail animated mesh for body geometry and depth;
* splats for appearance, hair and difficult surface detail.

This reduces sorting and improves compositing while retaining much of the splat visual quality.

## Sorting-free renderer

Stochastic and weighted formulations are now credible options. A custom WebGL2 renderer could expose quality through sample count rather than splat count and sorting frequency. The static representation might need retraining or adaptation for best quality, but dynamic human content may tolerate some stochastic noise better than sort stalls and 10–15 fps playback. ([CVF Open Access][4])

# Renderer strategy

## Highest-probability browser path

A small custom **WebGL2/WebXR dynamic-splat renderer** is probably the most controllable route for Quest Browser:

* persistent GPU textures;
* renderer-defined packed layout;
* one central-eye sort;
* same order for both eyes;
* optional sort-free modes;
* fixed frame ring;
* no static-model loading lifecycle;
* Babylon or another engine used only for XR session, input, UI and conventional meshes.

## PlayCanvas evaluation

Run the same dataset through:

1. PlayCanvas WebGL2 GS renderer;
2. SOG/WebP loading;
3. SPZ v4 loading;
4. stereo XR;
5. WebGPU GPU-sort rendering in both flat and immersive-XR modes.

PlayCanvas’s recent GPU radix sort, stereo XR support and GS benchmarks make it a valuable performance reference. Each run must report the actual graphics backend and resolved GS renderer so a WebGL fallback is not mislabeled as WebGPU. ([GitHub][12])

## Native Quest control implementation

A minimal native OpenXR/Vulkan renderer is an important control experiment.

It does not need to become the product immediately. Its purpose is to answer:

> Is 100k dynamic splats fundamentally too expensive on Quest 3, or is the limiting factor the browser/WebGL/WebXR execution path?

If native reaches the target comfortably while WebXR does not, further format work alone will not solve the browser ceiling.

# Performance experiment matrix

Run these in order.

## Test 1 — static renderer ceiling

Preload one decoded 100k-splat frame and render it continuously in XR.

This removes network, decode, frame replacement and temporal sorting.

* Failure means the first problem is projection, overdraw, stereo resolution or renderer overhead.
* Success means dynamic preparation is the primary problem.

## Test 2 — predecoded animation

Store several frames already in the renderer’s upload layout.

Play them from memory using persistent buffers.

* Failure points to upload, sort or resource lifecycle.
* Success points to format decoding and conversion.

## Test 3 — no-sort animation

Render frames using a fixed or spatial order.

* Large improvement identifies sorting as the dominant cost.
* Small improvement shifts attention toward upload or fragment load.

## Test 4 — no-upload animation

Keep one GPU frame while running the complete fetch/decode/sort pipeline without uploading.

This separates worker throughput from driver/GPU synchronization.

## Test 5 — SPZ versus packed raw versus SOG

Use the same splats and quality level.

Measure:

```text
compressed bytes
fetch time
decode time
conversion time
upload time
peak memory
energy / thermal behaviour
```

## Test 6 — WebXR versus flat rendering

Use approximately equivalent resolution and identical splats.

A large XR-only difference identifies stereo, framebuffer resolution, compositor integration or engine XR handling.

## Test 7 — native control

Repeat the static and predecoded-animation tests through native OpenXR.

# Initial performance budgets

For a 30 fps source stream:

```text
content-frame throughput budget: 33.3 ms
```

For Quest’s 72 Hz XR loop:

```text
XR render budget: 13.9 ms
```

A reasonable first allocation is:

| Work                             |                    Initial target |
| -------------------------------- | --------------------------------: |
| Stereo GPU rendering             |                    below 10–11 ms |
| Main-thread scheduling and swap  |                below 1 ms average |
| GPU sub-upload                   | below 2–3 ms, without long stalls |
| Worker decode + unpack + sort    |            below 30 ms throughput |
| Main-thread blocking decode work |                  effectively zero |
| Buffered ready frames            |                               1–2 |
| Late-frame queue growth          |                              zero |

These are diagnostic targets rather than guaranteed final allocations.

# Recommended priority order

1. **Add end-to-end stage instrumentation.**
2. **Verify static 100k-splat XR rendering at 72 Hz.**
3. **Introduce persistent CPU and GPU frame slots.**
4. **Remove renderer-specific reallocation and object replacement.**
5. **Decode SPZ v4 directly into renderer-owned memory.**
6. **Decouple the 30 Hz content clock from the XR loop.**
7. **Use central-eye sorting and reduce sorting frequency.**
8. **Benchmark sort-free rendering.**
9. **Benchmark PlayCanvas WebGL2 plus SOG.**
10. **Prototype a GPU-ready independent-frame format.**
11. **Add temporal deltas and quality layers only after the independent-frame path is stable.**
12. **Build a minimal native Quest renderer as the browser-ceiling control.**

The main design pivot is:

> Stop optimizing the loading of 30 separate static splat models per second. Build a temporal splat media pipeline whose decoder, sorter and renderer share persistent memory and operate under presentation deadlines.

That change is likely to yield more than switching from SPZ to another static file format alone.

[1]: https://developers.meta.com/horizon/documentation/unreal/po-perf-opt-mobile//?utm_source=chatgpt.com "Basic Optimization Workflow for Apps | Meta Horizon OS Developers"
[2]: https://github.com/nianticlabs/spz?utm_source=chatgpt.com "GitHub - nianticlabs/spz: File format for 3D Gaussian splats. About 10x smaller than the PLY equivalent with virtually no perceptible loss in visual quality. Offered as open source by Niantic Labs. More details at https://scaniverse.com/spz #3dgaussiansplats #gaussiansplatting · GitHub"
[3]: https://github.com/sparkjsdev/spark/releases?utm_source=chatgpt.com "Releases · sparkjsdev/spark · GitHub"
[4]: https://openaccess.thecvf.com/content/ICCV2025/html/Kheradmand_StochasticSplats_Stochastic_Rasterization_for_Sorting-Free_3D_Gaussian_Splatting_ICCV_2025_paper.html?utm_source=chatgpt.com "ICCV 2025 Open Access Repository"
[5]: https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/fixedFoveation?utm_source=chatgpt.com "XRWebGLLayer: fixedFoveation property - Web APIs | MDN"
[6]: https://github.com/sparkjsdev/spark?utm_source=chatgpt.com "GitHub - sparkjsdev/spark: :sparkles: An advanced 3D Gaussian Splatting renderer for THREE.js · GitHub"
[7]: https://github.com/BabylonJS/Babylon.js/releases?utm_source=chatgpt.com "Releases · BabylonJS/Babylon.js · GitHub"
[8]: https://github.com/playcanvas/engine/releases?utm_source=chatgpt.com "Releases · playcanvas/engine · GitHub"
[9]: https://github.com/playcanvas/splat-transform/issues/38?utm_source=chatgpt.com "Gsplat SOG v2 file format proposal · Issue #38 · playcanvas/splat-transform"
[10]: https://communityforums.atmeta.com/discussions/Questions_Discussions/webgpu-compute-into-webxr-on-quest/1360706/?utm_source=chatgpt.com "WebGPU Compute into WebXR on Quest | Meta Community Forums - 1360706"
[11]: https://developers.meta.com/horizon/release-notes/?search_key=browser "Meta Horizon release notes — Browser 146.0"
[12]: https://github.com/playcanvas/engine/releases/tag/v2.20.0 "PlayCanvas Engine v2.20.0"
