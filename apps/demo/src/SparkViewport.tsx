import { SparkGaussianRendererAdapter } from "@6g-path/gaussian-renderer-spark";
import { useEffect, useRef, useState } from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type RendererStatus = "initialising" | "ready" | "unavailable";
type StaticAssetStatus = "failed" | "loading" | "not-configured" | "ready";

const staticRadUrl = import.meta.env.VITE_STATIC_RAD_URL;

export function SparkViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<RendererStatus>("initialising");
  const [staticAssetStatus, setStaticAssetStatus] = useState<StaticAssetStatus>(
    staticRadUrl === undefined ? "not-configured" : "loading",
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    let active = true;
    let controls: OrbitControls | undefined;
    let rendererInitialised = false;
    const controller = new AbortController();
    const adapter = new SparkGaussianRendererAdapter({ autoRender: false, canvas });

    async function initialiseRenderer() {
      try {
        await adapter.initialise();
        rendererInitialised = true;
        controls = new OrbitControls(adapter.camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxDistance = 100;
        controls.minDistance = 0.05;
        controls.screenSpacePanning = true;
        controls.target.set(0, 0, 0);
        controls.update();
        adapter.renderer.setAnimationLoop(() => {
          controls?.update();
          adapter.render();
        });

        await adapter.loadMesh(
          {
            id: "demo-marker",
            transform: {
              position: { x: 0, y: 0, z: 0 },
              scale: { x: 0.75, y: 0.75, z: 0.75 },
            },
            url: "/assets/marker.gltf",
          },
          { signal: controller.signal },
        );
        if (active) {
          setStatus("ready");
        }

        if (staticRadUrl !== undefined) {
          try {
            await adapter.loadStaticObject(
              { id: "demo-static-rad", url: staticRadUrl },
              { signal: controller.signal },
            );
            if (active) {
              setStaticAssetStatus("ready");
            }
          } catch (error) {
            if (active && !controller.signal.aborted) {
              console.error("Unable to load the configured static RAD asset.", error);
              setStaticAssetStatus("failed");
            }
          }
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          console.error("Unable to initialise the Spark demo viewport.", error);
          setStatus("unavailable");
        }
      }
    }

    void initialiseRenderer();

    return () => {
      active = false;
      controller.abort();
      controls?.dispose();
      if (rendererInitialised) {
        adapter.renderer.setAnimationLoop(null);
      }
      adapter.dispose();
    };
  }, []);

  return (
    <div className="spark-viewport">
      <canvas ref={canvasRef} aria-label="Gaussian scene viewport" />
      <p className="navigation-hint">
        Drag to orbit · Right-drag to pan · Scroll to zoom
      </p>
      <p className="renderer-status" data-renderer-status={status}>
        {status === "ready"
          ? "Renderer ready"
          : status === "unavailable"
            ? "Renderer unavailable"
            : "Initialising renderer"}
      </p>
      {staticAssetStatus === "not-configured" ? null : (
        <p className="static-asset-status" data-static-asset-status={staticAssetStatus}>
          {staticAssetStatus === "ready"
            ? "Static RAD ready"
            : staticAssetStatus === "failed"
              ? "Static RAD failed"
              : "Loading static RAD"}
        </p>
      )}
    </div>
  );
}
