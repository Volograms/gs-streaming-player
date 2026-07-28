# PlayCanvas SOG Renderer Integration

`@6g-path/gaussian-renderer-playcanvas` is an independent `GaussianRendererAdapter` for
PlayCanvas's native SOG v2 path. It shares renderer-neutral fetching, compressed-byte
caching, frame scheduling, transfer-tier selection, and playback timing with the other
demos, but it does not decode SOG into the neutral floating-point Gaussian frame used by
SPZ integrations.

The implementation is ready for browser testing; sustained cadence, memory use, and
stereo correctness on Quest 3 remain to be measured.

## Runtime data path

```text
quality-cuts.json (format: flat-sog-quality-cuts)
        |
        v
selected frame/tier .sog bytes
        |
        v
player compressed-byte cache
        |
        v
PlayCanvas adapter -> native SOG asset -> persistent dynamic entity
                                      -> PlayCanvas WebGL2 CPU sort
                                      -> PlayCanvas WebGPU GPU sort / WebXR
```

The adapter advertises only the explicit `sog-v2` compressed-frame capability. It hands
the cached `ArrayBuffer` to PlayCanvas's SOG asset loader, retains prepared native
assets for the bounded frame window, and changes the asset attached to one persistent
dynamic entity at presentation. It applies the same player transform contract as the
other adapters and releases native assets when the frame buffer evicts them.

Normal playback follows PlayCanvas's native GSplat flipbook behavior: assigning the next
asset and requesting a render completes the handoff without blocking the playback clock
on the diagnostic `frame:ready` event. Embedders that need a fully sorted capture fence
can enable `waitForFrameReady`; that optional wait is bounded and is not used by the
demo.

There is no runtime SPZ-to-SOG transcode and no silent fallback to Spark or Babylon. A
source index or environment codec that does not declare `sog-v2` fails before playback.

## Convert SPZ content

Convert a standalone static SPZ scene offline (SPZ v2 through v4 inputs are accepted by
the pinned `splat-transform` converter):

```bash
pnpm gs-content convert-sog test-data/static/environment.spz \
  --output-dir generated/static-sog
```

This writes `generated/static-sog/environment.sog`. As with dynamic assets, an existing
output is protected unless `--force` is supplied.

Convert an existing flat SPZ quality-cut index offline:

```bash
pnpm gs-content convert-sog \
  ../sparkjs/data-ply/dynamic/rafa-pitch-cuts-v4/quality-cuts.json \
  --output-dir ../sparkjs/data-ply/dynamic/rafa-pitch-cuts-sog
```

The command converts every local tier asset referenced by the input index, writes a SOG
file per frame and tier, updates each output byte size and codec to `sog-v2`, and emits
an index with the same filename (`quality-cuts.json` in this example) in the output
directory. Frame numbers, detail ratios, splat counts, and the minimum-playable tier are
preserved. The converter is an offline content step; it does not lower the selected
playback quality.

SOG spherical-harmonic compression uses 10 iterations and up to four workers by default.
Tune those encoder controls explicitly when preparing a recorded comparison:

```bash
pnpm gs-content convert-sog quality-cuts.json \
  --output-dir generated/sog \
  --sh-iterations 10 \
  --max-workers 4
```

Use `--max-workers 0` to encode inline. Record non-default encoder settings with test
results because conversion changes the compressed representation even though it
preserves the runtime tier metadata.

The input must be a version 1 `flat-spz-quality-cuts` index. Every tier URL must be a
relative local `.spz` path within the index directory; remote URLs, absolute paths,
other schemes, and parent-directory traversal are rejected. The output index uses
`format: "flat-sog-quality-cuts"`, and an existing output index or asset is protected
unless `--force` is supplied. Nested source metadata is retained, except its format is
changed from `spz` to `sog`. Duplicate source URLs are converted once. For a long
sequence, conversion is intentionally bounded rather than retaining every source and
output frame in memory at once.

Expose the output using the same public asset mechanism as the other demos. For example,
create a directory link named `apps/demo/public/assets/local-dynamic-cuts-sog` that
points to the generated directory.

## Export a static Streamed SOG LOD tree

A bundled `.sog` file is compressed, but it is not itself a spatial LOD tree. For a
large persistent environment, generate PlayCanvas's Streamed SOG layout instead:

