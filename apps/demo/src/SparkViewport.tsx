import { SparkGaussianRendererAdapter } from "@6g-path/gaussian-renderer-spark";
import { useEffect, useRef, useState } from "react";

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
    const controller = new AbortController();
    const adapter = new SparkGaussianRendererAdapter({ canvas });

    async function initialiseRenderer() {
      try {
        await adapter.initialise();
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
      adapter.dispose();
    };
  }, []);

  return (
    <div className="spark-viewport">
      <canvas ref={canvasRef} aria-label="Gaussian scene viewport" />
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
