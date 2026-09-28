import {
  BLEND_NONE,
  CULLFACE_BACK,
  SEMANTIC_COLOR,
  SEMANTIC_NORMAL,
  SEMANTIC_POSITION,
  SEMANTIC_TEXCOORD0,
  SEMANTIC_TEXCOORD1,
  ShaderMaterial,
} from "playcanvas";

/**
 * Solid, shaded ellipsoids baked into one mesh. Each vertex keeps its ellipsoid's centre
 * and its offset from it, so `uGrow` scales every ellipsoid about its own centre (with a
 * per-ellipsoid `aDelay` stagger). Simple two-sided key light plus ambient, so the
 * orientation and elongation of each gaussian read clearly.
 */
const vertexGLSL = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aOffset;
  attribute vec3 aNormal;
  attribute vec4 aColor;
  attribute float aDelay;
  uniform mat4 matrix_model;
  uniform mat4 matrix_viewProjection;
  uniform float uGrow;
  varying vec3 vNormal;
  varying vec4 vColor;
  void main(void) {
    float grow = smoothstep(aDelay * 0.4, aDelay * 0.4 + 0.6, uGrow);
    vec4 world = matrix_model * vec4(aCenter + aOffset * grow, 1.0);
    gl_Position = matrix_viewProjection * world;
    vNormal = normalize((matrix_model * vec4(aNormal, 0.0)).xyz);
    vColor = aColor;
  }
`;

const fragmentGLSL = /* glsl */ `
  #include "gammaPS"
  uniform vec3 uLight;
  varying vec3 vNormal;
  varying vec4 vColor;
  void main(void) {
    float diffuse = abs(dot(normalize(vNormal), uLight));
    vec3 lit = vColor.rgb * (0.35 + 0.75 * diffuse);
    gl_FragColor = vec4(gammaCorrectOutput(decodeGamma(vec4(lit, 1.0))), 1.0);
  }
`;

const vertexWGSL = /* wgsl */ `
  attribute aCenter: vec3f;
  attribute aOffset: vec3f;
  attribute aNormal: vec3f;
  attribute aColor: vec4f;
  attribute aDelay: f32;
  uniform matrix_model: mat4x4f;
  uniform matrix_viewProjection: mat4x4f;
  uniform uGrow: f32;
  varying vNormal: vec3f;
  varying vColor: vec4f;
  @vertex
  fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let grow = smoothstep(input.aDelay * 0.4, input.aDelay * 0.4 + 0.6, uniform.uGrow);
    let world = uniform.matrix_model * vec4f(input.aCenter + input.aOffset * grow, 1.0);
    output.position = uniform.matrix_viewProjection * world;
    output.vNormal = normalize((uniform.matrix_model * vec4f(input.aNormal, 0.0)).xyz);
    output.vColor = input.aColor;
    return output;
  }
`;

const fragmentWGSL = /* wgsl */ `
  #include "gammaPS"
  uniform uLight: vec3f;
  varying vNormal: vec3f;
  varying vColor: vec4f;
  @fragment
  fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let diffuse = abs(dot(normalize(input.vNormal), uniform.uLight));
    let lit = input.vColor.rgb * (0.35 + 0.75 * diffuse);
    output.color = vec4f(gammaCorrectOutput(decodeGamma(vec4f(lit, 1.0))), 1.0);
    return output;
  }
`;

export function createEllipsoidMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    attributes: {
      aCenter: SEMANTIC_POSITION,
      aColor: SEMANTIC_COLOR,
      aDelay: SEMANTIC_TEXCOORD1,
      aNormal: SEMANTIC_NORMAL,
      aOffset: SEMANTIC_TEXCOORD0,
    },
    fragmentGLSL,
    fragmentWGSL,
    uniqueName: "ExplainerEllipsoids",
    vertexGLSL,
    vertexWGSL,
  });
  material.blendType = BLEND_NONE;
  material.depthWrite = true;
  material.depthTest = true;
  material.cull = CULLFACE_BACK;
  material.update();
  return material;
}
