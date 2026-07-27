export interface WebglXrMirrorStats {
  readonly frameMs: number;
  readonly frames: number;
  readonly sourceRenderMs: number;
  readonly sourceHeight: number;
  readonly sourceWidth: number;
  readonly uploadPath: "canvas-2d" | "direct";
  readonly uploadAndDrawMs: number;
  readonly views: number;
  readonly xrFramesPerSecond: number;
}

export interface WebglXrMirrorOptions {
  onEnd?: () => void;
  onError?: (error: unknown) => void;
  onStats?: (stats: WebglXrMirrorStats) => void;
  renderSourceFrame?: () => void;
}

type XrFrameLike = {
  getViewerPose(referenceSpace: XrReferenceSpaceLike): XrViewerPoseLike | null;
};

type XrReferenceSpaceLike = object;

type XrSessionLike = {
  addEventListener(type: "end", listener: () => void): void;
  cancelAnimationFrame(handle: number): void;
  end(): Promise<void>;
  removeEventListener(type: "end", listener: () => void): void;
  requestAnimationFrame(callback: (time: number, frame: XrFrameLike) => void): number;
  requestReferenceSpace(type: "local-floor" | "local"): Promise<XrReferenceSpaceLike>;
  updateRenderState(state: { baseLayer: XrWebGLLayerLike }): void;
};

type XrViewLike = object;

type XrViewerPoseLike = {
  views: readonly XrViewLike[];
};

type XrWebGLLayerLike = {
  framebuffer: WebGLFramebuffer | null;
  getViewport(view: XrViewLike): XrViewportLike | null;
};

type WebGL2XrCompatibleContext = WebGL2RenderingContext & {
  makeXRCompatible?: () => Promise<void>;
};

