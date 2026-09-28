import {
  BLEND_NORMAL,
  CULLFACE_BACK,
  SEMANTIC_POSITION,
  ShaderMaterial,
} from "playcanvas";

/**
 * One 3D gaussian drawn on its 3-sigma ellipsoid (the engine's unit sphere primitive,
 * radius 0.5, scaled per axis). Each fragment takes the view ray into the ellipsoid's
 * local frame, where the gaussian is isotropic, and shades by the peak density along
 * the ray: the ray's closest approach to the centre in sigma units. It uses the per-view
 * camera position, so it is correct in each eye.
 */
const vertexGLSL = /* glsl */ `
  attribute vec3 aPosition;
  uniform mat4 matrix_model;
  uniform mat4 matrix_viewProjection;
  varying vec3 vLocal;
  void main(void) {
    vLocal = aPosition;
    gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
  }
`;

const fragmentGLSL = /* glsl */ `
  #include "gammaPS"
  uniform vec3 view_position;
  uniform mat4 uWorldToLocal;
  uniform vec4 uColor;
  uniform float uOpacity;
  varying vec3 vLocal;
  void main(void) {
    vec3 camera = (uWorldToLocal * vec4(view_position, 1.0)).xyz;
    vec3 direction = normalize(vLocal - camera);
    float along = max(-dot(camera, direction), 0.0);
    // Sphere radius 0.5 is 3 sigma.
    float sigmas = length(camera + direction * along) * 6.0;
    float alpha = exp(-0.5 * sigmas * sigmas) * uOpacity;
    if (alpha < 1.0 / 255.0) discard;
    gl_FragColor = vec4(gammaCorrectOutput(decodeGamma(uColor)), alpha);
  }
`;

const vertexWGSL = /* wgsl */ `
  attribute aPosition: vec3f;
  uniform matrix_model: mat4x4f;
  uniform matrix_viewProjection: mat4x4f;
  varying vLocal: vec3f;
  @vertex
  fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.vLocal = input.aPosition;
    output.position =
      uniform.matrix_viewProjection * uniform.matrix_model * vec4f(input.aPosition, 1.0);
    return output;
  }
`;

const fragmentWGSL = /* wgsl */ `
  #include "gammaPS"
  uniform view_position: vec3f;
  uniform uWorldToLocal: mat4x4f;
  uniform uColor: vec4f;
  uniform uOpacity: f32;
  varying vLocal: vec3f;
  @fragment
  fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    let camera = (uniform.uWorldToLocal * vec4f(uniform.view_position, 1.0)).xyz;
    let direction = normalize(input.vLocal - camera);
    let along = max(-dot(camera, direction), 0.0);
    let sigmas = length(camera + direction * along) * 6.0;
    let alpha = exp(-0.5 * sigmas * sigmas) * uniform.uOpacity;
    if (alpha < 1.0 / 255.0) {
      discard;
    }
    output.color = vec4f(gammaCorrectOutput(decodeGamma(uniform.uColor)), alpha);
    return output;
  }
`;

export function createHeroGaussianMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    attributes: { aPosition: SEMANTIC_POSITION },
    fragmentGLSL,
    fragmentWGSL,
    uniqueName: "ExplainerHeroGaussian",
    vertexGLSL,
    vertexWGSL,
  });
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  // Front faces only, so each pixel is shaded once.
  material.cull = CULLFACE_BACK;
  material.update();
  return material;
}
