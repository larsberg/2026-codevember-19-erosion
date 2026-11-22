import {
  BufferAttribute, BufferGeometry, Camera, Color, DataTexture,
  FloatType, GLSL3, HalfFloatType, InstancedBufferGeometry, Mesh, NearestFilter, NoBlending, Points,
  RawShaderMaterial, RedFormat, RGBAFormat, UnsignedByteType, Vector3, WebGLRenderTarget,
} from 'three';
import { CORE_RADIUS, floorHeight, GRAIN_COUNT, GRAIN_RADIUS, GRAIN_RADIUS_SPREAD, seedSand, SIDE } from './erosion-field.js';
import { atlasWidth, atlasHeight, precision, scatterFragment, scatterVertex, screenVertex, stepFragment } from './sand-shaders.js';
import { fields } from './settings.js';
import { createSandLaser } from './sand-laser.js';

function dataTexture(data) {
  const tex = new DataTexture(data, SIDE, SIDE, RGBAFormat, FloatType);
  tex.needsUpdate = true;
  return tex;
}

export function createGpuSand(renderer, seed, sphereRadius = CORE_RADIUS, floorGap, onStrike) {
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
    throw new Error('Erosion needs WebGL 2 with floating-point render targets.');
  }
  const initial = seedSand(seed, sphereRadius, floorGap);
  const start = dataTexture(initial.positions), speed = dataTexture(initial.velocities);
  const cold = new DataTexture(new Uint8Array(GRAIN_COUNT), SIDE, SIDE, RedFormat, UnsignedByteType);
  cold.needsUpdate = true;
  const options = { type: HalfFloatType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false };
  const contacts = new WebGLRenderTarget(atlasWidth, atlasHeight, { ...options, type: UnsignedByteType });
  const states = [0,1].map(() => {
    const state = new WebGLRenderTarget(SIDE, SIDE, { ...options, count: 3 });
    state.textures[2].format = RedFormat;
    state.textures[2].type = UnsignedByteType;
    return state;
  });
  const physicsUniforms = Object.fromEntries(Object.entries(fields.physics).map(([key, [, initial]]) =>
    [key, { value: initial }]));
  // Older saves call the strength of attraction toward the origin "gravity".
  const { gravity: attraction, sphereRadius: radius, floorGap: gap, ...grainUniforms } = physicsUniforms;
  radius.value = sphereRadius;
  const uniforms = {
    ...grainUniforms, attraction,
    positions: { value: start }, velocities: { value: speed }, contacts: { value: contacts.texture },
    grainHeat: { value: cold },
    center: { value: new Vector3() },
    dt: { value: 0 }, radius, floorY: { value: floorHeight(sphereRadius, floorGap) },
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
  const laser = createSandLaser(seed, uniforms.positions, scatter.geometry.attributes.position, radius);
  uniforms.impactPoint = laser.impactPoint;
  uniforms.impactRow = laser.impactRow;
  uniforms.laserAxis = laser.axis;
  uniforms.firing = { value: false };
  const screen = new Mesh(new BufferGeometry(), new RawShaderMaterial({
    ...common, uniforms, vertexShader: precision + screenVertex, fragmentShader: precision + stepFragment, blending: NoBlending,
  }));
  screen.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1,-1,3,-1,-1,3]), 2));
  screen.frustumCulled = false;
  const camera = new Camera(), originalColor = new Color();
  const previousPositions = { value: start };
  let next = 0;
  return {
    positions: uniforms.positions, previousPositions, interpolation: { value: 0 }, floorY: uniforms.floorY,
    grainHeat: uniforms.grainHeat,
    aim: laser.aim, clearAim: laser.clearAim,
    beam: laser.beam,
    heat: laser.heat,
    grainRadius(id) { return GRAIN_RADIUS + GRAIN_RADIUS_SPREAD * initial.velocities[4 * id + 3]; },
    configure(physics, laserSettings, darkBeamColor) {
      for (const [key, uniform] of Object.entries(physicsUniforms)) {
        uniform.value = physics[key] ?? fields.physics[key][1];
      }
      uniforms.floorY.value = floorHeight(radius.value, gap.value);
      if (laserSettings) laser.configure(laserSettings, darkBeamColor);
    },
    step(dt, center) {
      uniforms.dt.value = dt;
      uniforms.center.value.copy(center);
      const target = renderer.getRenderTarget(), auto = renderer.autoClear, sort = renderer.sortObjects;
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(originalColor);
      try {
        // Each pass draws one object. Its position attribute contains IDs or clip-space XY.
        renderer.sortObjects = false;
        renderer.autoClear = false;
        renderer.setClearColor(0, 0);
        uniforms.firing.value = laser.step(dt, center, renderer, camera, onStrike);
        renderer.setRenderTarget(contacts);
        renderer.clear(true, false, false);
        renderer.render(scatter, camera);
        const out = states[next];
        renderer.setRenderTarget(out);
        renderer.render(screen, camera);
        previousPositions.value = uniforms.positions.value;
        uniforms.positions.value = out.textures[0]; uniforms.velocities.value = out.textures[1];
        uniforms.grainHeat.value = out.textures[2];
        next = 1-next;
      } finally {
        renderer.setRenderTarget(target); renderer.setClearColor(originalColor, alpha); renderer.autoClear = auto; renderer.sortObjects = sort;
      }
    },
    dispose() {
      laser.dispose();
      for (const item of [start, speed, cold, contacts, ...states, scatter.geometry, scatter.material, screen.geometry, screen.material]) item.dispose();
    },
  };
}
