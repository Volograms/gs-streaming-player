import { ArrowIcon, GitHubIcon } from "./icons.js";

const githubUrl =
  import.meta.env.VITE_GITHUB_URL?.trim() ||
  "https://github.com/volograms/gs-streaming-player";

const supportRows = [
  ["PlayCanvas + SOG v2", "Recommended preview", "WebGPU · WebGL2 · WebXR"],
  ["PLY / SPZ sources", "Supported authoring", "SOG or SPZ tier generation"],
  ["Babylon.js + SPZ v4", "Experimental", "CPU decode comparison"],
  ["Spark + RAD / SPZ", "Experimental", "Research and diagnostics"],
] as const;

export function LandingPage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Volograms 4DGS home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            Volograms <b>4DGS</b>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#features">Features</a>
          <a href="#formats">Formats</a>
          <a href={`${githubUrl}/blob/main/docs/integration.md`}>Docs</a>
          <a className="nav-github" href={githubUrl}>
            <GitHubIcon /> GitHub
          </a>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-aurora" aria-hidden="true" />
          <div className="hero-copy">
            <span className="eyebrow">
              <i /> Public preview · Source available
            </span>
            <h1 id="hero-title">
              Stream volumetric moments.
              <br />
              <em>Stay inside them.</em>
            </h1>
            <p>
              A renderer-neutral web player for adaptive 4D Gaussian Splat playback,
              built for responsive desktop experiences and immersive WebXR on Quest.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#/demo">
                Open the player <ArrowIcon />
              </a>
              <a className="button button-secondary" href={githubUrl}>
                <GitHubIcon /> Explore the source
              </a>
            </div>
            <p className="hero-note">
              No dataset is bundled. The showcase streams from an external manifest.
            </p>
          </div>
          <div
            className="hero-visual"
            aria-label="Abstract Gaussian Splat sequence visualization"
          >
            <div className="splat-orbit orbit-one" />
            <div className="splat-orbit orbit-two" />
            <div className="splat-figure">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="visual-card">
              <small>Recommended path</small>
              <strong>SOG · WebGPU</strong>
              <span>GPU decode and sort</span>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Player capabilities">
          <span>PLAYCANVAS</span>
          <span>SOG v2</span>
          <span>WEBGPU</span>
          <span>WEBXR</span>
          <span>ADAPTIVE STREAMING</span>
        </section>

        <section className="section" id="features" aria-labelledby="features-title">
          <div className="section-heading">
            <span>Built as a player, not a viewer</span>
            <h2 id="features-title">Video-like delivery for spatial performances.</h2>
            <p>
              The core owns time, buffering, quality and failure recovery. Renderers
              remain replaceable.
            </p>
          </div>
          <div className="feature-grid">
            <article>
              <span className="feature-number">01</span>
              <h3>Temporal buffering</h3>
              <p>
                A bounded rolling window keeps the current frame visible while future
                SOG tiers prepare.
              </p>
            </article>
            <article>
              <span className="feature-number">02</span>
              <h3>Adaptive quality</h3>
              <p>
                Transfer tiers and render budgets respond to measured throughput, buffer
                health and device capacity.
              </p>
            </article>
            <article>
              <span className="feature-number">03</span>
              <h3>Native WebGPU path</h3>
              <p>
                PlayCanvas ingests SOG directly and sorts on the GPU, with an honest
                WebGL2 fallback.
              </p>
            </article>
            <article>
              <span className="feature-number">04</span>
              <h3>WebXR controls</h3>
              <p>
                A room-scale transport surface works with Quest controllers and
                hand-select input.
              </p>
            </article>
          </div>
        </section>

        <section className="pipeline-section" aria-labelledby="pipeline-title">
          <div className="section-heading">
            <span>One explicit content contract</span>
            <h2 id="pipeline-title">From reconstructed splats to the headset.</h2>
          </div>
          <ol className="pipeline">
            <li>
              <b>01</b>
              <span>
                <strong>Reconstruct</strong>
                <small>External 3D/4DGS pipeline</small>
              </span>
            </li>
            <li>
              <b>02</b>
              <span>
                <strong>Build tiers</strong>
                <small>Merge-decimated PLY / SPZ</small>
              </span>
            </li>
            <li>
              <b>03</b>
              <span>
                <strong>Package</strong>
                <small>SOG tiers + streamed scene</small>
              </span>
            </li>
            <li>
              <b>04</b>
              <span>
                <strong>Describe</strong>
                <small>Versioned player manifest</small>
              </span>
            </li>
            <li>
              <b>05</b>
              <span>
                <strong>Stream</strong>
                <small>CDN to WebGPU / WebXR</small>
              </span>
            </li>
          </ol>
          <pre className="command-card">
            <code>
              <span>$</span> pnpm gs-content build dataset.json --output-dir
              public/content
            </code>
          </pre>
        </section>

        <section className="section" id="formats" aria-labelledby="formats-title">
          <div className="section-heading split">
            <div>
              <span>Support is intentionally tiered</span>
              <h2 id="formats-title">
                A clear recommended path, with experiments preserved.
              </h2>
            </div>
            <p>
              SOG is the recommended runtime target. Public authoring starts from PLY or
              SPZ; SPZ output, RAD legacy tools, and renderer comparisons stay available
              for research.
            </p>
          </div>
          <div
            className="support-table"
            role="table"
            aria-label="Format and renderer support"
          >
            {supportRows.map(([path, status, detail]) => (
              <div role="row" key={path}>
                <strong role="cell">{path}</strong>
                <span
                  role="cell"
                  className={status.startsWith("Recommended") ? "recommended" : ""}
                >
                  {status}
                </span>
                <small role="cell">{detail}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="findings" aria-labelledby="findings-title">
          <div>
            <span className="eyebrow">
              <i /> Measured on target hardware
            </span>
            <h2 id="findings-title">The headset’s render budget is the constraint.</h2>
            <p>
              In the recorded Quest 3 configuration, stereo rendering of roughly 500k
              splats approached 20 ms. Streaming and spatial budgets help; foveation and
              resolution tuning remain future measurement work—not promises.
            </p>
            <a href={`${githubUrl}/blob/main/docs/project/PERFORMANCE.md`}>
              Read the performance record <ArrowIcon />
            </a>
          </div>
          <div className="finding-metric">
            <strong>
              ~20<small>ms</small>
            </strong>
            <span>Recorded stereo render time</span>
            <p>≈500k splats · Quest 3 · configuration-specific</p>
          </div>
        </section>

        <section className="cta">
          <div>
            <span>Ready to explore?</span>
            <h2>
              Bring your own manifest.
              <br />
              Step into the sequence.
            </h2>
          </div>
          <a className="button button-light" href="#/demo">
            Launch showcase <ArrowIcon />
          </a>
        </section>
      </main>

      <footer>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            Volograms <b>4DGS</b>
          </span>
        </div>
        <p>
          MIT licensed · Created by Volograms with support from the 6G-PATH project.
        </p>
        <a href={githubUrl}>Source on GitHub</a>
      </footer>
    </div>
  );
}
