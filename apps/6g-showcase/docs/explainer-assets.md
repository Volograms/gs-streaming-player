# Explainer demo-object assets

The explainer layer (see `gaussian-splat-explainer-spec.md`) shows one small object
being "trained" on a stage next to the presenter. `gs-content build-explainer` prepares
everything it needs from one OpenSplat training run.

## Inputs

A nerfstudio-style OpenSplat project, kept outside Git (for example the ignored
`apps/6g-showcase/gs-truck/`):

- `transforms.json`: shared intrinsics and camera-to-world poses;
- `sparse_pc.ply`: the SfM sparse cloud that OpenSplat initialises from;
- `splat_<iteration>.ply` checkpoints from `--save-every`.

Save early checkpoints densely (every 50 iterations up to about 500): most of the
visible change happens before iteration 500. Run with the full `-n` of the original
training and stop it early. OpenSplat decays learning rates over `-n`, so a short
`-n 500` run is not comparable with the full run.

## Config

`apps/6g-showcase/explainer/truck-assets.json` is the reference. Paths are relative to
the config, and `datasetDir` is relative to the config file.

| Field               | Meaning                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage.origin`      | Ground point under the object, in the training frame. Becomes the stage origin.                                                                                                                                                                                |
| `stage.up`          | Ground normal in the training frame. Becomes stage `+Y`.                                                                                                                                                                                                       |
| `stage.forward`     | Object's long axis in the training frame. It is projected onto the ground and becomes stage `+X`.                                                                                                                                                              |
| `cropBoxes`         | Non-overlapping `{ min, max }` boxes in stage metres (Y-up), kept as a union. Everything outside them is removed from every checkpoint and from the sparse cloud. Use a narrower low slab to trim ground next to the object without cutting its body.          |
| `maxSh`             | Spherical-harmonic bands kept (default `1`).                                                                                                                                                                                                                   |
| `checkpoints`       | Ordered iterations to ship. `{ "iteration": 0, "source": "initialisation" }` generates the pre-training state from the sparse cloud.                                                                                                                           |
| `trainingCountDirs` | Directories scanned for `splat_<n>.ply` headers; their real counts drive the explainer's gaussian counter.                                                                                                                                                     |
| `cameraCount`       | Training cameras kept for the frustum ring, spread evenly by azimuth (default `20`).                                                                                                                                                                           |
| `comparisonView`    | Optional `{ camera }`, an index into the selected camera ring: copies that training photo to `comparison/photo.<ext>` and renders every checkpoint from the same camera (its real pose and intrinsics, distortion ignored) to `comparison/render-<nnnnn>.png`. |
| `ellipsoidView`     | Optional `{ iteration, count }`: exports up to `count` opaque gaussians of that checkpoint, evenly strided, to `ellipsoids.bin` for the ellipsoid view.                                                                                                        |
| `projectionView`    | Optional `{ iteration, eye, lookAt, verticalFovDegrees, width, height }` in stage metres and pixels: renders that checkpoint (normally the final one) from a virtual look-at camera into `projection.png`, the image that beat 7 resolves into.                |

## Build

```bash
pnpm gs-content build-explainer apps/6g-showcase/explainer/truck-assets.json \
  --output-dir apps/6g-showcase/public/assets/explainer/truck [--force]
```

Output (the `public/assets/` output directory is ignored by Git):

- `checkpoints/iteration-<nnnnn>.sog`: one SOG per configured checkpoint, in the stage
  frame;
- `sparse-points.bin`: the cropped sparse cloud, in three blocks: `float32` xyz for
  every point, then `float32` initial gaussian sigma (mean distance to the three nearest
  points, as OpenSplat initialises), then `uint8` rgb. The index gives each block's byte
  offset;
- `projection.png`, when `projectionView` is set: a render of every gaussian of that
  checkpoint (straight alpha, transparent background). It comes from the command's CPU
  3D Gaussian Splatting rasteriser (`renderGaussians.ts`): EWA projection of each 3D
  covariance, a depth sort, front-to-back alpha compositing and spherical harmonics up
  to degree 1. It needs no GPU or browser;
- `comparison/`, when `comparisonView` is set: the training photo and one straight-alpha
  render per checkpoint from its camera, for the photo / render / error panels;
- `ellipsoids.bin`, when `ellipsoidView` is set: 13 `float32` per gaussian (stage-frame
  position, rotation `w, x, y, z`, linear sigma, SH DC colour);
- `explainer-assets.json`: checkpoint URLs with cropped and training splat counts, the
  full training-count curve, the camera subset (stage-frame position, camera-to-stage
  quaternion `[w, x, y, z]` looking down `-Z`, vertical FOV, source image), the crop
  box, the source-to-stage transform, and the projection camera with its image URL.

The stage frame follows `docs/coordinate-system.md` (right-handed, `+Y` up, metres when
the reconstruction is metric). Place the stage in the scene with the explainer's own
transform, not by editing the assets.

SplatTransform applies `--translate`/`--rotate`/`--filter-box` in PlayCanvas's PLY
viewing frame, which is rotated 180° about Z from the file frame. The command
compensates for this, and a unit test replays that behaviour. Previewing the outputs in
SplatTransform's HTML viewer therefore needs an extra `--rotate=0,0,180`.
