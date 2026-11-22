import {
  BufferAttribute, BufferGeometry, Color, GLSL3, HalfFloatType, Line, NearestFilter, NoBlending,
  Points, RawShaderMaterial, ShaderMaterial, Vector3, Vector4, WebGLRenderTarget,
} from 'three';
import { CORE_RADIUS, SIDE } from './erosion-field.js';
import { fields } from './settings.js';
import { randomSource } from './random.js';
import { precision } from './sand-shaders.js';

const flashDuration = .18;
const sourceDistance = 5;
const coolingTime = .8;
const heatSlots = Math.ceil(coolingTime * fields.laser.frequency[3]);

export function createSandLaser(seed, positions, grainIds, sphereRadius = { value: CORE_RADIUS }) {
  const random = randomSource((seed ^ 0x2ac817) >>> 0);
  const axis = { value: new Vector3() }, source = { value: new Vector3() };
  // Each live spot keeps its own GPU hit until it has cooled, even at the highest pulse rate.
  const target = new WebGLRenderTarget(1, heatSlots, {
    type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true,
  });
  target.scissorTest = true;
  const impactPoint = { value: target.texture }, impactRow = { value: 0 };
  const spots = { value: Array.from({ length: heatSlots }, () => new Vector4(0, 0, 0, 0)) };
  const sphereCenter = { value: new Vector3() };
  let nextRow = 0;
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
  const segment = new BufferGeometry();
  segment.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0]), 3));
  const beam = new Line(segment, new ShaderMaterial({
    uniforms: { source, impactPoint, impactRow, axis, sphereCenter, sphereRadius, brightness, beamColor },
    transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `uniform vec3 source, axis, sphereCenter;
      uniform float sphereRadius; uniform sampler2D impactPoint; uniform int impactRow;
      void main() {
        vec4 hit = texelFetch(impactPoint, ivec2(0, impactRow), 0);
        vec3 endPoint = hit.w > .5 ? hit.xyz : sphereCenter + sphereRadius * axis;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(source, endPoint, position.x), 1.);
      }`,
    fragmentShader: `uniform float brightness; uniform vec3 beamColor;
      void main() {
        // Limit the ink reflectance even for a bright tint from an older setup.
        vec3 ink = beamColor * min(1., .035 / max(.001, max(beamColor.r, max(beamColor.g, beamColor.b))));
        gl_FragColor = vec4(ink, brightness);
        #include <colorspace_fragment>
      }`,
  }));
  beam.frustumCulled = false;
  beam.visible = false;
  let frequency = fields.laser.frequency[1], phase = 0;
  let remainingFlash = 0;
  return {
    beam, axis, impactPoint, impactRow,
    heat: { impactPoint, spots, sphereCenter, sphereRadius },
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
      for (const spot of spots.value) spot.w = Math.max(0, spot.w - dt / coolingTime);
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
        sphereCenter.value.copy(center);
        spots.value[nextRow].set(axis.value.x, axis.value.y, axis.value.z, 1);
        impactRow.value = nextRow;
        target.viewport.set(0, nextRow, 1, 1);
        target.scissor.copy(target.viewport);
        nextRow = (nextRow + 1) % heatSlots;
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