```bash
pnpm gs-content export-sog-lod generated/static-sog/environment.sog \
  --output-dir generated/static-sog-lod \
  --lod-ratios 1,0.5,0.25,0.1 \
  --lod-chunk-count 512 \
  --lod-chunk-extent 16
```

The exporter materialises non-PLY input as a temporary full-detail PLY, creates
temporary decimated PLY levels, then feeds all levels to the pinned PlayCanvas
`splat-transform` package with explicit LOD tags. The output directory contains
`lod-meta.json` plus its spatial SOG chunks. Temporary PLY files are removed when the
command finishes. Source `.ply`, `.compressed.ply`, `.spz`, and `.sog` files are
accepted by the underlying converter; prefer the highest-quality original source
available instead of recompressing an already compressed `.sog`.

The default ratios are `1,0.5,0.25,0.1`. They must begin at full detail and descend
strictly, with at least one coarse level. `--lod-chunk-count` is measured in thousands
of Gaussians and defaults to PlayCanvas's 512K; `--lod-chunk-extent` defaults to 16
world units. Both values affect tree granularity and should be profiled against the
actual environment scale. Existing `lod-meta.json` output is protected unless `--force`
is specified.

Serve the complete output directory without renaming its index and point the static
scene URL at that index:

```dotenv
VITE_STATIC_GS_URL=/assets/static-sog-lod/lod-meta.json
```

PlayCanvas recognises that exact basename as its streamed octree resource. The existing
static scale and X-rotation settings apply to the resulting entity in the same way as
they do to a bundled `.sog`.

For a static-only Quest performance test, leave the dynamic index blank. The demo still
initialises the renderer, loads the static tree, updates render diagnostics, and enables
its normal VR entry path; dynamic playback controls remain disabled:

```dotenv
VITE_DYNAMIC_QUALITY_INDEX_URL=
VITE_STATIC_GS_URL=/assets/static-sog-lod/lod-meta.json
```

### Control static LOD during a benchmark

PlayCanvas chooses a Streamed SOG LOD independently for each spatial leaf. LOD 0 is the
finest source passed to `export-sog-lod`; LOD 1 is the first coarse ratio, and so on.
Its normal selection uses the camera's distance to each node's bounding box with
field-of-view compensation. On the WebGPU path, a later bounds-culling stage removes
off-screen node ranges from GPU rendering; LOD selection and budgeting still account for
the active octree nodes rather than only the final visible pixels.

Pin every selected static node to one exported level with:

```dotenv
VITE_STATIC_GS_LOD_LEVEL=2
VITE_PLAYCANVAS_SPLAT_BUDGET=0
```

For the default ratios `1,0.5,0.25,0.1`, levels 0 through 3 correspond to those four
ratios. Pinning fixes the per-node representation, so the active count normally settles
at that level's scene-wide count after its chunks load. The setting affects Streamed SOG
octrees and has no useful effect on a bundled single-resource `.sog`.

Alternatively, leave the level automatic and set a global PlayCanvas budget:

```dotenv
VITE_STATIC_GS_LOD_LEVEL=
VITE_PLAYCANVAS_SPLAT_BUDGET=500000
```

The budget balancer mixes LOD levels across spatial nodes to approach the requested
maximum. Zero means unlimited. This is a global unified-renderer budget, so dynamic or
other fixed splats also consume it when present. A budget is not an absolute guarantee:
the coarsest available active nodes and fixed non-LOD resources establish a lower bound,
and node/chunk granularity prevents every exact count. Avoid combining a pinned level
with a lower budget—the pin prevents the balancer from choosing a different level.

The demo reports the configured static LOD, budget, unified renderer's active splat
count, render FPS, render time, and sort time. The active count is the budgeted/sorted
workload before final WebGPU bounds and per-splat rejection, not a count of fragments
that reached the screen. For a repeatable Quest sweep, keep the camera pose and backend
fixed, then test the budget in increasing steps until frame time or head-tracked motion
becomes unacceptable.

For a visible scene that remains GPU-bound after the octree budget is reduced, tune the
WebGPU projector's rejection thresholds before changing the content format:

