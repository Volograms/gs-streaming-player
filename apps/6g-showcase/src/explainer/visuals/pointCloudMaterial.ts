import {
  BLEND_NORMAL,
  CULLFACE_NONE,
  SEMANTIC_TEXCOORD0,
  SEMANTIC_TEXCOORD1,
  SEMANTIC_COLOR,
  SEMANTIC_POSITION,
  ShaderMaterial,
} from "playcanvas";

/**
 * Camera-facing quads for a coloured point cloud. `uSwell` morphs each point from a
 * small dot into a soft round gaussian blob sized by its initial scale (sigma), which
 * is how 3DGS initialises one gaussian per sparse point.
 */
const vertexGLSL = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec2 aCorner;
  attribute vec4 aColor;
  attribute float aScale;
  uniform mat4 matrix_model;
  uniform mat4 matrix_view;
  uniform mat4 matrix_viewProjection;
  uniform float uDotSize;
  uniform float uSwell;
  uniform float uBlobSigmas;
  uniform float uMaxBlob;
  varying vec2 vCorner;
  varying vec4 vColor;
  void main(void) {
    float blob = min(aScale * uBlobSigmas, uMaxBlob);
    float size = mix(uDotSize, blob, uSwell);
    vec3 right = vec3(matrix_view[0][0], matrix_view[1][0], matrix_view[2][0]);
    vec3 up = vec3(matrix_view[0][1], matrix_view[1][1], matrix_view[2][1]);
    vec4 center = matrix_model * vec4(aCenter, 1.0);
    float worldScale = length(matrix_model[0].xyz);
    vec3 world = center.xyz + (right * aCorner.x + up * aCorner.y) * size * worldScale;
    gl_Position = matrix_viewProjection * vec4(world, 1.0);
    vCorner = aCorner;
    vColor = aColor;
  }
`;

const fragmentGLSL = /* glsl */ `
  #include "gammaPS"
  uniform float uOpacity;
  uniform float uSwell;
  varying vec2 vCorner;
  varying vec4 vColor;
  void main(void) {
    float r2 = dot(vCorner, vCorner);
    if (r2 > 1.0) discard;
    // A crisp dot, becoming a gaussian falloff (edge at ~3 sigma) as it swells.
    float crisp = 1.0 - smoothstep(0.55, 1.0, r2);
    float gaussian = exp(-4.5 * r2);
    float alpha = mix(crisp, gaussian * 0.85, uSwell) * uOpacity;
    if (alpha < 1.0 / 255.0) discard;
    gl_FragColor = vec4(gammaCorrectOutput(decodeGamma(vColor)), alpha);
  }
`;

const vertexWGSL = /* wgsl */ `
  attribute aCenter: vec3f;
  attribute aCorner: vec2f;
  attribute aColor: vec4f;
  attribute aScale: f32;
  uniform matrix_model: mat4x4f;
  uniform matrix_view: mat4x4f;
  uniform matrix_viewProjection: mat4x4f;
  uniform uDotSize: f32;
  uniform uSwell: f32;
  uniform uBlobSigmas: f32;
  uniform uMaxBlob: f32;
  varying vCorner: vec2f;
  varying vColor: vec4f;
  @vertex
  fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let blob = min(input.aScale * uniform.uBlobSigmas, uniform.uMaxBlob);
    let size = mix(uniform.uDotSize, blob, uniform.uSwell);
    let view = uniform.matrix_view;
    let right = vec3f(view[0][0], view[1][0], view[2][0]);
    let up = vec3f(view[0][1], view[1][1], view[2][1]);
    let center = uniform.matrix_model * vec4f(input.aCenter, 1.0);
    let worldScale = length(uniform.matrix_model[0].xyz);
    let world = center.xyz + (right * input.aCorner.x + up * input.aCorner.y) * size * worldScale;
    output.position = uniform.matrix_viewProjection * vec4f(world, 1.0);
    output.vCorner = input.aCorner;
    output.vColor = input.aColor;
    return output;
  }
`;

const fragmentWGSL = /* wgsl */ `
  #include "gammaPS"
  uniform uOpacity: f32;
  uniform uSwell: f32;
  varying vCorner: vec2f;
  varying vColor: vec4f;
  @fragment
  fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let r2 = dot(input.vCorner, input.vCorner);
    if (r2 > 1.0) {
      discard;
    }
    let crisp = 1.0 - smoothstep(0.55, 1.0, r2);
    let gaussian = exp(-4.5 * r2);
    let alpha = mix(crisp, gaussian * 0.85, uniform.uSwell) * uniform.uOpacity;
    if (alpha < 1.0 / 255.0) {
      discard;
    }
    output.color = vec4f(gammaCorrectOutput(decodeGamma(input.vColor)), alpha);
    return output;
  }
`;

export function createPointCloudMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    attributes: {
      aCenter: SEMANTIC_POSITION,
      aColor: SEMANTIC_COLOR,
      aCorner: SEMANTIC_TEXCOORD0,
      aScale: SEMANTIC_TEXCOORD1,
    },
    fragmentGLSL,
    fragmentWGSL,
    uniqueName: "ExplainerPointCloud",
    vertexGLSL,
    vertexWGSL,
  });
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = CULLFACE_NONE;
  material.update();
  return material;
}
