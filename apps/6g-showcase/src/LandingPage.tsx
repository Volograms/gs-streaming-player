import volumetricStudy from "./assets/volumetric-study.png";
import { BuildCommand } from "./BuildCommand.js";
import { ArrowIcon, GitHubIcon } from "./icons.js";
import "./landing.css";

const githubUrl =
  import.meta.env.VITE_GITHUB_URL?.trim() ||
  "https://github.com/volograms/gs-streaming-player";
const docsUrl = `${githubUrl}/blob/main/docs`;
const features = [
  {
    title: "Continuous playback",
    description:
      "A rolling frame buffer prepares what comes next, with familiar play, pause, and seek controls.",
  },
  {
    title: "Quality that adapts",
    description:
      "The player balances detail with measured bandwidth, buffer health, and the device’s rendering budget.",
  },
  {
    title: "Built for the browser",
    description:
      "PlayCanvas renders SOG content through WebGPU, with a WebGL2 fallback for wider compatibility.",
  },
  {
    title: "A sense of presence",
    description:
      "Explore in immersive WebXR on Quest, with controller and hand interactions for playback.",
  },
];
const workflow = [
  {
    title: "Prepare your sequence",
    description:
      "Start with registered PLY or SPZ frames. Build quality tiers and a compact playback manifest.",
  },
  {
    title: "Host your content",
    description:
      "Publish the dataset on an HTTPS server or CDN with cross-origin access enabled.",
  },
  {
    title: "Press play",
    description:
      "Open the manifest in the player, or integrate the library into your own application.",
  },
];
const supportRows = [
  {
    name: "PlayCanvas + SOG v2",
    status: "Recommended",
    detail: "WebGPU, WebGL2, and WebXR playback",
    recommended: true,
  },
  {
    name: "PLY / SPZ sources",
    status: "Supported",
    detail: "Content preparation and quality-tier generation",
  },
  {
    name: "Babylon.js + SPZ v4",
    status: "Experimental",
    detail: "Alternative renderer and CPU decode research",
  },
  {
    name: "Spark + RAD / SPZ",
    status: "Experimental",
    detail: "Renderer comparisons and diagnostics",
  },
];

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        Volograms <b>4DGS</b>
      </span>
    </span>
  );
}