```dotenv
VITE_PLAYCANVAS_GSPLAT_MIN_PIXEL_SIZE=4
VITE_PLAYCANVAS_GSPLAT_MIN_CONTRIBUTION=5
VITE_PLAYCANVAS_GSPLAT_FOVEATION_STRENGTH=8
VITE_PLAYCANVAS_GSPLAT_FOVEATION_CENTER=0.3
```

The first two settings remove sub-pixel and low-opacity/area splats before the GPU radix
sort. Foveation progressively raises the contribution threshold outside the configured
central radius. Start with `MIN_PIXEL_SIZE` values 2, 3, and 4 while holding the camera
pose fixed, then add foveation for XR. These settings are global to the unified static
and dynamic scene and trade peripheral/fine detail for frame time.

`GS buffer copy` reports the percentage of PlayCanvas's unified work buffer uploaded in
the latest frame. It should settle at 0% while playback is paused. A spike when a new
dynamic SOG frame is presented identifies asset-placement upload cost separately from
the projection, sort, and draw cost that continues for every rendered view.

## Run the dedicated demo

Copy the example environment and point it at the converted index:

```bash
cp apps/demo-playcanvas/.env.example apps/demo-playcanvas/.env.local
```

```dotenv
VITE_DYNAMIC_QUALITY_INDEX_URL=/assets/local-dynamic-cuts-sog/quality-cuts.json
VITE_DYNAMIC_FRAME_CODEC=sog-v2
VITE_DYNAMIC_RAD_START_FRAME=1
VITE_DYNAMIC_RAD_END_FRAME=100
VITE_DYNAMIC_RAD_FRAME_RATE=30
VITE_DYNAMIC_COMPRESSED_BUFFER_MB=200
VITE_DYNAMIC_FETCH_CONCURRENCY=6
VITE_DYNAMIC_PREPARE_CONCURRENCY=2
VITE_DYNAMIC_FUTURE_FRAMES=10
VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgl2
VITE_ENABLE_XR=true
```

Start the development server on port 4177:

```bash
pnpm dev:playcanvas
```

Use the production build for timing captures; the profiling server listens on port 4178:

```bash
pnpm profile:playcanvas
```

Keep the same source frame range, tier, compressed-cache state, and hardware when
comparing PlayCanvas/SOG with another adapter/codec path. Record content conversion and
runtime versions with the result; SOG and SPZ byte sizes and decode stages are not
directly interchangeable.

## WebGPU GPU-sort experiment

The demo retains WebGL2 as its default comparison baseline. Select PlayCanvas's WebGPU
device and stable GPU-sort Gaussian renderer explicitly with:

```dotenv
VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgpu
```

WebGPU initialisation is strict for this experiment. PlayCanvas normally appends WebGL2
as a device fallback, but the adapter rejects that fallback when `webgpu` was requested
so a WebGL CPU-sort run cannot be mistaken for a GPU-sort result. The diagnostics must
show:

```text
Graphics    webgpu
Sort path  gpu (no CPU centers)
```

The adapter disables `scene.gsplatCentersEnabled` before loading any SOG asset on this
path. That prevents PlayCanvas from generating centers, reading them back from the GPU,
cloning the center array, and feeding its WebGL CPU-sort worker. Attribute
reconstruction, GPU upload, GPU sorting/culling, and rasterisation remain
PlayCanvas-owned work.

Run a controlled WebGL2/WebGPU pair in the same production session:

1. Set `VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgl2`, build, warm the selected tier, and
   record SOG prepare, sort, FPS/cadence, memory, and a trace.
2. Set `VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgpu`, rebuild, verify the two diagnostics
   above, then repeat with the same frame range, tier, cache state, camera motion, and
   browser window size.
3. Test minimum, medium, and full without reducing the source tier to make a slow case
   pass. Record flat playback and immersive WebXR separately because their frame budgets
   and browser capabilities differ.

## HTTPS and Quest 3

WebXR on a headset requires a secure context. Generate the repository's ignored
`.cert/localhost-key.pem` and `.cert/localhost-cert.pem` files using the `mkcert`
procedure in the root README, include the development computer's current LAN address in
the certificate, and trust the `mkcert` root CA on the headset. Then add:

