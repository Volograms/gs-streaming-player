import {
  BLEND_NORMAL,
  CULLFACE_NONE,
  SEMANTIC_POSITION,
  SEMANTIC_TEXCOORD0,
  ShaderMaterial,
} from "playcanvas";

/** What a comparison panel shows. */
export const PANEL_MODE = { error: 2, photo: 0, render: 1 } as const;

/**
 * One training-view panel. Mode 0 shows the real photo, mode 1 the current render over
 * black, and mode 2 the error heatmap: the colour difference between the photo and the
 * render, colour-mapped (near black = matches, red then yellow = wrong) and limited to the
 * object's footprint (`uMask`, the final model's coverage).
 */
const vertexGLSL = /* glsl */ `
  attribute vec3 aPosition;
  attribute vec2 aUv;
  uniform mat4 matrix_model;
  uniform mat4 matrix_viewProjection;
  varying vec2 vUv;
  void main(void) {
    vUv = aUv;
    gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
  }
`;

const fragmentGLSL = /* glsl */ `
  #include "gammaPS"
  uniform sampler2D uPhoto;
  uniform sampler2D uRender;
  uniform sampler2D uMask;
  uniform float uMode;
  uniform float uOpacity;
  uniform float uGain;
  varying vec2 vUv;
  vec3 heat(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 cold = vec3(0.03, 0.02, 0.1);
    vec3 warm = vec3(0.85, 0.15, 0.15);
    vec3 hot = vec3(1.0, 0.95, 0.55);
    return t < 0.5 ? mix(cold, warm, t * 2.0) : mix(warm, hot, t * 2.0 - 1.0);
  }
  void main(void) {
    vec3 photo = texture2D(uPhoto, vUv).rgb;
    vec4 render = texture2D(uRender, vUv);
    vec3 rendered = render.rgb * render.a;
    vec3 colour;
    if (uMode < 0.5) {
      colour = photo;
    } else if (uMode < 1.5) {
      colour = rendered;
    } else {
      float mask = texture2D(uMask, vUv).a;
      float error = length(photo - rendered) * 0.57735;
      colour = mix(vec3(0.02, 0.02, 0.04), heat(error * uGain), mask);
    }
    gl_FragColor = vec4(gammaCorrectOutput(colour), uOpacity);
  }
`;

const vertexWGSL = /* wgsl */ `
  attribute aPosition: vec3f;
  attribute aUv: vec2f;
  uniform matrix_model: mat4x4f;
  uniform matrix_viewProjection: mat4x4f;
  varying vUv: vec2f;
  @vertex
  fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.vUv = input.aUv;
    output.position =
      uniform.matrix_viewProjection * uniform.matrix_model * vec4f(input.aPosition, 1.0);
    return output;
  }
`;

const fragmentWGSL = /* wgsl */ `
  #include "gammaPS"
  var uPhoto: texture_2d<f32>;
  var uPhotoSampler: sampler;
  var uRender: texture_2d<f32>;
  var uRenderSampler: sampler;
  var uMask: texture_2d<f32>;
  var uMaskSampler: sampler;
  uniform uMode: f32;
  uniform uOpacity: f32;
  uniform uGain: f32;
  varying vUv: vec2f;
  fn heat(value: f32) -> vec3f {
    let t = clamp(value, 0.0, 1.0);
    let cold = vec3f(0.03, 0.02, 0.1);
    let warm = vec3f(0.85, 0.15, 0.15);
    let hot = vec3f(1.0, 0.95, 0.55);
    return select(mix(warm, hot, t * 2.0 - 1.0), mix(cold, warm, t * 2.0), t < 0.5);
  }
  @fragment
  fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let photo = textureSample(uPhoto, uPhotoSampler, input.vUv).rgb;
    let render = textureSample(uRender, uRenderSampler, input.vUv);
    let mask = textureSample(uMask, uMaskSampler, input.vUv).a;
    let rendered = render.rgb * render.a;
    let error = length(photo - rendered) * 0.57735;
    let heatmap = mix(vec3f(0.02, 0.02, 0.04), heat(error * uniform.uGain), mask);
    var colour = heatmap;
    if (uniform.uMode < 0.5) {
      colour = photo;
    } else if (uniform.uMode < 1.5) {
      colour = rendered;
    }
    output.color = vec4f(gammaCorrectOutput(colour), uniform.uOpacity);
    return output;
  }
`;

export function createComparisonMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    attributes: { aPosition: SEMANTIC_POSITION, aUv: SEMANTIC_TEXCOORD0 },
    fragmentGLSL,
    fragmentWGSL,
    uniqueName: "ExplainerComparisonPanel",
    vertexGLSL,
    vertexWGSL,
  });
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = CULLFACE_NONE;
  material.update();
  return material;
}
