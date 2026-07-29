# Adaptive Gaussian Splat Streaming Player

> Public-preview update (2026-07-29): the product surface is now the source-only
> **Volograms 4DGS Streaming Player**, its `GaussianStreamingPlayer` facade, canonical
> manifest, SOG content builder, and Pages showcase. PlayCanvas/SOG is recommended;
> Spark/RAD and Babylon/SPZ are experimental. Later sections preserve the original
> implementation plan as project history. See
> [ADR 0015](architecture/decisions/0015-public-preview-product-surface.md).

## 1. Project Summary

### Project goal

Develop a reusable web player library for playback of composited Gaussian Splat content consisting of:

* one or more persistent static Gaussian Splat objects;
* one dynamic Gaussian Splat sequence, initially represented as one `.RAD` file per frame;
* optional conventional renderer-native meshes;
* local rendering on mobile, tablet and desktop devices;
* temporal buffering similar to a conventional video player;
* progressive per-frame spatial Level of Detail;
* adaptive quality driven by generic client network measurements and buffer state, with optional telemetry providers when actionable end-to-end measurements exist.

Separate renderer-specific demo applications will integrate the library and provide:

* content loading;
* playback controls;
* scene navigation;
* quality controls;
* network simulation;
* diagnostic visualisation;
* optional telemetry-provider integration;
* experiment logging.

### Primary implementation stages

1. **L1 — Content representation and rendering**
2. **L2 — Temporal player and generic adaptive streaming**
3. **L3 — Pilot testbed validation and optional telemetry extensions**

These stages correspond to implementation milestones, while also remaining distinct architectural layers of the final system.

---

# 2. Product Scope

## In scope

* Browser-based TypeScript library.
* Multiple renderer adapters, retaining Spark and adding Babylon.js and PlayCanvas candidates.
* Static `.RAD` objects.
* Dynamic sequence using per-frame `.RAD` objects.
* Optional GLTF/GLB meshes.
* Sequence manifest.
* Playback clock.
* Play, pause, seek, loop and restart.
* Frame buffering and prefetch.
* Progressive frame quality.
* Frame dropping and stall recovery.
* Generic quality controller abstraction.
* Fixed-quality controller.
* Client-measured bandwidth controller.
* Optional telemetry-driven controller when the testbed exposes usable client signals.
* Runtime metrics and experiment logging.
* Dedicated renderer demo applications and optional WebXR entry where supported.
* Mobile browser support.
* Automated testing.
* Example content preparation tools.
* Documentation and integration examples.

## Initially out of scope

* Live capture.
* Real-time SHARP reconstruction.
* Temporal Gaussian compression.
* Delta-coded Gaussian frames.
* Custom replacement for the `.RAD` format.
* Native Android or iOS renderer.
* Multi-user synchronised classroom session control.
* Server-side rendering.
* Edge rendering.
* Product-level VR interaction beyond renderer-provided WebXR entry and navigation.
* Authoring tools for complex scenes.

These can be added later without changing the core player architecture.

---

# 3. High-Level Architecture

```text
Renderer-specific Demo Application
├── Playback UI
├── Scene controls
├── Diagnostics and experiment UI
├── Network simulation
└── Client network measurement and optional telemetry providers
          |
          v
GaussianSequencePlayer
├── Playback clock
├── Timeline and frame selection
├── Temporal buffer
├── Request scheduler
├── Quality controller
├── Metrics collector
└── Renderer abstraction
          |
          ├── Spark adapter: RAD, PackedSplats, Three.js
          ├── Babylon adapter: neutral frames, GaussianSplattingMesh
          └── PlayCanvas adapter: planned SPZ/SOG comparison
          |
          v
HTTP / HTTP Range / 6G testbed with client-visible Wi-Fi last hop
```

---

# 4. Suggested Repository Structure

```text
gaussian-streaming-player/
├── packages/
│   ├── player-core/
│   │   ├── src/
│   │   │   ├── player/
│   │   │   ├── timeline/
│   │   │   ├── buffering/
│   │   │   ├── scheduling/
│   │   │   ├── quality/
│   │   │   ├── network/
│   │   │   ├── metrics/
│   │   │     ├── manifest/
│   │   │   └── events/
│   │   └── tests/
│   │
│   ├── renderer-spark/
│   │   ├── src/
│   │   │   ├── SparkRendererAdapter.ts
│   │   │   ├── SparkFrameSlot.ts
│   │   │   ├── SparkStaticObject.ts
│   │   │   ├── SparkChunkController.ts
│   │   │   └── SparkMetrics.ts
│   │   └── tests/
│   │
│   ├── telemetry-6g/
│   │   ├── src/
│   │   │   ├── SixGTelemetryAdapter.ts
│   │   │   ├── SixGNetworkState.ts
│   │   │   └── MockSixGTelemetryAdapter.ts
│   │   └── tests/
│   │
│   ├── content-tools/
│   │   ├── src/
│   │   │   ├── build-manifest/
│   │   │   ├── validate-sequence/
│   │   │   ├── inspect-rad/
│   │   │   └── measure-quality-levels/
│   │   └── tests/
│   │
│   └── shared/
│       ├── src/
│       └── tests/
│
├── apps/
│   └── demo/
│       ├── src/
│       │   ├── player/
│       │   ├── ui/
│       │   ├── diagnostics/
│       │   ├── experiments/
│       │   └── scenes/
│       └── public/
│
├── examples/
│   ├── minimal-player/
│   ├── static-and-dynamic-scene/
│   └── adaptive-streaming/
│
├── test-data/
│   ├── manifests/
│   ├── mock-rad/
│   └── network-traces/
│
├── docs/
│   ├── architecture.md
│   ├── manifest-format.md
│   ├── player-api.md
│   ├── adaptive-streaming.md
│   ├── sixg-integration.md
│   └── experiments.md
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

A monorepo using `pnpm` workspaces is recommended.

---

# 5. Core Domain Interfaces

These interfaces should be introduced early so that later stages extend rather than replace the initial design.

```ts
export interface GaussianSequenceManifest {
  version: string;
  id: string;
  durationSeconds: number;
  frameRate: number;
  frameCount: number;

