# Preparing a streaming dataset

The repository does not reconstruct 4DGS and contains no large datasets. Start with an
ordered, registered per-frame Gaussian sequence and optional static scene.

## 1. Reconstruct and register

Use an external reconstruction pipeline.
[Apple SHARP](https://github.com/apple/ml-sharp) is one example that produces per-image
3DGS PLY output. Its OpenCV coordinates are not silently converted by this player.
Temporal coherence, subject/background separation, registration, scale, origin, and
transform calibration belong to the dataset producer.

## 2. Generate dynamic tiers

Keep each registered dynamic frame as PLY or SPZ. The public authoring path uses
PlayCanvas SplatTransform's merge-based decimation to create complete, independent
quality tiers, then writes each tier as bundled SOG or SPZ v4. Use identical tier
definitions across the ordered frame set.

Streamed SOG is a different tool: its spatial hierarchy supports camera-dependent
streaming of a large persistent scene. It is used for static objects, not as the source
of temporal frame tiers.

## 3. Define the build

Create a JSON config with `version`, dataset `id`, `frameRate`, ordered
`dynamic.frames`, and `dynamic.tiers`. Add transforms, static sources, and audio when
needed. Paths are resolved relative to the config file.

```json
{
  "version": 1,
  "id": "sample-performance",
  "frameRate": 30,
  "dynamic": {
    "id": "performer",
    "frames": ["frames/frame-0000.ply", "frames/frame-0001.spz"],
    "outputFormat": "sog",
    "tiers": { "quarter": 0.25, "half": 0.5, "full": 1 },
    "minimumPlayable": "quarter",
    "maxSh": 0
  },
  "staticObjects": [{ "id": "stage", "input": "static/stage.ply" }],
  "audio": { "input": "audio/performance.ogg", "offsetSeconds": 0 }
}
```

Preview and run:

```bash
pnpm gs-content build dataset.json --output-dir dist/content --dry-run
pnpm gs-content build dataset.json --output-dir dist/content
```

Existing output is protected; pass `--force` only after checking the target. The build
stages output, generates merge-decimated dynamic tiers, exports static Streamed SOG,
copies audio, populates exact splat/byte metadata, validates the canonical manifest, and
then promotes the result. `outputFormat` defaults to `"sog"`; use `"spz"` to produce SPZ
v4 tiers for an experimental runtime path.

To generate tiers without building a complete dataset:

```bash
pnpm gs-content generate-tiers frame-0000.ply frame-0001.spz \
  --output-dir generated/dynamic \
  --format sog \
  --tiers preview=0.10,minimum=0.25,medium=0.50,full=1

pnpm gs-content generate-tiers frame-0000.ply \
  --output-dir generated/dynamic-spz \
  --format spz
```

The first tier at ratio `1` is a format conversion; smaller ratios are public
SplatTransform merge-decimation passes. Each generated tier is inspected again so
`quality-cuts.json` contains the actual splat count and file size. Existing lower-level
commands remain available from `pnpm gs-content help`.

### Legacy RAD datasets

`gs-content extract-rad-cuts` and its pinned Spark Rust helper remain in the repository
for existing quality-LoD RAD datasets and historical experiment reproduction. The normal
`generate-tiers` and `build` commands neither invoke nor compile that helper.

## 4. Host and verify

Upload the entire output layout without changing relative paths. Serve correct MIME
types, enable CORS, use HTTPS, and retain byte-identical assets referenced by the
manifest. Validate locally and run the opt-in real-asset browser test before release.

See the public [SplatTransform project](https://github.com/playcanvas/splat-transform)
and the
[Streamed SOG authoring guide](https://developer.playcanvas.com/user-manual/splat-transform/streamed-sog/).
