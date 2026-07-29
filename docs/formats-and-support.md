# Formats and support

## Recommended preview

**PlayCanvas + SOG v2** is the supported preview path. SOG keeps attribute decoding and
sorting on the GPU when WebGPU is active. WebGL2 and CPU sorting are the fallback. Use
bundled SOG files for temporal frame tiers and Streamed SOG (`lod-meta.json`) for large
spatial static scenes.

See PlayCanvas's
[format guidance](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/).

## Authoring intermediate

**Quality-LoD RAD** is the common tree-based authoring input. Its hierarchy is useful
for producing flat quality cuts consumed by all conversion paths. It is not the
recommended dynamic Quest runtime format. See
[Spark RAD LoD generation](https://sparkjs.dev/docs/lod-getting-started/).

## Experimental

- **Spark + RAD or flat SPZ:** retained for hierarchy, scheduler, and renderer research.
- **Babylon.js + SPZ v4:** retained to compare an official CPU decode path.
- **SPZ v3:** recorded decoding cost makes it unsuitable as a production claim.
- **Dynamic paged RAD on Quest:** tree merging and decoding are CPU-bound in the tested
  Spark 2.x path and compete with playback and XR work.

Support labels describe this repository's measured product path, not the general
capabilities of the upstream projects.
