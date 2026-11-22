import { RedFormat, UnsignedByteType, Vector3 } from 'three';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createErosion } from '../src/erosion.js';
import { CORE_RADIUS, floorHeight, GRAIN_COUNT, GRAIN_RADIUS, GRAIN_RADIUS_SPREAD, seedSand } from '../src/erosion-field.js';
import { atlasHeight, atlasWidth } from '../src/sand-shaders.js';
import { initPhysics } from '../src/physics.js';
import { defaultSetup, validateSetup } from '../src/settings.js';

test('one seed fills the volume around the ball with a fixed population of resting grains', () => {
  const field = seedSand(19);
  assert.deepEqual(field, seedSand(19));
  assert.notDeepEqual(field.positions.subarray(0,16), seedSand(20).positions.subarray(0,16));
  assert.equal(field.positions.length, GRAIN_COUNT * 4);
  assert.equal(field.velocities.length, field.positions.length);
  const octants = Array(8).fill(0);
  for (let k = 0; k < GRAIN_COUNT * 4; k += 4) {
    const [x,y,z] = field.positions.subarray(k,k+3);
    assert.ok(Math.hypot(x,y,z) > CORE_RADIUS);
    assert.equal(field.velocities[k],0);
    assert.equal(field.velocities[k+2],0);
    assert.equal(field.velocities[k+1],0);
    assert.ok(y - (GRAIN_RADIUS + GRAIN_RADIUS_SPREAD) >= floorHeight(CORE_RADIUS));
    octants[(x > 0 ? 1 : 0) + (y > 0 ? 2 : 0) + (z > 0 ? 4 : 0)]++;
    assert.ok(Math.abs(field.velocities[k+3]) <= 1);
  }
  const largest = seedSand(19, 2.5, .05);
  for (let i = 0; i < largest.positions.length; i += 4) {
    assert.ok(Math.hypot(...largest.positions.subarray(i, i + 3)) > 2.5);
    assert.ok(largest.positions[i + 1] >= floorHeight(2.5, .05) + GRAIN_RADIUS + GRAIN_RADIUS_SPREAD);
  }
  // The raised floor clips the lower hemisphere. Both halves still fill all four quadrants.
  for (const half of [[0, 1, 4, 5], [2, 3, 6, 7]]) {
    const total = half.reduce((n, i) => n + octants[i], 0);
    assert.ok(total > GRAIN_COUNT * .2);
    assert.ok(half.every(i => octants[i] > total * .2));
  }
  assert.equal(validateSetup({ camera: { yaw: 58 } }).generation.seed, 19);
  assert.throws(() => validateSetup({ sketch: '18-pendulum' }));
});

