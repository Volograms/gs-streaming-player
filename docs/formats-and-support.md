# Formats and support

## Recommended preview

**PlayCanvas + SOG v2** is the supported preview path. SOG keeps attribute decoding and
sorting on the GPU when WebGPU is active. WebGL2 and CPU sorting are the fallback. Use
bundled SOG files for temporal frame tiers and Streamed SOG (`lod-meta.json`) for large
spatial static scenes.

See PlayCanvas's
[format guidance](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/).

## Supported authoring inputs

**PLY and SPZ** are the normal per-frame inputs. The content tool uses public
SplatTransform merge-based decimation and emits independent bundled SOG tiers by
default, or SPZ v4 tiers when explicitly selected. The authoring pipeline does not need
Spark or RAD.

**Streamed SOG** is generated separately for large persistent static scenes. Its tree
selects spatial content for the current view; it does not replace the complete per-frame
tier generation needed for temporal playback.

## Experimental

- **Spark + RAD or flat SPZ:** retained for hierarchy, scheduler, and renderer research.
- **Babylon.js + SPZ v4:** retained to compare an official CPU decode path.
- **Quality-LoD RAD authoring:** the existing extractor remains for legacy datasets and
  experiment reproduction, but is not called by the public build workflow. See
  [Spark RAD LoD generation](https://sparkjs.dev/docs/lod-getting-started/).
- **SPZ v3:** recorded decoding cost makes it unsuitable as a production claim.
- **Dynamic paged RAD on Quest:** tree merging and decoding are CPU-bound in the tested
  Spark 2.x path and compete with playback and XR work.

Support labels describe this repository's measured product path, not the general
capabilities of the upstream projects.