export function LandingPage() {
  return (
    <div className="landing-page">
      <a className="landing-skip" href="#main-content">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-container landing-nav">
          <a href="#/" aria-label="Volograms 4DGS home">
            <Brand />
          </a>
          <nav aria-label="Primary navigation">
            <a className="landing-nav-section" href="#features">
              Features
            </a>
            <a className="landing-nav-section" href="#workflow">
              Workflow
            </a>
            <a className="landing-nav-section" href={`${docsUrl}/integration.md`}>
              Documentation
            </a>
            <a
              className="landing-source"
              href={githubUrl}
              aria-label="Source on GitHub"
            >
              <GitHubIcon />
              <span>GitHub</span>
            </a>
            <a className="landing-nav-player" href="#/demo">
              Launch player <ArrowIcon />
            </a>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        <section
          className="landing-container landing-hero"
          aria-labelledby="hero-title"
        >
          <div className="landing-hero-copy">
            <div className="landing-release">
              <span>Public preview</span> Open source · MIT licensed
            </div>
            <h1 id="hero-title">
              Volumetric video.<span>Built for the web.</span>
            </h1>
            <p className="landing-intro">
              Bring spatial performances to the browser with adaptive 4D Gaussian Splat
              playback. From your desktop to an immersive headset.
            </p>
            <div className="landing-actions">
              <a className="landing-button landing-button-primary" href="#/demo">
                Open the player <ArrowIcon />
              </a>
              <a className="landing-text-link" href={`${docsUrl}/integration.md`}>
                Read the docs <ArrowIcon />
              </a>
            </div>
            <p className="landing-hero-note">
              Bring your own manifest. No dataset is bundled.
            </p>
            <dl className="landing-hero-specs">
              <div>
                <dt>Delivery</dt>
                <dd>Adaptive streaming</dd>
              </div>
              <div>
                <dt>Experience</dt>
                <dd>Desktop + WebXR</dd>
              </div>
            </dl>
          </div>
          <figure className="landing-study">
            <div className="landing-study-label">
              <span>Beyond the flat screen</span>
              <span>01 / Spatial media</span>
            </div>
            <img
              src={volumetricStudy}
              alt="Editorial illustration of a dancer formed from fine silver and violet volumetric particles."
              width={1448}
              height={1086}
              fetchPriority="high"
            />
            <figcaption>
              <span>Human movement. A new perspective.</span>
              <small>Volumetric illustration</small>
            </figcaption>
          </figure>
        </section>
        <div className="landing-technology" aria-label="Player technologies">
          <div className="landing-container">
            <p>An open stack for spatial media</p>
            <ul>
              <li>PlayCanvas</li>
              <li>SOG v2</li>
              <li>WebGPU</li>
              <li>WebXR</li>
            </ul>
          </div>
        </div>
        <section
          className="landing-container landing-section landing-features"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="landing-section-heading">
            <span className="landing-kicker">01 — The experience</span>
            <h2 id="features-title">
              More presence.
              <br />
              Less friction.
            </h2>
            <p>
              The controls you know, for content you can move around. Playback,
              buffering, and quality work together in one reusable player.
            </p>
          </div>
          <div className="landing-feature-grid">
            {features.map((feature, index) => (
              <article key={feature.title}>
                <span className="landing-number">0{index + 1}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          className="landing-workflow"
          id="workflow"
          aria-labelledby="workflow-title"
        >
          <div className="landing-container landing-section">
            <div className="landing-workflow-heading">
              <div className="landing-section-heading">
                <span className="landing-kicker">02 — From capture to playback</span>
                <h2 id="workflow-title">
                  Your content.
                  <br />A straightforward path.
                </h2>
              </div>
              <a
                className="landing-text-link"
                href={`${docsUrl}/content-preparation.md`}
              >
                Content preparation guide <ArrowIcon />
              </a>
            </div>
            <ol className="landing-steps">
              {workflow.map((step, index) => (
                <li key={step.title}>
                  <span className="landing-step-index">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              ))}
            </ol>
            <BuildCommand />
          </div>
        </section>
        <section
          className="landing-container landing-section landing-support"
          id="formats"
          aria-labelledby="formats-title"
        >
          <div className="landing-section-heading">
            <span className="landing-kicker">03 — The ecosystem</span>
            <h2 id="formats-title">
              A practical stack.
              <br />
              Room to explore.
            </h2>
            <p>
              Start with PlayCanvas and SOG for the recommended playback path.
              Alternative renderers remain available for research and comparison.
            </p>
            <a className="landing-text-link" href={`${docsUrl}/project/PERFORMANCE.md`}>
              Explore device measurements <ArrowIcon />
            </a>
          </div>
          <table className="landing-support-table">
            <caption className="landing-sr-only">Format and renderer support</caption>
            <thead>
              <tr>
                <th scope="col">Format / renderer</th>
                <th scope="col">Availability</th>
              </tr>
            </thead>
            <tbody>
              {supportRows.map((row) => (
                <tr key={row.name}>
                  <th scope="row">
                    {row.name}
                    <span>{row.detail}</span>
                  </th>
                  <td>
                    <span
                      className={`landing-badge${row.recommended ? " is-recommended" : ""}`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="landing-container landing-cta" aria-labelledby="cta-title">
          <div>
            <span className="landing-kicker">Make room for a new perspective</span>
            <h2 id="cta-title">
              Take your sequence
              <br />
              beyond the screen.
            </h2>
            <p>Connect a manifest and explore your content in the player.</p>
          </div>
          <div className="landing-cta-actions">
            <a className="landing-button landing-button-primary" href="#/demo">
              Launch showcase <ArrowIcon />
            </a>
            <a className="landing-text-link" href={githubUrl}>
              <GitHubIcon /> Explore the source
            </a>
          </div>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <a href="#/" aria-label="Volograms 4DGS home">
          <Brand />
        </a>
        <p>
          Created by Volograms, with support from 6G-PATH.
          <br />
          <span>Open source under the MIT license.</span>
        </p>
        <a className="landing-text-link" href={githubUrl}>
          GitHub <ArrowIcon />
        </a>
      </footer>
    </div>
  );
}