test('the fixed Box3D sphere supplies the collision center while one indexed batch renders all six minerals', async () => {
  await initPhysics();
  let target = null, passes = 0, lastGrainTexture, lastHeatTexture, hitTexture, hitRow;
  const shots = [], impulses = [];
  const renderer = {
    extensions: { has: () => true }, autoClear: true,
    getRenderTarget: () => target, setRenderTarget(value) { target=value; },
    getClearColor: color => color.set(0), getClearAlpha: () => 1, setClearColor() {}, clear() {},
    render(object) {
      if (target.width === 1) {
        assert.ok(object.isPoints && target.depthBuffer && target.scissorTest);
        hitRow = shots.length % target.height;
        assert.deepEqual(target.viewport.toArray(), [0, hitRow, 1, 1]);
        assert.deepEqual(target.scissor.toArray(), target.viewport.toArray());
        assert.equal(object.material.uniforms.positions.value, lastGrainTexture);
        hitTexture = target.texture;
        shots.push(object.material.uniforms.axis.value.toArray());
        return;
      }
      if (passes%2 === 0) {
        assert.ok(object.isPoints);
        assert.equal(target.width, atlasWidth);
        assert.equal(target.height, atlasHeight);
        assert.equal(object.geometry.attributes.position.count, GRAIN_COUNT);
        assert.equal(object.geometry.instanceCount, 2);
      } else {
        assert.ok(object.isMesh && target.textures.length === 3);
        assert.equal(target.textures[2].format, RedFormat);
        assert.equal(target.textures[2].type, UnsignedByteType);
        assert.equal(object.material.uniforms.grainHeat.value, lastHeatTexture);
        assert.notEqual(lastHeatTexture, target.textures[2]);
        lastHeatTexture = target.textures[2];
        assert.ok(object.material.uniforms.center.value.distanceTo(core.position) < 1e-6);
        assert.equal(object.material.uniforms.radius.value, core.geometry.parameters.radius * core.scale.x);
        if (object.material.uniforms.firing.value) {
          assert.equal(object.material.uniforms.impactPoint.value, hitTexture);
          assert.equal(object.material.uniforms.impactRow.value, hitRow);
          impulses.push(object.material.uniforms.laserAxis.value.toArray());
        }
        lastGrainTexture = target.textures[0];
      }
      passes++;
    },
  };
  const setup = defaultSetup();
  const sketch = createErosion(renderer,setup);
  const grains = sketch.root.children[0];
  const core = sketch.root.children.find(o => o.isMesh && o.geometry.type === 'SphereGeometry');
  try {
    assert.ok(grains.isMesh && grains.geometry.isInstancedBufferGeometry);
    assert.equal(grains.geometry.groups.length, 0);
    assert.ok(grains.geometry.index);
    const batch = grains.geometry.getAttribute('grainBatch'), ranges = new Map();
    for (let i = 0; i < batch.count; i++) ranges.set(batch.getY(i), [batch.getX(i), batch.getZ(i)]);
    assert.equal(ranges.size, 6);
    assert.equal(new Set([...ranges.values()].map(([, roughness]) => roughness)).size, 6);
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    grains.material.onBeforeCompile(shader);
    lastHeatTexture = shader.uniforms.grainHeat.value;
    assert.deepEqual(lastHeatTexture.image.data, new Uint8Array(GRAIN_COUNT));
    const normalMaterial = grains.userData.aoNormalMaterial;
    assert.ok(grains.layers.isEnabled(1));
    assert.ok(normalMaterial.isMeshNormalMaterial && normalMaterial.flatShading);
    assert.equal(normalMaterial.allowOverride, false);
    const normalShader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    normalMaterial.onBeforeCompile(normalShader);
    for (const key of ['grainPositions', 'previousPositions', 'interpolation']) {
      assert.equal(normalShader.uniforms[key], shader.uniforms[key]);
    }
    const { velocities } = seedSand(setup.generation.seed);
    let total = 0;
    for (const [first, [kind]] of ranges) {
      const count = Math.floor((kind + 1) * GRAIN_COUNT / 6) - first;
      const pose = grains.geometry.getAttribute('pose' + kind);
      assert.equal(first, total);
      assert.ok(count <= grains.geometry.instanceCount);
      total += count;
      const scalePerRadius = [first, total - 1].map(i =>
        (pose.getX(i - first)**2 + pose.getY(i - first)**2 + pose.getZ(i - first)**2 + pose.getW(i - first)**2)
        / (GRAIN_RADIUS + GRAIN_RADIUS_SPREAD * velocities[4 * i + 3]));
      assert.ok(Math.abs(scalePerRadius[0] - scalePerRadius[1]) < 1e-5);
    }
    assert.equal(total, GRAIN_COUNT);
    assert.ok(core.material.isMeshStandardMaterial);
    assert.equal(core.material.envMap, null);
    assert.equal(core.geometry.parameters.radius * core.scale.x, 0.775);
    const start = core.position.toArray();
    assert.deepEqual(start, [0,0,0]);
    for (let i=0; i<120; i++) sketch.step(1/60);
    assert.equal(passes,160);
    assert.ok(Math.abs(sketch.state.time-2)<1e-8);
    assert.deepEqual(sketch.state.center, start);
    assert.equal(renderer.getRenderTarget(),null);
    assert.equal(shader.uniforms.grainPositions.value, lastGrainTexture);
    assert.equal(shader.uniforms.grainHeat.value, lastHeatTexture);
    assert.notEqual(shader.uniforms.previousPositions.value, lastGrainTexture);
    sketch.step(1 / 120);
    assert.ok(Math.abs(shader.uniforms.interpolation.value - 1 / 3) < 1e-6);
    const beam = sketch.root.children.find(o => o.material?.uniforms?.brightness);
    assert.ok(beam.isLine);
    assert.equal(beam.geometry.attributes.position.count, 2);
    assert.equal(beam.visible, false);
    for (let i = 120; i < Math.ceil(40 / setup.laser.frequency) * 1.5; i++) sketch.step(1/60);
    assert.equal(shots.length, 1);
    assert.deepEqual(impulses, shots);
    assert.equal(beam.visible, true);
    assert.equal(beam.material.uniforms.impactPoint.value, hitTexture);
    const sphereShader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
    core.material.onBeforeCompile(sphereShader);
    const heat = sphereShader.uniforms.heatSpots.value;
    assert.equal(sphereShader.uniforms.heatHits.value, hitTexture);
    assert.equal(heat[hitRow].w, 1);
    sketch.step(0);
    assert.equal(beam.material.uniforms.brightness.value, 1);
    for (let i = 0; i < 12; i++) sketch.step(1/60);
    assert.equal(beam.visible, false);
    assert.ok(heat[hitRow].w > 0 && heat[hitRow].w < 1);
    for (let i = 0; i < 48; i++) sketch.step(1/60);
    assert.equal(heat[hitRow].w, 0);
    for (let i = 0; i < 192; i++) sketch.step(1/60);
    assert.equal(shots.length, 2);
    assert.notDeepEqual(shots[0], shots[1]);
    assert.deepEqual(impulses, shots);
    const before = sketch.state;
    sketch.step(0);
    assert.deepEqual(sketch.state,before);
    sketch.configure({ ...setup, laser: { ...setup.laser, frequency: 3 } });
    for (let i = 0; i < 60; i++) sketch.step(1/60);
    assert.ok(heat.filter(spot => spot.w > 0).length >= 2);
  } finally { sketch.dispose(); }
});

