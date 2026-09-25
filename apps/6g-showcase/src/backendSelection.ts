import type {
  PlayCanvasGraphicsBackend,
  PlayCanvasXrSupportReason,
} from "@6g-path/gaussian-renderer-playcanvas";

export function chooseShowcaseBackend(
  hasWebGpu: boolean,
  xrDisabled: boolean,
  xrSupportReason?: PlayCanvasXrSupportReason,
): PlayCanvasGraphicsBackend {
  if (!hasWebGpu) return "webgl2";
  if (xrDisabled) return "webgpu";
  return xrSupportReason === "webgpu-binding-unavailable" ||
    xrSupportReason === "probe-failed"
    ? "webgl2"
    : "webgpu";
}
