import {
  BLEND_NORMAL,
  CULLFACE_NONE,
  SEMANTIC_COLOR,
  SEMANTIC_POSITION,
  SEMANTIC_TEXCOORD0,
  SEMANTIC_TEXCOORD1,
  SEMANTIC_TEXCOORD2,
  SEMANTIC_TEXCOORD3,
  ShaderMaterial,
} from "playcanvas";

/**
 * Gaussians travelling from their 3D place in the demo object to their 2D footprint on
 * a screen. Each vertex blends between a camera-facing blob at its stage-frame position
 * (through `uAnchor`, the object's world transform) and a flat disc lying in the screen
 * plane (through `uScreen`). Progress is staggered per gaussian by `aDelay`.
 */
const vertexGLSL = /* glsl */ `
  attribute vec3 aStart;
  attribute vec2 aCorner;
  attribute vec2 aTarget;
  attribute vec2 aSize;
  attribute float aDelay;
  attribute vec4 aColor;
  uniform mat4 matrix_view;
  uniform mat4 matrix_viewProjection;
  uniform mat4 uAnchor;
  uniform mat4 uScreen;
  uniform float uProgress;
  varying vec2 vCorner;
  varying vec4 vColor;
  varying float vFlight;
  void main(void) {
    float t = smoothstep(aDelay, aDelay + 0.3, uProgress);
    vFlight = t;
    vec3 start = (uAnchor * vec4(aStart, 1.0)).xyz;
    vec3 target = (uScreen * vec4(aTarget, 0.0, 1.0)).xyz;
    vec3 centre = mix(start, target, t);
    vec3 viewRight = vec3(matrix_view[0][0], matrix_view[1][0], matrix_view[2][0]);
    vec3 viewUp = vec3(matrix_view[0][1], matrix_view[1][1], matrix_view[2][1]);
    vec3 screenRight = normalize(uScreen[0].xyz);
    vec3 screenUp = normalize(uScreen[1].xyz);
    vec3 right = normalize(mix(viewRight, screenRight, t));
    vec3 up = normalize(mix(viewUp, screenUp, t));
    float size3d = aSize.x * length(uAnchor[0].xyz);
    float size2d = aSize.y * length(uScreen[0].xyz);
    float size = mix(size3d, size2d, t);
    // Lift flat splats just off the screen surface.
    vec3 lift = normalize(uScreen[2].xyz) * 0.004 * t;
    vec3 world = centre + lift + (right * aCorner.x + up * aCorner.y) * size;
    gl_Position = matrix_viewProjection * vec4(world, 1.0);
    vCorner = aCorner;
    vColor = aColor;
  }
`;

const fragmentGLSL = /* glsl */ `
  #include "gammaPS"
  uniform float uOpacity;
  varying vec2 vCorner;
  varying vec4 vColor;
  varying float vFlight;
  void main(void) {
    float r2 = dot(vCorner, vCorner);
    if (r2 > 1.0) discard;
    // Each splat appears as it leaves the object, so they peel off one by one.
    float alpha = exp(-4.5 * r2) * 0.9 * uOpacity * smoothstep(0.0, 0.12, vFlight);
    if (alpha < 1.0 / 255.0) discard;
    gl_FragColor = vec4(gammaCorrectOutput(decodeGamma(vColor)), alpha);
  }
`;

const vertexWGSL = /* wgsl */ `
  attribute aStart: vec3f;
  attribute aCorner: vec2f;
  attribute aTarget: vec2f;
  attribute aSize: vec2f;
  attribute aDelay: f32;
  attribute aColor: vec4f;
  uniform matrix_view: mat4x4f;
  uniform matrix_viewProjection: mat4x4f;
  uniform uAnchor: mat4x4f;
  uniform uScreen: mat4x4f;
  uniform uProgress: f32;
  varying vCorner: vec2f;
  varying vColor: vec4f;
  varying vFlight: f32;
  @vertex
  fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let t = smoothstep(input.aDelay, input.aDelay + 0.3, uniform.uProgress);
    output.vFlight = t;
    let anchor = uniform.uAnchor;
    let screen = uniform.uScreen;
    let start = (anchor * vec4f(input.aStart, 1.0)).xyz;
    let landing = (screen * vec4f(input.aTarget, 0.0, 1.0)).xyz;
    let centre = mix(start, landing, t);
    let view = uniform.matrix_view;
    let viewRight = vec3f(view[0][0], view[1][0], view[2][0]);
    let viewUp = vec3f(view[0][1], view[1][1], view[2][1]);
    let right = normalize(mix(viewRight, normalize(screen[0].xyz), t));
    let up = normalize(mix(viewUp, normalize(screen[1].xyz), t));
    let size3d = input.aSize.x * length(anchor[0].xyz);
    let size2d = input.aSize.y * length(screen[0].xyz);
    let size = mix(size3d, size2d, t);
    let lift = normalize(screen[2].xyz) * 0.004 * t;
    let world = centre + lift + (right * input.aCorner.x + up * input.aCorner.y) * size;
    output.position = uniform.matrix_viewProjection * vec4f(world, 1.0);
    output.vCorner = input.aCorner;
    output.vColor = input.aColor;
    return output;
  }
`;

const fragmentWGSL = /* wgsl */ `
  #include "gammaPS"
  uniform uOpacity: f32;
  varying vCorner: vec2f;
  varying vColor: vec4f;
  varying vFlight: f32;
  @fragment
  fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let r2 = dot(input.vCorner, input.vCorner);
    if (r2 > 1.0) {
      discard;
    }
    let alpha =
      exp(-4.5 * r2) * 0.9 * uniform.uOpacity * smoothstep(0.0, 0.12, input.vFlight);
    if (alpha < 1.0 / 255.0) {
      discard;
    }
    output.color = vec4f(gammaCorrectOutput(decodeGamma(input.vColor)), alpha);
    return output;
  }
`;

export function createProjectionMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    attributes: {
      aColor: SEMANTIC_COLOR,
      aCorner: SEMANTIC_TEXCOORD0,
      aDelay: SEMANTIC_TEXCOORD3,
      aSize: SEMANTIC_TEXCOORD2,
      aStart: SEMANTIC_POSITION,
      aTarget: SEMANTIC_TEXCOORD1,
    },
    fragmentGLSL,
    fragmentWGSL,
    uniqueName: "ExplainerProjection",
    vertexGLSL,
    vertexWGSL,
  });
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = CULLFACE_NONE;
  material.update();
  return material;
}