test('live physics and laser controls survive a rebuild and accept older saves', async () => {
  await initPhysics();
  const defaults = defaultSetup();
  const legacy = validateSetup({ physics: { gravity: 4, friction: .7 } });
  assert.deepEqual(legacy.physics, { ...defaults.physics, gravity: 4, friction: .7 });
  assert.deepEqual(legacy.laser, defaults.laser);
  assert.equal(validateSetup({ studio: { shadowOpacity: .25 } }).drafting.planOpacity, .1);

  const setup = validateSetup({
    physics: { sphereRadius: 1.6, floorGap: .35, damping: 2.5, restitution: .6, stiffness: .75, settleSpeed: .12, rotationScale: 0 },
    laser: { frequency: 2, color: '#364dff' },
    drafting: { gridOpacity: 0, gridDivisions: 48, planOpacity: .62, planColor: '#314568',
      pointSize: 3, samplePercent: 25, slice: true, sliceHeight: 1.5, sliceThickness: .4 },
  });
  let target, physics, shots = 0;
  const renderer = {
    extensions: { has: () => true }, autoClear: true,
    getRenderTarget: () => target, setRenderTarget(value) { target = value; },
    getClearColor: color => color.set(0), getClearAlpha: () => 1, setClearColor() {}, clear() {},
    render(object) {
      if (target.width === 1) shots++;
      if (object.isMesh) physics = object.material.uniforms;
    },
  };
  for (const initial of [legacy, setup]) {
    const sketch = createErosion(renderer, initial);
    const ball = sketch.root.children.find(child => child.geometry?.type === 'SphereGeometry');
    const beam = sketch.root.children.find(child => child.material?.uniforms?.beamColor);
    const tick = n => { for (let i = 0; i < n; i++) sketch.step(1/60); };
    try {
      assert.equal(beam.material.uniforms.beamColor.value.getHexString(), initial.laser.color.slice(1));
      assert.equal(ball.scale.x * ball.geometry.parameters.radius, initial.physics.sphereRadius);
      if (initial === legacy) sketch.configure(setup);
      const plan = sketch.root.children.find(child => child.isPoints);
      assert.equal(plan.material.uniforms.ink.value.getHexString(), '314568');
      assert.equal(plan.material.uniforms.pointSize.value, 3);
      assert.equal(plan.geometry.drawRange.count, GRAIN_COUNT / 4);
      assert.equal(new Set(plan.geometry.attributes.position.array).size, GRAIN_COUNT);
      assert.equal(plan.material.uniforms.opacity.value, .62);
      assert.equal(plan.material.uniforms.sliceHeight.value, 1.5);
      assert.equal(plan.material.uniforms.halfThickness.value, .2);
      sketch.configure({ ...setup, drafting: { ...setup.drafting, planOpacity: 0, slice: false } });
      assert.equal(plan.visible, false);
      assert.equal(plan.material.uniforms.halfThickness.value, -1);
      sketch.configure({ ...setup, drafting: { ...setup.drafting, samplePercent: 0 } });
      assert.equal(plan.visible, false);
      sketch.configure(setup);
      assert.equal(plan.visible, true);
      shots = 0;
      tick(15);
      assert.equal(physics.radius.value, 1.6);
      assert.equal(physics.floorY.value, floorHeight(1.6, setup.physics.floorGap));
      assert.equal(plan.material.uniforms.floorY, physics.floorY);
      sketch.configure({ ...setup, physics: { ...setup.physics, floorGap: .05 } });
      assert.equal(physics.floorY.value, floorHeight(1.6, .05));
      assert.equal(plan.material.uniforms.floorY.value, physics.floorY.value);
      assert.equal(ball.scale.x * ball.geometry.parameters.radius, 1.6);
      for (const key of ['damping', 'restitution', 'stiffness', 'settleSpeed', 'rotationScale']) {
        assert.equal(physics[key].value, setup.physics[key]);
      }
      const slower = { ...setup, laser: { frequency: 1, color: '#ff00cc' } };
      sketch.configure(slower);
      tick(29);
      assert.equal(shots, 0);
      tick(1);
      assert.equal(shots, 1);
      assert.equal(beam.visible, true);
      assert.equal(beam.material.uniforms.beamColor.value.getHexString(), 'ff00cc');
      sketch.configure({ ...setup, laser: { ...setup.laser, frequency: 0 } });
      assert.equal(beam.visible, false);
      tick(120);
      assert.equal(shots, 1);
      const aim = new Vector3(.6, 0, .8);
      sketch.aim(aim, new Vector3(0, 0, 1));
      tick(2);
      assert.equal(shots, 2);
      assert.deepEqual(physics.laserAxis.value.toArray(), aim.toArray());
      assert.ok(physics.firing.value && beam.visible);
      tick(120);
      assert.equal(shots, 2);
      sketch.configure(setup);
      tick(60);
      assert.equal(shots, 4);
      sketch.configure(defaults);
      assert.equal(plan.geometry.drawRange.count, GRAIN_COUNT);
      assert.equal(plan.material.uniforms.pointSize.value, 1);
      assert.equal(plan.material.uniforms.ink.value.getHexString(), defaults.drafting.planColor.slice(1));
      tick(2);
      assert.equal(physics.radius.value, CORE_RADIUS);
      assert.equal(physics.floorY.value, floorHeight(CORE_RADIUS));
      assert.equal(ball.scale.x * ball.geometry.parameters.radius, CORE_RADIUS);
      assert.equal(physics.damping.value, 0);
      assert.equal(physics.rotationScale.value, 10);
      assert.equal(beam.material.uniforms.beamColor.value.getHexString(), defaults.laser.color.slice(1));
    } finally { sketch.dispose(); }
  }
});
