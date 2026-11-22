import {
  BufferGeometry, Color, DoubleSide, GLSL3, HalfFloatType, Mesh, NearestFilter, NoBlending,
  PlaneGeometry, Points, RawShaderMaterial, ShaderMaterial, Vector3, WebGLRenderTarget,
} from 'three';
import { SIDE } from './erosion-field.js';
import { fields } from './settings.js';
import { randomSource } from './random.js';
import { precision } from './sand-shaders.js';

const flashDuration = .18;
const sourceDistance = 5;

export function createSandLaser(seed, positions, grainIds) {
  const random = randomSource((seed ^ 0x2ac817) >>> 0);
  const axis = { value: new Vector3() }, source = { value: new Vector3() };
  const target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true,
  });
  const impactPoint = { value: target.texture };
  // A one-pixel depth test selects the first grain along the beam, entirely on the GPU.
  const search = new Points(new BufferGeometry(), new RawShaderMaterial({
    glslVersion: GLSL3, uniforms: { positions, axis, source }, blending: NoBlending,
    vertexShader: precision + `in float position;
      uniform sampler2D positions;
      uniform vec3 source, axis;
      out vec3 grain;
      void main() {
        int id = int(position);
        grain = texelFetch(positions, ivec2(id % ${SIDE}, id / ${SIDE}), 0).xyz;
        vec3 offset = grain - source;
        float depth = -dot(offset, axis);
        vec3 side = offset + depth * axis;
        const float range = ${sourceDistance.toFixed(1)};
        bool inBeam = depth > 0. && depth < range && dot(side, side) < .065 * .065;
        gl_Position = inBeam ? vec4(0., 0., 2. * depth / range - 1., 1.) : vec4(3., 3., 0., 1.);
        gl_PointSize = 1.;
      }`,
    fragmentShader: precision + `in vec3 grain; out vec4 hit;
      void main() { hit = vec4(grain, 1.); }`,
  }));
  search.geometry.setAttribute('position', grainIds);
  search.frustumCulled = false;

  const brightness = { value: 0 };
  const beamColor = { value: new Color(fields.laser.color[1]) };
  const beam = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
    uniforms: { source, impactPoint, brightness, beamColor }, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    vertexShader: `uniform vec3 source; uniform sampler2D impactPoint; varying float across;
      void main() {
        vec4 hit = texelFetch(impactPoint, ivec2(0), 0);
        vec3 a = (modelViewMatrix * vec4(source, 1.)).xyz;
        vec3 b = (modelViewMatrix * vec4(hit.xyz, 1.)).xyz;
        vec2 line = b.xy * a.z - a.xy * b.z;
        vec2 side = vec2(-line.y, line.x) / max(.00001, length(line));
        vec3 p = mix(a, b, uv.y);
        across = 2. * uv.x - 1.;
        p.xy += side * across * .033;
        gl_Position = hit.w > .5 ? projectionMatrix * vec4(p, 1.) : vec4(3., 3., 0., 1.);
      }`,
    fragmentShader: `uniform float brightness; uniform vec3 beamColor; varying float across;
      void main() {
        float edge = abs(across);
        float peak = max(beamColor.r, max(beamColor.g, beamColor.b));
        vec3 core = mix(beamColor, vec3(peak), .48);
        vec3 ink = mix(core, beamColor, smoothstep(.12, .52, edge));
        gl_FragColor = vec4(ink, brightness * (1. - smoothstep(.34, 1., edge)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  beam.frustumCulled = false;
  beam.visible = false;
  let frequency = fields.laser.frequency[1], phase = 0;
  let remainingFlash = 0;
  return {
    beam, axis, impactPoint,
    configure(settings) {
      beamColor.value.set(settings.color);
      frequency = settings.frequency;
      if (frequency === 0) {
        phase = 0;
        remainingFlash = 0;
        brightness.value = 0;
        beam.visible = false;
      }
    },
    step(dt, center, renderer, camera) {
      phase += dt * frequency;
      remainingFlash = Math.max(0, remainingFlash - dt);
      const fire = phase >= 1 - 1e-8;
      if (fire) {
        // Uniform height and azimuth give each equal-area patch the same chance of a hit.
        const y = 2 * random() - 1;
        const azimuth = 2 * Math.PI * random();
        const horizontal = Math.sqrt(1 - y*y);
        axis.value.set(horizontal * Math.sin(azimuth), y, horizontal * Math.cos(azimuth));
        source.value.copy(center).addScaledVector(axis.value, sourceDistance);
        renderer.setRenderTarget(target);
        renderer.clear(true, true, false);
        renderer.render(search, camera);
        phase = Math.max(0, phase - 1);
        remainingFlash = flashDuration;
      }
      beam.visible = remainingFlash > 0;
      brightness.value = remainingFlash / flashDuration;
      return fire;
    },
    dispose() {
      search.geometry.dispose();
      search.material.dispose();
      beam.geometry.dispose();
      beam.material.dispose();
      target.dispose();
    },
  };
}