```dotenv
VITE_HTTPS=true
VITE_HOST=0.0.0.0
VITE_ENABLE_XR=true
VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgl2
```

Run `pnpm dev:playcanvas` and open `https://YOUR-LAN-IP:4177/` in the Quest browser. The
Windows connection profile and firewall must allow private-network access to that port.
Enter immersive VR from the demo control; session creation must remain in the user's
click gesture.

### Native WebGPU WebXR on Quest Browser 146+

Meta Quest Browser 146.0 introduced experimental WebGPU support in WebXR. On the
validated Quest 3 setup, open each of these URLs in the headset browser, set the flag to
**Enabled**, and relaunch the browser:

1. `chrome://flags/#webxr-webgpu-binding` — WebXR/WebGPU Binding
2. `chrome://flags/#webxr-projection-layers` — WebXR Projection Layers
3. `chrome://flags/#webxr-experiments` — WebXR Experiments

If Relaunch does not apply all three flags, fully close the browser or restart the
headset. These experimental settings belong to the Quest Browser profile and may need to
be rechecked after a browser update.

Configure the demo for strict native WebGPU-backed XR:

```dotenv
VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgpu
VITE_PLAYCANVAS_XR_BACKEND_FALLBACK=false
VITE_PLAYCANVAS_XR_MIRROR=false
```

After loading the demo, verify that its diagnostics report `Graphics webgpu`,
`Sort path gpu (no CPU centers)`, and `WebXR ready`. Entering VR then exercises
PlayCanvas's native WebGPU stereo path rather than the WebGPU-to-WebGL mirror.

PlayCanvas requires the browser to expose `XRGPUBinding` before a WebGPU graphics device
can host immersive XR. If the demo still reports `webgpu binding missing`, WebGPU page
rendering is available but the browser has not exposed the WebXR binding. Recheck the
browser version and all three flags. On older browser builds, use WebGL2 for XR
validation or enable `VITE_PLAYCANVAS_XR_BACKEND_FALLBACK=true` so the demo can select
WebGL2. The fallback is off by default so strict WebGPU measurements keep the requested
backend.

For a useful Quest comparison:

- keep the selected tier at 25% or higher instead of treating quality reduction as the
  optimisation;
- test paused visibility in both eyes before measuring continuous playback;
- record preparation/handoff cadence, renderer FPS, splat count, compressed-cache
  occupancy, and GPU/JS memory where the browser exposes it;
- use the production profile build after functional validation.

### WebGPU-to-WebGL XR mirror experiment

The PlayCanvas demo includes an opt-in bridge spike for browsers where WebGPU rendering
works but WebGPU-backed WebXR is blocked by a missing `XRGPUBinding`:

```dotenv
VITE_PLAYCANVAS_GRAPHICS_BACKEND=webgpu
VITE_PLAYCANVAS_XR_BACKEND_FALLBACK=false
VITE_PLAYCANVAS_XR_MIRROR=true
VITE_STATIC_GS_URL=/assets/YOUR_STATIC_ENVIRONMENT.sog
VITE_STATIC_GS_SCALE=1
VITE_STATIC_GS_ROTATION_X_DEGREES=0
VITE_STATIC_GS_POSITION_X=0
VITE_STATIC_GS_POSITION_Y=0
VITE_STATIC_GS_POSITION_Z=0
VITE_DYNAMIC_GS_POSITION_X=0
VITE_DYNAMIC_GS_POSITION_Y=0
VITE_DYNAMIC_GS_POSITION_Z=0
```

`VITE_STATIC_GS_SCALE` is a signed uniform scale, so values such as `-2` are passed
through to the PlayCanvas entity. Use `VITE_STATIC_GS_ROTATION_X_DEGREES=180` when an
asset needs an explicit upside-down orientation correction without changing handedness.
The `VITE_STATIC_GS_POSITION_*` and `VITE_DYNAMIC_GS_POSITION_*` values add independent
world-space offsets to the static scene and dynamic sequence. The demo exposes separate
live controls for both objects, so adjusting the static floor alignment does not move
the dynamic GS. Copy the final values into the environment configuration when the
placement should persist across reloads.

