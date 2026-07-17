# Spark Renderer Integration

`@6g-path/gaussian-renderer-spark` implements the renderer-neutral contracts from
`@6g-path/gaussian-player` using Spark 2.1 and Three.js 0.180.

## Initialisation

The smallest integration gives the adapter a caller-owned canvas:

```ts
import { SparkGaussianRendererAdapter } from "@6g-path/gaussian-renderer-spark";

const adapter = new SparkGaussianRendererAdapter({ canvas });
await adapter.initialise();
```

In this form the adapter creates and owns the Three.js renderer, scene, camera, Spark
renderer, resize observer, and animation loop. `dispose()` releases all of them.

Applications that already own a Three.js scene or renderer can pass either or both:

```ts
const adapter = new SparkGaussianRendererAdapter({
  autoRender: false,
  camera,
  renderer,
  scene,
});

await adapter.initialise();

function render() {
  adapter.render();
  requestAnimationFrame(render);
}
```

Caller-owned scenes, cameras, and renderers are never disposed. The adapter removes and
disposes only the Spark node and content that it loaded. Automatic rendering and resize
management default to off when a caller-owned renderer is supplied and can be enabled
explicitly.

## Static splats and meshes

Static `.RAD` objects use Spark's paged loading mode. Conventional `.gltf` and `.glb`
objects use Three.js `GLTFLoader`:

```ts
const room = await adapter.loadStaticObject(
  {
    id: "room",
    url: "/content/room.rad",
    transform: { position: { x: 0, y: 0, z: -2 } },
  },
  {
    signal,
    onProgress(progress) {
      console.log(progress.loadedBytes, progress.totalBytes);
    },
  },
);

await adapter.loadMesh({ id: "table", url: "/content/table.glb" });
adapter.setObjectVisibility(room.id, false);
adapter.releaseObject(room.id);
```

Objects are added to the scene only after loading succeeds. A failed object is disposed
without changing already loaded content, and its identifier may be retried. Cancellation
rejects the caller's operation and ensures resources that complete later are disposed.

## Transform convention

Splats and meshes share the manifest transform convention:

- position is Cartesian `x`, `y`, `z`;
- rotation is a quaternion expressed as `w`, `x`, `y`, `z`;
- scale is per-axis `x`, `y`, `z`;
- a 16-value matrix uses Three.js column-major ordering and takes precedence over the
  component fields.

The adapter performs no implicit capture/Three.js axis conversion. Content-specific
alignment must be expressed in the manifest transform so splats and meshes remain
consistent. See the [coordinate-system convention](coordinate-system.md).

## Current validation boundary

Unit tests exercise loading, progress, cancellation, transforms, visibility, failure
isolation, frame switching, and resource disposal through injected non-WebGL runtimes.
The demo browser test exercises real Spark initialisation, real glTF parsing, and opt-in
loading of the local quality-LoD `.RAD` fixture. Dynamic sequence validation remains
pending until representative frame assets and their coordinate conventions are
available.

## Dynamic frame slots

Every prepared dynamic frame is backed by a `SparkFrameSlot`. A slot tracks its source,
sequence and frame identity, load progress, readiness, quality level, visibility, error,
and cancellation state. The adapter exposes immutable diagnostic snapshots:

```ts
const prepared = await adapter.prepareFrame("actor", frame, {
  signal,
  transform: sequence.transform,
});
adapter.presentFrame(prepared);

console.table(adapter.getFrameSlotSnapshots());

adapter.hideFrame(prepared);
adapter.releaseFrame(prepared);
```

Presenting a paged frame hides the previously active frame without recreating the scene.
Flat SPZ slots retain decoded CPU data and are never individually added to the scene.
The adapter instead copies the selected slot into one grow-only GPU-facing
`PackedSplats` mesh. Releasing a slot disposes its decoded CPU data; the shared display
allocation remains available for later frames. The sequence transform is copied to the
display at handoff, preserving alignment across frame replacement.

For paged RAD content, Spark's `SplatMesh.initialized` only establishes the mesh and RAD
metadata; it does not guarantee that drawable splats are resident. `prepareFrame()`
therefore resolves only after chunk 0 has been fetched and uploaded by Spark's pager.
During that interval the slot is scene-visible with zero opacity and zero LoD scale, so
Spark can fetch its root without displaying it. The temporal buffer can then enable LoD
refinement for selected future slots while they remain transparent. `presentFrame()`
restores the configured LoD scale and opacity in the same synchronous operation that
warms the old frame, preventing a blank replacement frame. Visibility and LoD changes
explicitly invalidate Spark's traversal so paging begins without camera movement.

## LoD and foveation controls

`setSparkRenderQuality()` configures the complete Spark-specific quality surface used by
the player:

```ts
adapter.setSparkRenderQuality({
  enableLod: true,
  splatBudget: 1_500_000,
  lodSplatScale: 1,
  lodRenderScale: 1,
  staticSceneWeight: 1,
  objectWeights: { room: 1.25 },
  dynamicSequenceWeights: { actor: 0.75 },
  maximumSphericalHarmonics: 3,
  foveation: {
    fullDetailFovDegrees: 90,
    peripheralDetailFovDegrees: 120,
    peripheralScale: 0.4,
    behindScale: 0.2,
  },
});
```

Invalid budgets, weights, SH levels, scales, and FOV relationships are rejected before
Spark is mutated. `getSparkRenderQuality()` returns a detached copy of the effective
configuration. The renderer-neutral `setRenderQuality()` translates adaptive player
decisions into the same configuration.

## Metrics

`getMetrics()` reports frame time and FPS, rendered splats, loaded static and mesh
counts, active and prepared dynamic frames, current resource load states, cumulative
load failures, and Spark GPU page use/capacity when its pager is available. Resource
entries include URLs, byte progress, visibility, type, and readiness.
