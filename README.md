# Volograms 4DGS Streaming Player

Source-only public preview of a browser player for temporal Gaussian Splat sequences,
persistent static splats, optional meshes, audio, adaptive quality, and WebXR.

The recommended delivery path is **PlayCanvas + SOG v2**: WebGPU with GPU sorting when
the browser and its XR binding support it, with a one-time WebGL2 fallback. Spark/RAD
and Babylon/SPZ remain experimental laboratories for research and performance work.

> Public preview: APIs and the manifest may evolve. No dataset is distributed in this
> repository, and no Quest frame-rate guarantee is made.

## Run from source

Requirements: Node.js 22.12 or newer and Corepack. The pinned pnpm version manages the
workspace.

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev:showcase
```

Open `http://localhost:4180/#/`. The showcase accepts an external manifest URL at
`#/demo?manifest=https%3A%2F%2Fcdn.example.com%2Fmanifest.json`. Set
`VITE_DEFAULT_MANIFEST_URL` in `apps/showcase/.env.local` to load a public sample by
default. Without it, GitHub Pages publishes a functional manifest picker.

### Use a local dataset

The browser cannot load a filesystem path directly. For development, let Vite serve the
external dataset directory. If `C:/datasets/my-sequence/manifest.json` is the generated
manifest, create `apps/showcase/.env.local` containing:

```dotenv
SHOWCASE_LOCAL_DATASET_DIR=C:/datasets/my-sequence
VITE_DEFAULT_MANIFEST_URL=/manifest.json
```

Then run `pnpm dev:showcase` and open `http://localhost:4180/#/demo`. Manifest-relative
SOG, Streamed SOG, mesh, and audio URLs continue to resolve from that directory. A path
relative to the repository root, such as `../datasets/my-sequence`, is also accepted.
This is equivalent to staging assets under a demo's Vite public directory, without
copying or linking a potentially large dataset into the repository.

If you prefer the existing demo convention, place or link the dataset at
`apps/showcase/public/assets/my-sequence` and use
`VITE_DEFAULT_MANIFEST_URL=/assets/my-sequence/manifest.json`. Showcase asset/content
directories are ignored by Git.

## Integrate the player

This preview is linked from the workspace rather than published to npm:

```ts
import { GaussianStreamingPlayer } from "@6g-path/gaussian-player";
import { PlayCanvasGaussianRendererAdapter } from "@6g-path/gaussian-renderer-playcanvas";

const renderer = new PlayCanvasGaussianRendererAdapter({
  canvas: document.querySelector("canvas")!,
  graphicsBackend: "webgpu",
  gaussianSort: "auto",
  manageResize: true,
});

const player = await GaussianStreamingPlayer.create({
  manifest: "https://cdn.example.com/performance/manifest.json",
  renderer,
  loop: true,
});

const unsubscribe = player.subscribe((state) => updateUi(state));
await player.play();

// Later:
unsubscribe();
player.dispose();
```

The facade owns manifest loading, sequence selection, renderer setup, static and mesh
loading, compressed caching, buffering, quality policy, audio synchronization,
cancellation, and cleanup. It exposes play/pause, time seek, frame stepping,
automatic/manual quality, volume/mute, subscriptions, and disposal. See the
[integration guide](docs/integration.md).

## Prepare content

4DGS reconstruction is external. A producer can use a suitable reconstruction system,
including [Apple SHARP](https://github.com/apple/ml-sharp) for per-image 3DGS PLY
output, but must establish temporal coherence, registration, and the player transform.
SHARP output uses an OpenCV coordinate convention.

Use quality-LoD RAD as the authoring intermediate, then build delivery assets:

```bash
pnpm gs-content build dataset.json --output-dir dist/content --dry-run
pnpm gs-content build dataset.json --output-dir dist/content
```

The command creates bundled SOG tiers for dynamic frames, Streamed SOG for large static
scenes, byte/splat metadata, and a validated canonical manifest. Existing lower-level
commands remain available for experiments. See
[content preparation](docs/content-preparation.md) and
[CDN/CORS hosting](docs/hosting.md).

## Support tiers

| Path                               | Status                 | Purpose                                               |
| ---------------------------------- | ---------------------- | ----------------------------------------------------- |
| PlayCanvas + SOG v2                | Recommended preview    | WebGPU GPU decode/sort; WebGL2 fallback               |
| Quality-LoD RAD                    | Authoring intermediate | Common LoD source and conversion input                |
| Babylon.js + SPZ v4                | Experimental           | CPU-decoder comparison                                |
| Spark + RAD or flat SPZ            | Experimental           | Diagnostics and research                              |
| SPZ v3; dynamic paged RAD on Quest | Not a production claim | Recorded CPU/tree costs are unsuitable for the target |

SOG is recommended for web delivery; Streamed SOG is intended for large spatial static
scenes. Read [formats and support](docs/formats-and-support.md) and the factual
[performance record](docs/project/PERFORMANCE.md).

## Applications

- `apps/showcase`: polished landing and Quest-oriented public player.
- `apps/demo-playcanvas`: PlayCanvas/SOG diagnostics laboratory.
- `apps/demo-babylon`: Babylon/SPZ diagnostics laboratory.
- `apps/demo`: Spark/RAD diagnostics laboratory.

The diagnostic apps intentionally expose tuning and measurement controls that are not
part of the public showcase. See [experimental demos](docs/experimental-demos.md).

## Workspace commands

```bash
pnpm dev:showcase
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
```

## Documentation

- [Integration](docs/integration.md)
- [Manifest contract](docs/manifest-format.md)
- [Content preparation](docs/content-preparation.md)
- [Hosting and CORS](docs/hosting.md)
- [PlayCanvas settings](docs/playcanvas-renderer-integration.md)
- [Quest and WebXR](docs/quest-webxr.md)
- [Audio](docs/audio.md)
- [Formats and support](docs/formats-and-support.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## License and acknowledgements

MIT licensed. Built by Volograms with support from the 6G-PATH project. Renderer, codec,
and authoring dependencies retain their own licenses; see
[third-party notices](THIRD_PARTY_NOTICES.md).