This adds an `XR mirror` button. It starts a separate WebGL2 WebXR session. For each XR
frame, the bridge anchors the initial viewer-center pose to the existing PlayCanvas
camera and supplies both ordered `left`/`right` WebXR view-to-world and projection
matrices through PlayCanvas's native `RenderView` path. This is required for the GPU
Gaussian projector to select its stereo variant. PlayCanvas renders both eyes into the
left and right regions of one WebGPU canvas. The region dimensions come directly from
the WebGL XR layer's per-eye viewports, avoiding the blur caused by splitting the normal
desktop canvas resolution between both eyes. The bridge uploads that native-resolution
packed canvas once and draws the matching region into each WebGL XR viewport. The canvas
stays in fixed-resolution mode during the mirror session because PlayCanvas's automatic
desktop resize runs at the start of every render and would otherwise collapse the packed
eye viewports back into the CSS canvas size. The original resolution mode, canvas
resolution, camera, XR views, and automatic render loop are restored when the session
ends.

Browsers can pause or heavily throttle normal window timers and animation frames while
an immersive session presents. The demo therefore migrates pending playback deadlines to
an XR-aware clock when the mirror starts. Each `XRSession.requestAnimationFrame`
services due playback work and drives PlayCanvas's update, `framerender`, render, and
`frameend` lifecycle. The complete lifecycle is necessary because dynamic splat
presentation commits during `prerender`, unified-splat streaming reconciles during
`framerender`, and deferred resource release completes at `frameend`. Ending the session
moves any remaining deadline back to a normal window timer without restarting the
playback timeline.

The source render and upload are synchronized because reading a WebGPU canvas after its
current texture has been presented can legitimately return transparent black without a
WebGL error. `Mirror render` reports the packed stereo source render; `Mirror copy`
reports its single upload plus both eye draws. `Mirror view` confirms whether WebXR
supplied a left/right stereo pair. `Mirror upload` is `direct` when the browser accepts
the WebGPU canvas as a WebGL texture source. If that operation returns
`INVALID_OPERATION`, the bridge switches to `canvas-2d`: the synchronized packed frame
is first drawn into an accelerated 2D canvas and that canvas is uploaded to WebGL. The
fallback copy remains included in `Mirror copy`.

Record `Static SOG`, `Mirror view`, `Mirror render`, `Mirror copy`, `Mirror FPS`, visual
stability, and headset comfort at minimum, medium, and full dynamic tiers. The bridge
fails visibly on WebGL context loss, other texture-upload errors, missing or incomplete
XR framebuffers, missing stereo views, and draw errors.

`Mirror source` should equal the two WebGL eye viewport widths combined by their maximum
height. A substantially larger source than the initial 1178 x 620 desktop canvas is
expected and makes the render/copy timings representative of the actual headset
resolution.

The first successful Quest 3 handoff used the `canvas-2d` fallback at 1178 x 620. A
captured sample reported a 9.4 ms `Mirror copy`, 1.4 ms `Mirror render`, and 24.5
`Mirror FPS` while displaying the 25% dynamic tier (about 68k rendered splats) in both
eyes. This validates image transfer, but not stereo or head tracking: the mono spike
deliberately sends the same desktop-camera image to both eyes. The configured static SOG
also failed to load in that run, so medium-quality and composed-scene measurements
remain open. That measurement predates the stereo implementation and is not
representative of the packed stereo render path.

## Current capability boundary

Native SOG removes the application's neutral Float32 frame, CPU scale exponentiation,
CPU quaternion-to-covariance expansion, and a second renderer-specific repack from this
path. SOG attribute reconstruction is performed by PlayCanvas's native shader path.

It does not prove that all per-frame work is GPU-only. On WebGL2, PlayCanvas may still
generate and read back centers for its sort data, perform depth sorting on the CPU, ask
the browser to decode WebP planes, and upload or retain textures for buffered assets.
The WebGPU experiment removes the center readback and CPU-sort-worker path but retains
browser WebP decode, texture/resource upload, GPU sorting/culling, and rendering. Those
remaining stages must be measured independently before attributing a speedup.

The PlayCanvas adapter is renderer-specific by design. Babylon, Spark, or another
renderer needs its own explicit SOG ingestion implementation to use this representation;
the PlayCanvas work does not add PlayCanvas dependencies or SOG-specific objects to
`player-core`.
