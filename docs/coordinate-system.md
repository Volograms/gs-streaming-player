# Coordinate-System Convention

The player world follows Three.js conventions. It is right-handed, uses `+X` to the
right, `+Y` up, and `+Z` towards the viewer for the default camera arrangement. A camera
placed on `+Z` looks towards the origin along `-Z`.

## Units and transforms

World-space distances are interpreted as metres when content has a known physical scale.
Assets with arbitrary reconstruction units must supply an explicit scale before they are
combined with metre-authored content.

Manifest transforms map an object's local coordinates into player world coordinates:

- position is Cartesian `{ x, y, z }`;
- rotation is a quaternion `{ w, x, y, z }`;
- scale is per-axis `{ x, y, z }`;
- a 16-number matrix uses Three.js column-major ordering and overrides the component
  fields.

Component transforms apply local scale first, then rotation about the local origin, then
translation: `worldPoint = position + rotation(scale * localPoint)` (matrix `T * R * S`
for column vectors). Translation is not scaled or rotated by the object's own transform.
Rotation is about the asset origin, not its bounding-box centre.

Quaternion components are not Euler angles. Identity is
`{ "w": 1, "x": 0, "y": 0, "z": 0 }`. For a Y-axis angle `a`, use `w = cos(a / 2)`,
`y = sin(a / 2)`, and `x = z = 0`, with `a` in radians. For example, 60 degrees around Y
is approximately `{ "w": 0.8660254, "x": 0, "y": 0.5, "z": 0 }`. Renderers normalize
quaternion magnitude before applying component transforms so rotation cannot introduce
scale. An all-zero quaternion has no defined rotation and falls back to identity; use
the explicit identity above when authoring content. With `w = 0`, a nonzero `y` and zero
`x`/`z` normalize to a 180-degree Y rotation, regardless of the magnitude of `y`. Build
recipes support `rotationDegrees` for easier angle editing; runtime manifests require
quaternions.

The renderer never guesses or silently converts an asset's coordinate system. The same
rules apply to static splats, every frame of a dynamic sequence, and conventional
meshes. A dynamic sequence transform is applied identically to each prepared frame so
frame replacement cannot change alignment.

## Current RAD capture fixtures

The current static fixtures were observed in a Y-down/Z-forward capture convention. The
`rafa-pitch` dynamic range is provisionally configured with the same convention because
it uses the same conversion pipeline; its orientation still needs visual confirmation.
They are converted into the player world with a 180-degree rotation around X:

```json
{
  "rotation": { "w": 0, "x": 1, "y": 0, "z": 0 }
}
```

This conversion changes `(x, y, z)` to `(x, -y, -z)` without changing scale or origin.
It is fixture metadata, not a global renderer default; already aligned RAD content must
omit it.

## Origins and alignment

The player world origin is `(0, 0, 0)`. Until calibrated content metadata is available,
both the static-scene origin and the dynamic-person origin are the native reconstruction
origins after axis conversion. Translation and scale must be measured and recorded per
asset when the person is placed into a separately reconstructed environment.

glTF/GLB content is loaded with Three.js `GLTFLoader` and retains its glTF local axes
and metre convention. Its manifest transform is responsible for placement in the same
world. The demo marker intentionally has its own transform and does not inherit the RAD
capture conversion.

## Conversion assumptions

The current RAD files are produced from PLY input by Spark's quality LoD builder. The
pipeline is assumed to preserve PLY positions, orientations, opacity, and spherical
harmonics without an implicit world-axis conversion. Any SHARP export used as PLY input
must therefore use a consistent coordinate frame across all frames; the manifest
sequence transform performs the single capture-to-world conversion.

These assumptions still require content-level verification for physical scale, the
person ground/contact point, static/dynamic origin alignment, and background masking.
They must not be treated as known simply because an asset is visually upright.