type XrViewportLike = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export class WebglXrMirrorPresenter {
  private animationFrameHandle: number | undefined;
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | undefined;
  private layer: XrWebGLLayerLike | undefined;
  private lastXrTime: number | undefined;
  private readonly onEnd = () => this.finishSession();
  private readonly options: WebglXrMirrorOptions;
  private program: WebGLProgram | undefined;
  private referenceSpace: XrReferenceSpaceLike | undefined;
  private session: XrSessionLike | undefined;
  private readonly sourceCanvas: HTMLCanvasElement;
  private sourceHeight = 0;
  private sourceWidth = 0;
  private statsFrameCount = 0;
  private statsLastEmit = 0;
  private stagingCanvas: HTMLCanvasElement | undefined;
  private stagingContext: CanvasRenderingContext2D | undefined;
  private texture: WebGLTexture | undefined;
  private uploadPath: "canvas-2d" | "direct" = "direct";
  private vertexArray: WebGLVertexArrayObject | null | undefined;

  constructor(sourceCanvas: HTMLCanvasElement, options: WebglXrMirrorOptions = {}) {
    this.sourceCanvas = sourceCanvas;
    this.options = options;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 16;
    this.canvas.height = 16;
    this.canvas.style.display = "none";
    document.body.appendChild(this.canvas);
  }

  get active(): boolean {
    return this.session !== undefined;
  }

  async start(): Promise<void> {
    if (this.session !== undefined) {
      return;
    }
    const navigatorWithXr = navigator as Navigator & {
      xr?: {
        requestSession: (
          type: "immersive-vr",
          options: { requiredFeatures?: string[] },
        ) => Promise<XrSessionLike>;
      };
    };
    if (navigatorWithXr.xr === undefined) {
      throw new Error("navigator.xr is not available.");
    }
    const layerConstructor = (
      globalThis as unknown as {
        XRWebGLLayer?: new (
          session: XrSessionLike,
          context: WebGL2RenderingContext,
        ) => XrWebGLLayerLike;
      }
    ).XRWebGLLayer;
    if (layerConstructor === undefined) {
      throw new Error("XRWebGLLayer is not available.");
    }

    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      stencil: false,
      xrCompatible: true,
    });
    if (gl === null) {
      throw new Error("Could not create the WebGL2 context for XR mirroring.");
    }
    await (gl as WebGL2XrCompatibleContext).makeXRCompatible?.();
    this.gl = gl;
    this.initialiseGlResources(gl);
    throwOnGlError(gl, "initialising the WebGL mirror");

    const session = await requestImmersiveVrSession(navigatorWithXr.xr);
    this.session = session;
    session.addEventListener("end", this.onEnd);
    const layer = new layerConstructor(session, gl);
    this.layer = layer;
    session.updateRenderState({ baseLayer: layer });
    this.referenceSpace = await requestReferenceSpace(session);
    this.animationFrameHandle = session.requestAnimationFrame(this.renderXrFrame);
  }

  async end(): Promise<void> {
    const session = this.session;
    if (session === undefined) {
      this.disposeGlResources();
      return;
    }
    if (this.animationFrameHandle !== undefined) {
      session.cancelAnimationFrame(this.animationFrameHandle);
      this.animationFrameHandle = undefined;
    }
    session.removeEventListener("end", this.onEnd);
    try {
      await session.end();
    } finally {
      this.finishSession();
    }
  }

  dispose(): void {
    void this.end().catch(this.options.onError);
    this.canvas.remove();
  }

  private readonly renderXrFrame = (time: number, frame: XrFrameLike): void => {
    const session = this.session;
    const referenceSpace = this.referenceSpace;
    const layer = this.layer;
    const gl = this.gl;
    if (
      session === undefined ||
      referenceSpace === undefined ||
      layer === undefined ||
      gl === undefined
    ) {
      return;
    }
    this.animationFrameHandle = session.requestAnimationFrame(this.renderXrFrame);
    const pose = frame.getViewerPose(referenceSpace);
    if (pose === null) {
      return;
    }

    let uploadStartedAt: number;
    let sourceRenderMs: number;
    try {
      if (gl.isContextLost()) {
        throw new Error("The WebGL mirror context was lost.");
      }

      const sourceRenderStartedAt = performance.now();
      this.options.renderSourceFrame?.();
      sourceRenderMs = performance.now() - sourceRenderStartedAt;

      uploadStartedAt = performance.now();
      this.updateSourceTexture(gl);
      if (layer.framebuffer === null) {
        throw new Error("The WebXR layer did not provide a framebuffer.");
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (framebufferStatus !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(
          `The WebXR framebuffer is incomplete (${glEnumName(gl, framebufferStatus)}).`,
        );
      }
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.useProgram(this.program!);
      gl.bindVertexArray(this.vertexArray ?? null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture!);
      for (const view of pose.views) {
        const viewport = layer.getViewport(view);
        if (viewport === null) {
          continue;
        }
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.flush();
      throwOnGlError(gl, "drawing the WebGL mirror frame");
    } catch (error) {
      this.options.onError?.(error);
      void this.end().catch(this.options.onError);
      return;
    }

    const frameEndedAt = performance.now();
    this.statsFrameCount += 1;
    if (frameEndedAt - this.statsLastEmit >= 500) {
      const frameMs =
        this.lastXrTime === undefined ? 0 : Math.max(0, time - this.lastXrTime);
      this.options.onStats?.({
        frameMs,
        frames: this.statsFrameCount,
        sourceRenderMs,
        sourceHeight: this.sourceHeight,
        sourceWidth: this.sourceWidth,
        uploadPath: this.uploadPath,
        uploadAndDrawMs: frameEndedAt - uploadStartedAt,
        views: pose.views.length,
        xrFramesPerSecond: frameMs > 0 ? 1000 / frameMs : 0,
      });
      this.statsLastEmit = frameEndedAt;
    }
    this.lastXrTime = time;
  };

  private initialiseGlResources(gl: WebGL2RenderingContext): void {
    this.program = createProgram(gl);
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) {
      throw new Error("Could not create the WebGL mirror vertex array.");
    }
    this.vertexArray = vertexArray;
    const texture = gl.createTexture();
    if (texture === null) {
      throw new Error("Could not create the WebGL mirror texture.");
    }
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(this.program);
    const sourceUniform = gl.getUniformLocation(this.program, "uSource");
    if (sourceUniform === null) {
      throw new Error("Could not find the WebGL mirror source sampler.");
    }
    gl.uniform1i(sourceUniform, 0);
  }

  private updateSourceTexture(gl: WebGL2RenderingContext): void {
    const width = this.sourceCanvas.width;
    const height = this.sourceCanvas.height;
    if (width <= 0 || height <= 0) {
      throw new Error("The WebGPU source canvas has no drawable size.");
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture!);
    // Quest's Chromium WebGPU/WebGL interop currently rejects the direct source with
    // INVALID_OPERATION. Avoid pixel-store transforms on the direct path and fall back
    // to Chromium's accelerated Canvas2D readback path when that specific failure occurs.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (this.uploadPath === "direct") {
      this.uploadTexture(gl, this.sourceCanvas, width, height);
      const directErrors = readGlErrors(gl);
      if (directErrors.length === 0) {
        this.sourceWidth = width;
        this.sourceHeight = height;
        return;
      }
      if (!directErrors.every((error) => error === gl.INVALID_OPERATION)) {
        throwGlErrors("uploading the WebGPU canvas directly", directErrors, gl);
      }
      this.uploadPath = "canvas-2d";
    }

    const stagingCanvas = this.updateStagingCanvas(width, height);
    this.uploadTexture(gl, stagingCanvas, width, height);
    throwOnGlError(gl, "uploading the Canvas2D-staged WebGPU frame");
    this.sourceWidth = width;
    this.sourceHeight = height;
  }

  private updateStagingCanvas(width: number, height: number): HTMLCanvasElement {
    const stagingCanvas = this.stagingCanvas ?? document.createElement("canvas");
    if (stagingCanvas.width !== width || stagingCanvas.height !== height) {
      stagingCanvas.width = width;
      stagingCanvas.height = height;
      this.stagingContext = undefined;
    }
    const stagingContext =
      this.stagingContext ??
      stagingCanvas.getContext("2d", { alpha: false }) ??
      undefined;
    if (stagingContext === undefined) {
      throw new Error("Could not create the Canvas2D WebGPU staging context.");
    }
    this.stagingCanvas = stagingCanvas;
    this.stagingContext = stagingContext;
    stagingContext.drawImage(this.sourceCanvas, 0, 0, width, height);
    return stagingCanvas;
  }

  private uploadTexture(
    gl: WebGL2RenderingContext,
    source: HTMLCanvasElement,
    width: number,
    height: number,
  ): void {
    if (width !== this.sourceWidth || height !== this.sourceHeight) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
  }

  private disposeGlResources(): void {
    const gl = this.gl;
    if (gl !== undefined) {
      if (this.texture !== undefined) {
        gl.deleteTexture(this.texture);
      }
      if (this.program !== undefined) {
        gl.deleteProgram(this.program);
      }
      if (this.vertexArray !== undefined) {
        gl.deleteVertexArray(this.vertexArray);
      }
    }
    this.animationFrameHandle = undefined;
    this.gl = undefined;
    this.layer = undefined;
    this.program = undefined;
    this.referenceSpace = undefined;
    this.sourceHeight = 0;
    this.sourceWidth = 0;
    this.stagingCanvas = undefined;
    this.stagingContext = undefined;
    this.texture = undefined;
    this.uploadPath = "direct";
    this.vertexArray = undefined;
  }

  private finishSession(): void {
    if (this.session === undefined && this.gl === undefined) {
      return;
    }
    this.disposeGlResources();
    this.session = undefined;
    this.options.onEnd?.();
  }
}