  staticObjects: StaticSceneObject[];
  dynamicSequences: DynamicGaussianSequence[];
  meshObjects?: MeshSceneObject[];

  audio?: MediaTrack;
  metadata?: Record<string, unknown>;
}

export interface DynamicGaussianSequence {
  id: string;
  frameCount: number;
  frameRate: number;
  frames: GaussianFrameSource[];
  transform?: Transform;
  priority?: number;
}

export interface GaussianFrameSource {
  frameIndex: number;
  timestampSeconds: number;
  url: string;
  byteSize?: number;
  metadataUrl?: string;
}

export interface NetworkState {
  estimatedThroughputBps: number;
  rttMs?: number;
  packetLossRatio?: number;
  confidence?: number;
  source: "fixed" | "client-measured" | "6g-telemetry" | "simulated";
  timestampMs: number;
}

export interface PlaybackState {
  currentTimeSeconds: number;
  currentFrameIndex: number;
  playbackRate: number;
  isPlaying: boolean;
  bufferAheadSeconds: number;
  minimumReadyFrames: number;
}

export interface QualityDecision {
  renderSplatBudget: number;
  staticObjectWeight: number;
  dynamicObjectWeights: Record<string, number>;
  targetBufferSeconds: number;
  maximumRefinementBytes: number;
  allowStaticRefinement: boolean;
}

export interface QualityController {
  update(
    playback: PlaybackState,
    network: NetworkState,
    metrics: PlayerMetrics,
  ): QualityDecision;
}

