import {
  BufferAttribute, BufferGeometry, Camera, Color, DataTexture,
  FloatType, GLSL3, HalfFloatType, InstancedBufferGeometry, Mesh, NearestFilter, NoBlending, Points,
  RawShaderMaterial, RGBAFormat, UnsignedByteType, Vector3, WebGLRenderTarget,
} from 'three';
import { CORE_RADIUS, GRAIN_COUNT, GRAIN_RADIUS, GRAIN_RADIUS_SPREAD, seedSand, SIDE } from './erosion-field.js';
import { atlasWidth, atlasHeight, precision, scatterFragment, scatterVertex, screenVertex, stepFragment } from './sand-shaders.js';
import { fields } from './settings.js';
import { createSandLaser } from './sand-laser.js';

function dataTexture(data) {
  const tex = new DataTexture(data, SIDE, SIDE, RGBAFormat, FloatType);
  tex.needsUpdate = true;
  return tex;
}

export function createGpuSand(renderer, seed, sphereRadius = CORE_RADIUS) {
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
    throw new Error('Erosion needs WebGL 2 with floating-point render targets.');
  }
  const initial = seedSand(seed, sphereRadius);
  const start = dataTexture(initial.positions), speed = dataTexture(initial.velocities);
  const options = { type: HalfFloatType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false };
  const contacts = new WebGLRenderTarget(atlasWidth, atlasHeight, { ...options, type: UnsignedByteType });
  const states = [0,1].map(() => new WebGLRenderTarget(SIDE, SIDE, { ...options, count: 2 }));
  const physicsUniforms = Object.fromEntries(Object.entries(fields.physics).map(([key, [, initial]]) =>
    [key, { value: initial }]));
  // Older saves call the strength of attraction toward the origin "gravity".
  const { gravity: attraction, sphereRadius: radius, ...grainUniforms } = physicsUniforms;
  radius.value = sphereRadius;
  const uniforms = {
    ...grainUniforms, attraction,
    positions: { value: start }, velocities: { value: speed }, contacts: { value: contacts.texture },
    center: { value: new Vector3() },
    dt: { value: 0 }, radius,
  };
  const common = { glslVersion: GLSL3, depthTest: false, depthWrite: false, toneMapped: false };
  const scatterGeometry = new InstancedBufferGeometry();
  scatterGeometry.instanceCount = 2;
  const scatter = new Points(scatterGeometry, new RawShaderMaterial({
    ...common, uniforms: { positions: uniforms.positions }, vertexShader: precision + scatterVertex,
    fragmentShader: precision + scatterFragment, blending: NoBlending,
  }));
  scatter.geometry.setAttribute('position', new BufferAttribute(Uint16Array.from({ length: GRAIN_COUNT }, (_, id) => id), 1));
  scatter.frustumCulled = false;
  const laser = createSandLaser(seed, uniforms.positions, scatter.geometry.attributes.position);
  uniforms.impactPoint = laser.impactPoint;
  uniforms.laserAxis = laser.axis;
  uniforms.firing = { value: false };
  const screen = new Mesh(new BufferGeometry(), new RawShaderMaterial({
    ...common, uniforms, vertexShader: precision + screenVertex, fragmentShader: precision + stepFragment, blending: NoBlending,
  }));
  screen.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1,-1,3,-1,-1,3]), 2));
  screen.frustumCulled = false;
  const camera = new Camera(), originalColor = new Color();
  let next = 0;
  return {
    positions: uniforms.positions,
    beam: laser.beam,
    grainRadius(id) { return GRAIN_RADIUS + GRAIN_RADIUS_SPREAD * initial.velocities[4 * id + 3]; },
    configure(physics, laserSettings) {
      for (const [key, uniform] of Object.entries(physicsUniforms)) {
        uniform.value = physics[key] ?? fields.physics[key][1];
      }
      if (laserSettings) laser.configure(laserSettings);
    },
    step(dt, center) {
      uniforms.dt.value = dt;
      uniforms.center.value.copy(center);
      const target = renderer.getRenderTarget(), auto = renderer.autoClear;
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(originalColor);
      try {
        renderer.autoClear = false;
        renderer.setClearColor(0, 0);
        uniforms.firing.value = laser.step(dt, center, renderer, camera);
        renderer.setRenderTarget(contacts);
        renderer.clear(true, false, false);
        renderer.render(scatter, camera);
        const out = states[next];
        renderer.setRenderTarget(out);
        renderer.render(screen, camera);
        uniforms.positions.value = out.textures[0]; uniforms.velocities.value = out.textures[1];
        next = 1-next;
      } finally {
        renderer.setRenderTarget(target); renderer.setClearColor(originalColor, alpha); renderer.autoClear = auto;
      }
    },
    dispose() {
      laser.dispose();
      for (const item of [start, speed, contacts, ...states, scatter.geometry, scatter.material, screen.geometry, screen.material]) item.dispose();
    },
  };
}