async function requestImmersiveVrSession(xr: {
  requestSession: (
    type: "immersive-vr",
    options: { requiredFeatures?: string[] },
  ) => Promise<XrSessionLike>;
}): Promise<XrSessionLike> {
  try {
    return await xr.requestSession("immersive-vr", {
      requiredFeatures: ["local-floor"],
    });
  } catch {
    return await xr.requestSession("immersive-vr", {
      requiredFeatures: ["local"],
    });
  }
}

async function requestReferenceSpace(
  session: XrSessionLike,
): Promise<XrReferenceSpaceLike> {
  try {
    return await session.requestReferenceSpace("local-floor");
  } catch {
    return await session.requestReferenceSpace("local");
  }
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    precision highp float;
    out vec2 vUv;
    const vec2 positions[4] = vec2[4](
      vec2(-1.0, -1.0),
      vec2(1.0, -1.0),
      vec2(-1.0, 1.0),
      vec2(1.0, 1.0)
    );
    void main() {
      vec2 position = positions[gl_VertexID];
      vUv = vec2(position.x * 0.5 + 0.5, 1.0 - (position.y * 0.5 + 0.5));
      gl_Position = vec4(position, 0.0, 1.0);
    }`,
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    uniform sampler2D uSource;
    in vec2 vUv;
    out vec4 color;
    void main() {
      color = texture(uSource, vUv);
    }`,
  );
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("Could not create the WebGL mirror shader program.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Could not link the WebGL mirror shader program: ${error}`);
  }
  return program;
}

function throwOnGlError(gl: WebGL2RenderingContext, operation: string): void {
  const errors = readGlErrors(gl);
  if (errors.length > 0) {
    throwGlErrors(operation, errors, gl);
  }
}

function readGlErrors(gl: WebGL2RenderingContext): number[] {
  const errors: number[] = [];
  for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) {
    errors.push(error);
    if (errors.length === 16) {
      break;
    }
  }
  return errors;
}

function throwGlErrors(
  operation: string,
  errors: readonly number[],
  gl: WebGL2RenderingContext,
): never {
  throw new Error(
    `WebGL failed while ${operation}: ${errors
      .map((error) => glEnumName(gl, error))
      .join(", ")}.`,
  );
}

function glEnumName(gl: WebGL2RenderingContext, value: number): string {
  switch (value) {
    case gl.INVALID_ENUM:
      return "INVALID_ENUM";
    case gl.INVALID_VALUE:
      return "INVALID_VALUE";
    case gl.INVALID_OPERATION:
      return "INVALID_OPERATION";
    case gl.INVALID_FRAMEBUFFER_OPERATION:
      return "INVALID_FRAMEBUFFER_OPERATION";
    case gl.OUT_OF_MEMORY:
      return "OUT_OF_MEMORY";
    case gl.CONTEXT_LOST_WEBGL:
      return "CONTEXT_LOST_WEBGL";
    case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
      return "FRAMEBUFFER_INCOMPLETE_ATTACHMENT";
    case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
      return "FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT";
    case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
      return "FRAMEBUFFER_INCOMPLETE_DIMENSIONS";
    case gl.FRAMEBUFFER_UNSUPPORTED:
      return "FRAMEBUFFER_UNSUPPORTED";
    case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
      return "FRAMEBUFFER_INCOMPLETE_MULTISAMPLE";
    default:
      return `0x${value.toString(16)}`;
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("Could not create the WebGL mirror shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) ?? "unknown compile error";
    gl.deleteShader(shader);
    throw new Error(`Could not compile the WebGL mirror shader: ${error}`);
  }
  return shader;
}
