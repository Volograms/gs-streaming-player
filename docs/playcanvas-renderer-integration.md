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
                                      -> PlayCanvas WebGL/WebXR render path
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

## Convert existing quality cuts

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

## HTTPS and Quest 3

WebXR on a headset requires a secure context. Generate the repository's ignored
`.cert/localhost-key.pem` and `.cert/localhost-cert.pem` files using the `mkcert`
procedure in the root README, include the development computer's current LAN address in
the certificate, and trust the `mkcert` root CA on the headset. Then add:

```dotenv
VITE_HTTPS=true
VITE_HOST=0.0.0.0
VITE_ENABLE_XR=true
```

Run `pnpm dev:playcanvas` and open `https://YOUR-LAN-IP:4177/` in the Quest browser. The
Windows connection profile and firewall must allow private-network access to that port.
Enter immersive VR from the demo control; session creation must remain in the user's
click gesture. An unavailable XR runtime does not prevent normal desktop playback.

For a useful Quest comparison:

- keep the selected tier at 25% or higher instead of treating quality reduction as the
  optimisation;
- test paused visibility in both eyes before measuring continuous playback;
- record preparation/handoff cadence, renderer FPS, splat count, compressed-cache
  occupancy, and GPU/JS memory where the browser exposes it;
- use the production profile build after functional validation.

## Current capability boundary

Native SOG removes the application's neutral Float32 frame, CPU scale exponentiation,
CPU quaternion-to-covariance expansion, and a second renderer-specific repack from this
path. SOG attribute reconstruction is performed by PlayCanvas's native shader path.

It does not prove that all per-frame work is GPU-only. On WebGL, PlayCanvas may still
generate and read back centers for its sort data, perform depth sorting on the CPU, ask
the browser to decode WebP planes, and upload or retain textures for buffered assets.
Those stages are the next measurement boundary. Replace or patch PlayCanvas sorting and
shaders only after a production trace shows which remaining stage misses the Quest frame
budget.

The PlayCanvas adapter is renderer-specific by design. Babylon, Spark, or another
renderer needs its own explicit SOG ingestion implementation to use this representation;
the PlayCanvas work does not add PlayCanvas dependencies or SOG-specific objects to
`player-core`.