export interface GaussianRendererAdapter {
  initialise(): Promise<void>;
  loadStaticObject(object: StaticSceneObject): Promise<void>;
  prepareFrame(
    sequenceId: string,
    frame: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame>;
  presentFrame(frame: PreparedFrame): void;
  releaseFrame(frame: PreparedFrame): void;
  setRenderQuality(decision: QualityDecision): void;
  dispose(): void;
}
```

---

# 6. Epic Overview

| Epic | Name                                         | Stage       |
| ---- | -------------------------------------------- | ----------- |
| E00  | Project Foundation                           | Foundation  |
| E01  | Content and Manifest Pipeline                | L1          |
| E02  | Spark Rendering Integration                  | L1          |
| E03  | Static and Dynamic Scene Composition         | L1          |
| E04  | Demo Application Foundation                  | L1          |
| E05  | Temporal Playback Engine                     | L2          |
| E06  | Frame Buffer and Prefetch Scheduler          | L2          |
| E07  | Generic Adaptive Quality Control             | L2          |
| E08  | Robust Playback and Recovery                 | L2          |
| E09  | Metrics and Experimentation                  | L2          |
| E10  | Optional 6G Telemetry Extension              | L3          |
| E11  | Pilot Client-Measured Quality Controller     | L3          |
| E12  | Testbed and Wi-Fi Evaluation Tools           | L3          |
| E13  | Performance, Mobile and Production Hardening | Cross-stage |
| E14  | Documentation and Release                    | Cross-stage |

---

# 7. Detailed Epics and Tasks

# EPIC E00 — Project Foundation

## Objective

Create a maintainable monorepo, shared tooling and CI pipeline before player development begins.

## Tasks

### E00-T01 — Initialise monorepo

Create:

* `packages/player-core`;
* `packages/renderer-spark`;
* `packages/shared`;
* `packages/content-tools`;
* `packages/telemetry-6g`;
* `apps/demo`.

#### Acceptance criteria

* Workspace dependencies resolve.
* All packages build independently.
* Demo application imports packages through workspace dependencies.
* Root commands exist for build, test, lint and type checking.

---

### E00-T02 — Configure TypeScript

Use strict TypeScript settings.

Required flags should include:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true
}
```

#### Acceptance criteria

* No package relies on implicit `any`.
* Shared types do not depend on browser-only APIs unless explicitly required.
* Core player types compile independently from Spark.

---

### E00-T03 — Configure linting and formatting

Configure ESLint, Prettier and import ordering.

#### Acceptance criteria

* CI rejects lint errors.
* Formatting can be applied from the root.
* Generated files are excluded.

---

### E00-T04 — Configure unit testing

Use Vitest.

#### Acceptance criteria

* Each package has a test configuration.
* Tests can be run per package and from the root.
* Browser-specific tests use a suitable DOM environment only where necessary.

---

### E00-T05 — Configure browser integration testing

Use Playwright.

#### Acceptance criteria

* Demo application starts in CI.
* Chromium integration test can load the demo.
* Test framework can emulate network throttling.
* Screenshots and traces are saved after failure.

---

### E00-T06 — Configure CI

CI stages:

1. dependency installation;
2. type checking;
3. linting;
4. unit tests;
5. package builds;
6. demo build;
7. Playwright smoke tests.

---

### E00-T07 — Add architecture decision records

Create ADRs for:

* monorepo choice;
* renderer abstraction;
* `.RAD` per-frame baseline;
* quality controller abstraction;
* sequence manifest ownership;
* network telemetry abstraction.

---

# EPIC E01 — Content and Manifest Pipeline

## Objective

Define and validate the content format required by both the player library and demo application.

## Tasks

### E01-T01 — Define sequence manifest schema

The manifest must describe:

* static `.RAD` objects;
* dynamic GS sequences;
* frame rate;
* frame timestamps;
* per-frame URLs;
* object transforms;
* optional meshes;
* optional audio;
* content version;
* optional expected byte sizes;
* optional precomputed quality metadata.

#### Acceptance criteria

* JSON Schema is provided.
* TypeScript types are generated or verified against the schema.
* Invalid manifests return actionable validation errors.
* Manifest versions are explicit.

---

### E01-T02 — Implement manifest loader

Support:

* URL;
* already parsed object;
* `File`;
* `Blob`.

#### Acceptance criteria

* Relative asset URLs resolve relative to the manifest URL.
* Loading is cancellable.
* Parse and network errors are distinct.
* Manifest validation runs before player initialisation.

---

### E01-T03 — Implement manifest validator CLI

Example:

```bash
pnpm gs-manifest validate ./content/lesson.json
```

#### Acceptance criteria

* Returns non-zero status for invalid content.
* Reports exact JSON path for each error.
* Checks frame count consistency.
* Checks monotonically increasing timestamps.
* Optionally verifies referenced files exist.

---

### E01-T04 — Implement manifest generator

Input:

* static scene paths;
* frame file pattern;
* frame rate;
* optional mesh and audio paths.

Example:

```bash
pnpm gs-manifest create \
  --static classroom.rad \
  --frames "person/frame_%05d.rad" \
  --fps 30 \
  --output lesson.json
```

---

### E01-T05 — Add content inspection report

Generate:

* number of frames;
* total sequence bytes;
* average frame bytes;
* minimum and maximum frame size;
* static content size;
* estimated Mbps at source frame rate;
* missing frame list.

---

### E01-T06 — Prepare minimal test dataset

Create or include references to:

* one small static `.RAD`;
* ten dynamic `.RAD` frames;
* one GLB mesh;
* one sequence manifest;
* optional short audio track.

The dataset must be small enough for automated tests.

---

# EPIC E02 — Spark Rendering Integration

## Objective

Create a reusable Spark renderer adapter without placing Spark-specific assumptions into the core player.

## Tasks

### E02-T01 — Define renderer adapter API

The API must support:

* renderer initialisation;
* loading static GS objects;
* preparing dynamic frames;
* presenting a prepared frame;
* hiding and releasing frames;
* loading meshes;
* setting render-quality parameters;
* reporting renderer metrics;
* disposal.

---

### E02-T02 — Implement Spark renderer initialisation

Create:

* Three.js renderer;
* scene;
* camera;
* Spark renderer;
* resize handling;
* render loop integration.

#### Acceptance criteria

* Renderer works with a caller-owned canvas.
* Renderer can use a caller-owned Three.js scene.
* Library does not require the demo application to surrender scene ownership.
* Renderer can be cleanly disposed.

---

### E02-T03 — Load static `.RAD` objects

#### Acceptance criteria

* Multiple static GS objects can be loaded.
* Object transforms are applied.
* Visibility can be toggled.
* Loading progress is exposed.
* Failure of one object does not corrupt renderer state.

---

### E02-T04 — Load conventional meshes

Support GLTF/GLB objects through Three.js.

#### Acceptance criteria

* Mesh transforms follow the same coordinate convention as GS objects.
* Meshes coexist correctly with splats.
* Visibility and disposal work.
* Demo content can include at least one mesh.

---

### E02-T05 — Implement dynamic frame representation

Introduce `SparkFrameSlot`.

Each slot owns or references:

* one current frame source;
* one Spark `SplatMesh` or equivalent;
* loading state;
* readiness state;
* quality state;
* visibility state;
* cancellation handle.

---

### E02-T06 — Implement manual dynamic frame switching

#### Acceptance criteria

* A caller can request any frame by index.
* The renderer can show exactly one active dynamic frame.
* Previous frames are hidden or released.
* Switching does not recreate the entire Three.js scene.
* Frame changes do not leak GPU resources.

---

### E02-T07 — Expose Spark LoD controls

Expose through the adapter:

* global splat budget;
* per-object LoD weight;
* static-scene weight;
* dynamic-sequence weight;
* foveation parameters;
* optional SH limits where supported.

#### Acceptance criteria

* Demo application can manipulate LoD interactively.
* Static and dynamic content can be weighted independently.
* Current effective configuration can be read back.

---

### E02-T08 — Add renderer metrics

Collect:

* rendered splat count;
* loaded static objects;
* active dynamic frame;
* GPU page count where available;
* frame time;
* render FPS;
* resource load state.

---

# EPIC E03 — Static and Dynamic Scene Composition

## Objective

Prove that the target content composition works before implementing a temporal player.

## Tasks

### E03-T01 — Compose static GS, dynamic GS and mesh objects

#### Acceptance criteria

* Static room remains persistent.
* Person frame can be replaced independently.
* Mesh remains persistent.
* All object transforms are correct.
* Camera navigation works.

---

### E03-T02 — Define coordinate-system conventions

Document:

* axis directions;
* handedness;
* metres versus arbitrary units;
* person origin;
* static-scene origin;
* mesh transforms;
* SHARP conversion assumptions.

---

### E03-T03 — Implement content alignment configuration

Allow per-object:

* translation;
* rotation;
* scale;
* optional matrix override.

---

### E03-T04 — Validate alpha and masking behaviour

#### Acceptance criteria

* Background splats from the person sequence are removed or transparent.
* Dynamic person composites correctly into the static environment.
* No persistent frame residue remains after switching.

---

### E03-T05 — Measure dynamic switching performance

Measure:

* frame preparation time;
* frame swap time;
* GPU upload time;
* memory growth over repeated switching;
* maximum stable switching rate.

---

### E03-T06 — Produce Stage L1 technical report

Document:

* target devices tested;
* supported scene complexity;
* acceptable person splat count;
* static splat budget;
* observed visual issues;
* estimated sequence bandwidth;
* unresolved Spark integration risks.

---

# EPIC E04 — Demo Application Foundation

## Objective

Create a clean reference application that demonstrates library integration without embedding player logic into the UI.

## Tasks

### E04-T01 — Create application shell

Include:

* viewer area;
* playback panel;
* scene panel;
* quality panel;
* diagnostics panel;
* content selector.

---

### E04-T02 — Implement manifest loading UI

Support:

* predefined content;
* manifest URL;
* local manifest file;
* drag and drop.

---

### E04-T03 — Implement manual frame inspector

Controls:

* frame index;
* previous and next;
* jump to frame;
* frame timestamp;
* current frame URL.

---

### E04-T04 — Implement LoD controls

Controls:

* global splat budget;
* person LoD weight;
* static LoD weight;
* foveation;
* automatic/manual quality mode.

---

### E04-T05 — Add diagnostics overlay

Display:

* FPS;
* frame time;
* current frame;
* visible objects;
* loaded frames;
* static/dynamic LoD settings;
* current network state;
* downloaded bytes.

---

### E04-T06 — Keep demo application decoupled

#### Acceptance criteria

* No playback state machine is implemented inside React components.
* UI calls public player APIs only.
* Player can run without React.
* A minimal non-React example is possible.

---

# EPIC E05 — Temporal Playback Engine

## Objective

Turn manual frame switching into a reusable volumetric sequence player.

## Tasks

### E05-T01 — Implement player state machine

States:

```text
IDLE
LOADING
READY
PLAYING
PAUSED
BUFFERING
SEEKING
ENDED
ERROR
CLOSED
```

#### Acceptance criteria

* All state transitions are explicit.
* Invalid transitions are rejected or ignored consistently.
* State changes emit events.
* State is testable without a renderer.

---

### E05-T02 — Implement playback clock abstraction

Provide:

* monotonic clock;
* media-element clock;
* test clock;
* manual clock.

#### Acceptance criteria

* Unit tests can deterministically advance time.
* Audio can later become the master clock.
* Player does not depend directly on `requestAnimationFrame` for timeline correctness.

---

### E05-T03 — Implement frame selection

For constant frame rate:

```text
frameIndex = floor(currentTimeSeconds * frameRate)
```

Also support explicit per-frame timestamps from the manifest.

---

### E05-T04 — Implement play, pause, restart and loop

---

### E05-T05 — Implement seek

#### Acceptance criteria

* Obsolete frame requests are cancelled.
* Buffer is re-centred around the target frame.
* The requested frame is shown at minimum viable quality before playback resumes.
* Seeking outside the valid range is clamped or rejected consistently.

---

### E05-T06 — Implement playback-rate support

Initial supported range:

```text
0.5x to 2.0x
```

Playback-rate changes must influence buffer demand and frame deadlines.

---

### E05-T07 — Implement player event model

Events should include:

* `statechange`;
* `play`;
* `pause`;
* `seeking`;
* `seeked`;
* `bufferingstart`;
* `bufferingend`;
* `framepresented`;
* `framedropped`;
* `qualitychange`;
* `ended`;
* `error`;
* `metrics`.

---

### E05-T08 — Integrate optional audio clock

#### Acceptance criteria

* Audio can act as playback master.
* GS playback follows media time.
* Late GS frames are skipped rather than slowing audio.
* Pausing and seeking remain synchronised.

---

# EPIC E06 — Frame Buffer and Prefetch Scheduler

## Objective

Implement video-style temporal buffering while recognising that each frame can have multiple spatial quality levels.

## Tasks

### E06-T01 — Define buffered frame state

```ts
interface BufferedFrame {
  frameIndex: number;
  timestampSeconds: number;
  deadlineMs: number;

  status:
    | "empty"
    | "loading-base"
    | "base-ready"
    | "refining"
    | "ready"
    | "presented"
    | "expired"
    | "failed";

  downloadedBytes: number;
  requestedBytes: number;
  qualityLevel: number;
  targetQualityLevel: number;
}
```

---

### E06-T02 — Implement frame ring buffer

Initial configuration:

* one presented slot;
* two or three future slots;
* one reusable previous/spare slot.

Make the number configurable.

---

### E06-T03 — Define minimum viable frame quality

A frame is playable when:

* the selected flat dynamic quality-tier asset is decoded and uploaded;
* required metadata is parsed;
* the renderer can present it without waiting for refinements.

Enhancement data must not block playback.

Implementation revision (2026-07-16): dynamic quality-LoD RAD files are content-pipeline
inputs. An offline tool extracts valid camera-independent tree frontiers and writes each
as a flat SPZ tier. Runtime dynamic playback selects one complete tier from network,
deadline, and buffer state and loads it without Spark LoD traversal. Static RAD scenes
continue using camera-aware paged LoD.

---

### E06-T04 — Implement prefetch scheduling

Priority order:

1. minimum quality for the next missing frame;
2. minimum quality for the remaining target buffer;
3. refinement for the next frame;
4. refinement for later buffered frames;
5. refinement for the presented frame;
6. static-scene refinement.

---

### E06-T05 — Implement deadline tracking

Each request receives:

* frame deadline;
* temporal distance;
* minimum-quality flag;
* object priority;
* estimated byte cost.

---

### E06-T06 — Implement cancellation

#### Acceptance criteria

* Requests for expired frames are aborted.
* Obsolete seek requests are aborted.
* Refinement requests can be cancelled independently from base-quality requests.
* Cancellation does not put Spark into an invalid state.
* Cancelled requests are reported separately from failures.

This may require a Spark wrapper or a small upstream-compatible Spark modification to expose `AbortSignal` support.

---

### E06-T07 — Implement frame dropping

Drop a frame when:

* its presentation deadline has passed;
* the player has a later playable frame;
* waiting would increase playback latency or break audio synchronisation.

Record the reason for every dropped frame.

---

### E06-T08 — Implement buffering policy

Enter `BUFFERING` only when the minimum playable quality of the required frame is unavailable.

Do not enter `BUFFERING` because refinement is incomplete.

---

### E06-T09 — Implement memory and frame eviction policy

Eviction order:

1. expired frames;
2. frames behind the playback head;
3. far-future refinement;
4. far-future base frames beyond target buffer;
5. static refinement pages if necessary.

---

# EPIC E07 — Generic Adaptive Quality Control

## Objective

Create policy-based quality control before integrating the 6G testbed.

## Tasks

### E07-T01 — Implement `QualityController` interface

The player must depend on this abstraction rather than on a specific network estimator.

---

### E07-T02 — Implement fixed-quality controller

Configuration:

* fixed global splat budget;
* fixed static weight;
* fixed person weight;
* fixed target buffer;
* fixed refinement level.

This is the deterministic baseline.

---

### E07-T03 — Implement simulated-network controller

Inputs:

* configured throughput;
* configured RTT;
* packet-loss simulation;
* bandwidth trace file.

This controller is needed before the 6G testbed is available.

---

### E07-T04 — Implement client throughput estimator

Measure:

* downloaded bytes;
* transfer duration;
* recent throughput;
* smoothed throughput;
* variance;
* confidence.

Use multiple time windows rather than a single most recent request.

---

### E07-T05 — Implement buffer-aware adaptive controller

Inputs:

* estimated throughput;
* buffer occupancy;
* render FPS;
* frame byte estimates;
* time until next deadline.

Outputs:

* target dynamic quality;
* target static quality;
* target buffer length;
* render splat budget.

---

### E07-T06 — Add conservative safety margin

Example:

```text
safeThroughput = estimatedThroughput × safetyFactor
```

Make the safety factor configurable and measurable.

---

### E07-T07 — Add hysteresis

Prevent rapid oscillation between quality levels.

Quality should rise slowly and fall quickly when buffer risk increases.

---

### E07-T08 — Separate transfer and rendering quality

Do not assume that all downloaded splats should be rendered.

The controller must distinguish:

* available network quality;
* resident frame quality;
* target rendering splat budget;
* device rendering capability.

For dynamic sequences, transfer quality selects a concrete flat SPZ tier URL from the
frame manifest. Rendering quality may still cap the number of resident splats drawn, but
must not reconstruct or traverse a camera-dependent LoD tree. Static-scene transfer and
render LoD remain independently controlled.

---

### E07-T09 — Implement device capability profile

Inputs may include:

* mobile or desktop;
* measured render FPS;
* GPU/vendor information where available;
* maximum tested splat budget;
* display resolution.

---

### E07-T10 — Define adaptive-controller baselines

Required baseline policies:

1. fixed low quality;
2. fixed high quality;
3. throughput-only adaptive;
4. throughput plus buffer occupancy;
5. optional later: telemetry-assisted when actionable end-to-end signals exist.

---

# EPIC E08 — Robust Playback and Recovery

## Objective

Make the player stable under network variability, content errors and mobile-browser lifecycle changes.

## Tasks

### E08-T01 — Handle missing frame assets

Policy options:

* repeat previous frame;
* skip missing frame;
* stop with error.

Default to skip and report.

---

### E08-T02 — Handle corrupt `.RAD` frames

#### Acceptance criteria

* Corrupt frame does not terminate the entire scene unless configured.
* Player can continue to later frames.
* Error includes sequence ID and frame index.

---

### E08-T03 — Implement network retry policy

Retries must consider deadlines.

Do not retry a frame after it has become obsolete.

---

### E08-T04 — Handle browser visibility changes

When the page is hidden:

* pause or reduce prefetch;
* avoid accumulating timeline drift;
* restore correctly when visible.

---

### E08-T05 — Handle mobile context loss

Detect WebGL context loss and attempt renderer restoration.

---

### E08-T06 — Handle resize and orientation changes

---

### E08-T07 — Implement resource cleanup

Verify cleanup of:

* event listeners;
* fetch requests;
* Spark objects;
* Three.js meshes;
* textures;
* GPU buffers;
* timers;
* workers.

---

### E08-T08 — Add long-playback soak tests

Tests:

* repeated loops;
* repeated seeks;
* quality changes;
* simulated bandwidth changes;
* one-hour playback where practical.

---

# EPIC E09 — Metrics and Experimentation

## Objective

Collect consistent data for engineering analysis and research evaluation.

## Tasks

### E09-T01 — Define metrics schema

Categories:

#### Playback

* current frame;
* frames presented;
* frames dropped;
* playback stalls;
* total stall duration;
* seek duration;
* buffer occupancy.

#### Network

* requested bytes;
* downloaded bytes;
* cancelled bytes;
* throughput estimate;
* RTT;
* packet loss;
* active request count.

#### Quality

* current dynamic quality;
* current static quality;
* rendered splat budget;
* resident chunks/pages;
* requested refinements;
* quality-switch count.

#### Rendering

* render FPS;
* frame time;
* active splat count;
* memory estimate;
* GPU page usage where available.

---

### E09-T02 — Implement metrics collector

Metrics must be available:

* as current snapshot;
* as time series;
* through events;
* for JSON export.

---

### E09-T03 — Implement experiment session

An experiment session records:

* content manifest;
* player version;
* device information;
* browser information;
* controller configuration;
* network source;
* timestamps;
* metrics samples;
* errors.

---

### E09-T04 — Add CSV and JSON export

---

### E09-T05 — Add demo charts

Charts:

* throughput over time;
* buffer occupancy;
* dynamic quality;
* static quality;
* rendered splat count;
* frame drops;
* stalls.

Charts should be optional and isolated from the player library.

---

### E09-T06 — Add reproducible network traces

Support importing a trace such as:

```json
[
  { "timeMs": 0, "throughputBps": 40000000, "rttMs": 12 },
  { "timeMs": 5000, "throughputBps": 8000000, "rttMs": 40 }
]
```

---

# EPIC E10 — Optional 6G Telemetry Extension

## Objective

Retain a vendor-neutral telemetry extension without making it a pilot dependency. The
pilot's Wi-Fi last hop exposes no actionable 6G-specific state to the web client, so
implementation beyond the existing provider boundary is deferred.

## Tasks

### E10-T01 — Define telemetry provider interface

```ts
export interface NetworkTelemetryProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  getCurrentState(): NetworkState;
  subscribe(listener: (state: NetworkState) => void): () => void;
}
```

---

### E10-T02 — Implement mock telemetry provider

Must support:

* fixed network state;
* manually controlled state;
* trace playback;
* random fluctuations.

---

### E10-T03 — Document required testbed signals

Determine availability of:

* current throughput;
* predicted short-term throughput;
* RTT;
* packet loss;
* QoS or slice identifier;
* allocated bitrate;
* congestion state;
* handover state;
* signal quality;
* telemetry update frequency.

---

### E10-T04 — Implement testbed API client

Transport may be:

* WebSocket;
* server-sent events;
* HTTP polling;
* local bridge API.

The player must not depend directly on the transport.

---

### E10-T05 — Implement telemetry normalisation

Map testbed-specific fields into `NetworkState`.

---

### E10-T06 — Handle stale telemetry

Telemetry state must include:

* age;
* source;
* confidence;
* stale flag.

Fallback to client measurement when telemetry becomes stale.

---

### E10-T07 — Add telemetry diagnostics UI

Display:

* raw telemetry;
* normalised telemetry;
* last update time;
* confidence;
* active controller source.

---

# EPIC E11 — Pilot Client-Measured Quality Controller

## Objective

Calibrate ordinary application-level throughput and buffer-aware adaptation for the
sub-500-Mbps testbed-plus-Wi-Fi path.

## Tasks

### E11-T01 — Calibrate the client-measured controller

Inputs:

* client throughput measurement;
* buffer occupancy;
* frame deadlines;
* frame byte estimates;
* device rendering state.

---

### E11-T02 — Implement byte-budget calculation

For each scheduling interval calculate:

```text
safe available bytes
= predicted throughput
× scheduling horizon
× confidence adjustment
× safety margin
```

---

### E11-T03 — Allocate budget across temporal frames

Prioritise minimum quality before refinement.

---

### E11-T04 — Allocate budget across scene objects

Suggested order:

1. dynamic person minimum quality;
2. future dynamic person frames;
3. dynamic person refinements;
4. educationally important meshes or objects;
5. static environment refinements.

---

### E11-T05 — Implement static-versus-dynamic weighting

The controller must be able to reduce static quality while preserving dynamic-person quality during constrained periods.

---

### E11-T06 — Validate buffer-aware adaptation

Compare:

* reactive throughput adaptation;
* throughput plus compressed-buffer occupancy and stall risk.

---

### E11-T07 — Implement telemetry fallback

Fallback chain for the pilot:

```text
client measurement
→ conservative fixed policy
```

---

### E11-T08 — Add controller decision logging

Every quality decision must record:

* input state;
* output decision;
* selected policy;
* limiting constraint;
* expected bytes;
* actual bytes;
* buffer risk.

---

# EPIC E12 — Testbed and Wi-Fi Evaluation Tools

## Objective

Provide reproducible experiments for client-measured adaptation over the 6G testbed's
Wi-Fi last hop. Results must not attribute ordinary fetch-speed estimates to 6G
telemetry.

## Tasks

### E12-T01 — Define evaluation scenarios

Examples:

1. stable high throughput;
2. stable constrained throughput;
3. sudden bandwidth reduction;
4. sudden bandwidth recovery;
5. latency increase;
6. packet loss;
7. mobility or handover event;
8. multiple simultaneous students;
9. different mobile-device capabilities.

---

### E12-T02 — Define comparison methods

Compare:

* fixed low quality;
* fixed high quality;
* client throughput adaptation;
* buffer-aware client adaptation;
* buffer-aware client adaptation with calibrated safety margin and hysteresis.

---

### E12-T03 — Define primary KPIs

Primary:

* stall count;
* total stall duration;
* dropped-frame ratio;
* average dynamic-person quality;
* minimum dynamic-person quality;
* quality-switch frequency;
* bandwidth utilisation;
* wasted/cancelled bytes;
* time to quality recovery.

Secondary:

* render FPS;
* static-scene quality;
* memory usage;
* startup delay;
* seek delay.

---

### E12-T04 — Add automated experiment runner

Configuration example:

```json
{
  "content": "lesson-01.json",
  "controller": "client-buffer-aware",
  "durationSeconds": 120,
  "repeatCount": 5,
  "networkScenario": "handover-01",
  "deviceProfile": "android-midrange"
}
```

---

### E12-T05 — Add experiment result aggregation

Compute:

* mean;
* median;
* standard deviation;
* percentiles;
* per-run outliers.

---

### E12-T06 — Add session synchronisation metadata

For classroom experiments, record:

* student/client identifier;
* experiment start time;
* content version;
* testbed scenario ID;
* available testbed scenario metadata, explicitly distinguished from client telemetry.

---

# EPIC E13 — Performance, Mobile and Production Hardening

## Objective

Ensure the library performs reliably on target classroom devices.

## Tasks

### E13-T01 — Define target device matrix

At minimum:

* desktop Chrome;
* Android Chrome high-end;
* Android Chrome mid-range;
* tablet browser;
* optional iOS Safari subject to Spark support.

---

### E13-T02 — Benchmark renderer budgets

Determine per device:

* recommended splat budget;
* maximum stable splat budget;
* memory threshold;
* static/dynamic weighting;
* maximum sequence frame rate.

---

### E13-T03 — Optimise frame-slot reuse

Avoid:

* repeated allocation;
* repeated renderer setup;
* unnecessary scene graph modifications;
* retained references to expired frames.

---

### E13-T04 — Optimise request concurrency

Make configurable:

* total concurrent requests;
* base-frame request concurrency;
* refinement concurrency;
* static refinement concurrency.

---

### E13-T05 — Add HTTP/2 and HTTP/3 deployment guidance

Document:

* Range support;
* CORS headers;
* cache control;
* MIME types;
* CDN considerations;
* local testbed server configuration.

---

### E13-T06 — Add service worker caching experiment

Optional investigation:

* cache static scene;
* cache manifest;
* cache recently used person frames;
* avoid caching obsolete refinement data unless beneficial.

---

### E13-T07 — Add package-size monitoring

---

### E13-T08 — Add API compatibility policy

Use semantic versioning.

---

# EPIC E14 — Documentation and Release

## Objective

Make the player usable by another developer without reading its internal source.

## Tasks

### E14-T01 — Write quick-start guide

Include:

* installation;
* manifest creation;
* basic player initialisation;
* attaching the Spark renderer;
* loading content;
* playback controls.

---

### E14-T02 — Document public API

---

### E14-T03 — Document manifest format

---

### E14-T04 — Document custom quality controllers

---

### E14-T05 — Document pilot client measurement and optional telemetry extensions

---

### E14-T06 — Add minimal examples

Required:

1. static `.RAD` viewer;
2. static plus dynamic frame switching;
3. complete temporal player;
4. generic adaptive streaming;
5. client-measured testbed adaptation and the optional telemetry-provider boundary.

---

### E14-T07 — Prepare package publishing

Potential packages:

```text
@6g-path/gaussian-player
@6g-path/gaussian-renderer-spark
@6g-path/gaussian-telemetry-6g
@6g-path/gaussian-content-tools
```

---

# 8. Implementation Milestones

# Milestone M0 — Repository Ready

Includes:

* E00 completed;
* base CI passing;
* initial architecture documentation.

### Exit criteria

* Monorepo builds.
* Demo application launches.
* Core package has no Spark dependency.
* Renderer adapter interface exists.

---

# Milestone M1 — L1 Static Scene

Includes:

* static `.RAD` loading;
* mesh loading;
* demo scene;
* LoD controls.

### Exit criteria

* Static `.RAD` and GLB render together.
* Mobile browser can navigate the scene.
* LoD budget can be changed interactively.

---

# Milestone M2 — L1 Dynamic Frames

Includes:

* dynamic frame slots;
* manual frame switching;
* static/dynamic composition;
* content manifest;
* alignment tools.

### Exit criteria

* Short person sequence can be stepped manually.
* No visible resource leak after repeated switching.
* Static scene remains resident.
* Person quality can be weighted independently.

---

# Milestone M3 — L2 Temporal Player

Includes:

* playback state machine;
* playback clock;
* play/pause/seek;
* ring buffer;
* frame prefetch;
* minimum viable frame readiness.

### Exit criteria

* Sequence plays at configured frame rate.
* Player can pause and seek.
* Buffering state is correct.
* Dynamic sequence can play from a normal HTTP server.

---

# Milestone M4 — L2 Generic Adaptation

Includes:

* fixed quality;
* simulated network;
* client throughput measurement;
* buffer-aware quality control;
* cancellation;
* frame dropping.

### Exit criteria

* Playback remains continuous under configured bandwidth changes where minimum quality is feasible.
* Quality decreases before a stall where possible.
* Quality recovers after bandwidth recovery.
* Metrics show all decisions and frame outcomes.

---

# Milestone M5 — L3 6G Telemetry

Includes:

* telemetry provider;
* testbed adapter;
* telemetry diagnostics;
* fallback behaviour.

### Exit criteria

* Real testbed values are received by the player.
* Stale telemetry is detected.
* Player can switch between telemetry and client measurement.

---

# Milestone M6 — L3 6G-Assisted Adaptation

Includes:

* telemetry-assisted controller;
* byte-budget allocation;
* static/dynamic prioritisation;
* experimental logging.

### Exit criteria

* Player quality responds to testbed-provided capacity.
* Person minimum quality is prioritised.
* Testbed policy can be compared with client-only adaptation.

---

# Milestone M7 — Evaluation and Release

Includes:

* experiment runner;
* KPI export;
* mobile hardening;
* documentation;
* versioned package release.

---

# 9. Task Dependency Summary

```text
E00 Project Foundation
 ├── E01 Content and Manifest
 ├── E02 Spark Rendering
 │    └── E03 Scene Composition
 │         └── E04 Demo Foundation
 │
 └── E05 Temporal Playback
      └── E06 Buffer and Scheduler
           ├── E07 Generic Adaptation
           ├── E08 Robust Playback
           └── E09 Metrics
                └── E10 6G Telemetry
                     └── E11 6G Controller
                          └── E12 Evaluation
```

E13 and E14 span all stages but should not block early prototypes.

---

# 10. Recommended Codex Implementation Order

Codex should implement tasks in this order:

1. E00-T01 to E00-T07.
2. E01-T01 to E01-T03.
3. E02-T01 to E02-T04.
4. E03-T01 and E04-T01.
5. E02-T05 to E02-T08.
6. E03-T02 to E03-T06.
7. E04-T02 to E04-T06.
8. E05-T01 to E05-T07.
9. E06-T01 to E06-T05.
10. E05-T08.
11. E06-T06 to E06-T09.
12. E07-T01 to E07-T10.
13. E08 and E09.
14. E10.
15. E11.
16. E12.
17. E13 and E14 hardening.

Do not begin 6G API integration before the generic adaptive controller and telemetry abstraction exist.

---

# 11. Codex Implementation Rules

## Architectural rules

1. `player-core` must not import Spark.
2. React must not be required by the player packages.
3. The demo application must use public APIs only.
4. Network telemetry must enter through `NetworkTelemetryProvider`.
5. Adaptation logic must enter through `QualityController`.
6. Rendering must enter through `GaussianRendererAdapter`.
7. Playback time must not be owned by the renderer.
8. Missing refinement data must not automatically cause buffering.
9. Minimum viable frame quality and full frame quality must remain distinct.
10. Static and dynamic scene quality must remain independently controllable.

## Engineering rules

1. All asynchronous operations must support cancellation where practical.
2. Every owned resource must have explicit disposal.
3. Every player state transition must be testable.
4. Do not store mutable playback state in React components.
5. Do not implement testbed-specific fields in the core player.
6. Do not optimise temporal compression in the first implementation.
7. Do not fork Spark unless the required capability cannot be exposed through a small wrapper or upstream-compatible patch.
8. Record metrics before optimising.
9. Prefer deterministic unit tests with a simulated clock.
10. Keep initial implementation compatible with normal HTTP infrastructure.

---

# 12. Definition of Done

A task is complete when:

* implementation is merged;
* public APIs are typed;
* unit tests cover expected and failure behaviour;
* integration tests exist where appropriate;
* documentation is updated;
* no known resource leaks are introduced;
* metrics are added for new runtime behaviour;
* acceptance criteria are demonstrated in the demo application or automated tests.

---

# 13. Initial Research Questions

The implementation should produce evidence for the following questions:

1. Can independent `.RAD` person frames be swapped at the required playback rate on mobile devices?
2. What is the minimum viable `.RAD` quality required for an acceptable human representation?
3. How much `.RAD` refinement can be delivered within each video-frame interval?
4. How accurately can completed browser fetches estimate capacity across the testbed's Wi-Fi last hop?
5. Does buffer-aware client adaptation improve average dynamic-person quality at the same stall rate?
6. How much bandwidth is wasted on refinement chunks that arrive after their useful deadline?
7. Does prioritising the person over the static environment improve perceived quality?
8. What buffer size provides the best balance between latency, quality and resilience?
9. How quickly can quality recover after network capacity increases?
10. At what point does independent-frame `.RAD` bandwidth become large enough to justify temporal Gaussian compression?

---

# 14. Potential Follow-On Epics

These are deliberately excluded from the initial implementation.

## F01 — Multi-frame `.RAD` sequence container

* single sequence index;
* reduced per-frame metadata requests;
* range-addressable frame chunks;
* shared metadata.

## F02 — Temporal Gaussian compression

* keyframes;
* inter-frame Gaussian correspondence;
* delta positions;
* delta colour and opacity;
* GOP structure.

## F03 — Multi-student delivery

* shared base layer;
* per-client refinements;
* fairness controller;
* multicast or broadcast experiments.

## F04 — Live classroom presenter capture

* real-time segmentation;
* GS reconstruction;
* frame encoding;
* edge processing;
* end-to-end latency control.

## F05 — Native mobile renderer

* common manifest and controller;
* native networking;
* native GPU rendering;
* shared Rust decoder core.
