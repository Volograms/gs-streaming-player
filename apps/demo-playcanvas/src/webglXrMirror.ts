export interface WebglXrMirrorStats {
  readonly frameMs: number;
  readonly frames: number;
  readonly sourceHeight: number;
  readonly sourceWidth: number;
  readonly uploadAndDrawMs: number;
  readonly views: number;
  readonly xrFramesPerSecond: number;
}

export interface WebglXrMirrorOptions {
  onError?: (error: unknown) => void;
  onStats?: (stats: WebglXrMirrorStats) => void;
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
  requestAnimationFrame(
    callback: (time: number, frame: XrFrameLike) => void,
  ): number;
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
  private readonly onEnd = () => {
    this.disposeGlResources();
    this.session = undefined;
  };
  private readonly options: WebglXrMirrorOptions;
  private program: WebGLProgram | undefined;
  private referenceSpace: XrReferenceSpaceLike | undefined;
  private session: XrSessionLike | undefined;
  private readonly sourceCanvas: HTMLCanvasElement;
  private sourceHeight = 0;
  private sourceWidth = 0;
  private statsFrameCount = 0;
  private statsLastEmit = 0;
  private texture: WebGLTexture | undefined;
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
    await session.end();
    this.disposeGlResources();
    this.session = undefined;
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

    const frameStartedAt = performance.now();
    try {
      this.updateSourceTexture(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
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
        sourceHeight: this.sourceHeight,
        sourceWidth: this.sourceWidth,
        uploadAndDrawMs: frameEndedAt - frameStartedAt,
        views: pose.views.length,
        xrFramesPerSecond: frameMs > 0 ? 1000 / frameMs : 0,
      });
      this.statsLastEmit = frameEndedAt;
    }
    this.lastXrTime = time;
  };

  private initialiseGlResources(gl: WebGL2RenderingContext): void {
    this.program = createProgram(gl);
    this.vertexArray = gl.createVertexArray();
    this.texture = gl.createTexture() ?? undefined;
    gl.bindTexture(gl.TEXTURE_2D, this.texture!);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(this.program);
    const sourceUniform = gl.getUniformLocation(this.program, "uSource");
    gl.uniform1i(sourceUniform, 0);
  }

  private updateSourceTexture(gl: WebGL2RenderingContext): void {
    const width = this.sourceCanvas.width;
    const height = this.sourceCanvas.height;
    if (width <= 0 || height <= 0) {
      throw new Error("The WebGPU source canvas has no drawable size.");
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture!);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (width !== this.sourceWidth || height !== this.sourceHeight) {
      this.sourceWidth = width;
      this.sourceHeight = height;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.sourceCanvas,
      );
      return;
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.sourceCanvas,
    );
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
    this.texture = undefined;
    this.vertexArray = undefined;
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
