# Preparing a streaming dataset

The repository does not reconstruct 4DGS and contains no large datasets. Start with an
ordered, registered per-frame Gaussian sequence and optional static scene.

## 1. Reconstruct and register

Use an external reconstruction pipeline.
[Apple SHARP](https://github.com/apple/ml-sharp) is one example that produces per-image
3DGS PLY output. Its OpenCV coordinates are not silently converted by this player.
Temporal coherence, subject/background separation, registration, scale, origin, and
transform calibration belong to the dataset producer.

## 2. Generate RAD LoD sources

Create quality-LoD RAD files for dynamic frames and static sources. Inspect cuts before
conversion and use identical tier definitions across the ordered frame set.

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
    "frames": ["rad/frame-0000.rad", "rad/frame-0001.rad"],
    "tiers": { "quarter": 0.25, "half": 0.5, "full": 1 },
    "minimumPlayable": "quarter",
    "maxSh": 0
  },
  "staticObjects": [{ "id": "stage", "input": "rad/stage.rad" }],
  "audio": { "input": "audio/performance.ogg", "offsetSeconds": 0 }
}
```

Preview and run:

```bash
pnpm gs-content build dataset.json --output-dir dist/content --dry-run
pnpm gs-content build dataset.json --output-dir dist/content
```

Existing output is protected; pass `--force` only after checking the target. The build
stages output, orchestrates RAD cuts and SOG conversion, exports static Streamed SOG,
copies audio, populates splat/byte metadata, validates the canonical manifest, and then
promotes the result. Lower-level commands remain available from `pnpm gs-content help`.

## 4. Host and verify

Upload the entire output layout without changing relative paths. Serve correct MIME
types, enable CORS, use HTTPS, and retain byte-identical assets referenced by the
manifest. Validate locally and run the opt-in real-asset browser test before release.

PlayCanvas's `SplatTransform` can help with authoring transforms; see
[SplatTransform](https://developer.playcanvas.com/user-manual/gaussian-splatting/editing/splat-transform/).
