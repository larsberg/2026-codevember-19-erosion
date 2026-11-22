import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4, Vector3 } from 'three';
import { createErosion } from '../src/erosion.js';
import { CORE_RADIUS, FLOOR_Y, GRAIN_COUNT, GRAIN_RADIUS, GRAIN_RADIUS_SPREAD, seedSand } from '../src/erosion-field.js';
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
    assert.ok(y > FLOOR_Y);
    octants[(x > 0 ? 1 : 0) + (y > 0 ? 2 : 0) + (z > 0 ? 4 : 0)]++;
    assert.ok(Math.abs(field.velocities[k+3]) <= 1);
  }
  const largest = seedSand(19, 2.5);
  for (let i = 0; i < largest.positions.length; i += 4) {
    assert.ok(Math.hypot(...largest.positions.subarray(i, i + 3)) > 2.5);
  }
  assert.ok(octants.every(count => count > GRAIN_COUNT * .08));
  assert.equal(validateSetup({ camera: { yaw: 58 } }).generation.seed, 19);
  assert.throws(() => validateSetup({ sketch: '18-pendulum' }));
});

test('the fixed Box3D sphere supplies the collision center while all six grain batches advance', async () => {
  await initPhysics();
  let target = null, passes = 0, lastGrainTexture, hitTexture;
  const shots = [], impulses = [];
  const renderer = {
    extensions: { has: () => true }, autoClear: true,
    getRenderTarget: () => target, setRenderTarget(value) { target=value; },
    getClearColor: color => color.set(0), getClearAlpha: () => 1, setClearColor() {}, clear() {},
    render(object) {
      if (target.width === 1) {
        assert.ok(object.isPoints && target.height === 1 && target.depthBuffer);
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
        assert.ok(object.isMesh && target.textures.length === 2);
        assert.ok(object.material.uniforms.center.value.distanceTo(core.position) < 1e-6);
        assert.equal(object.material.uniforms.radius.value, core.geometry.parameters.radius * core.scale.x);
        if (object.material.uniforms.firing.value) {
          assert.equal(object.material.uniforms.impactPoint.value, hitTexture);
          impulses.push(object.material.uniforms.laserAxis.value.toArray());
        }
        lastGrainTexture = target.textures[0];
      }
      passes++;
    },
  };
  const setup = defaultSetup();
  const sketch = createErosion(renderer,setup);
  const grains = sketch.root.children[0].children;
  const core = sketch.root.children.find(o => o.isMesh && o.geometry.type === 'SphereGeometry');
  const audioEvents = [];
  const audio = { update(dt, playing, xyz, floor, events) { audioEvents.push(...events); } };
  try {
    assert.equal(grains.reduce((n,mesh) => n + mesh.count,0), GRAIN_COUNT);
    assert.equal(new Set(grains.map(mesh => mesh.material.roughness)).size, grains.length);
    const { velocities } = seedSand(setup.generation.seed);
    const matrix = new Matrix4(), scale = new Vector3();
    let first = 0;
    for (const mesh of grains) {
      const scalePerRadius = [0, mesh.count - 1].map(i => {
        mesh.getMatrixAt(i, matrix);
        const radius = GRAIN_RADIUS + GRAIN_RADIUS_SPREAD * velocities[4 * (first + i) + 3];
        return scale.setFromMatrixScale(matrix).x / radius;
      });
      assert.ok(Math.abs(scalePerRadius[0] - scalePerRadius[1]) < 1e-5);
      first += mesh.count;
    }
    assert.ok(core.material.isMeshStandardMaterial);
    assert.equal(core.material.envMap, null);
    assert.equal(core.geometry.parameters.radius * core.scale.x, 0.775);
    const start = core.position.toArray();
    assert.deepEqual(start, [0,0,0]);
    for (let i=0; i<120; i++) sketch.step(1/60,80,audio);
    assert.equal(passes,240);
    assert.ok(Math.abs(sketch.state.time-2)<1e-8);
    assert.deepEqual(sketch.state.center, start);
    assert.ok(audioEvents.length>0 && audioEvents.at(-1).to>0);
    assert.equal(renderer.getRenderTarget(),null);
    for (const mesh of grains) {
      const shader = { uniforms:{}, vertexShader:'#include <common>' };
      mesh.material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.grainPositions.value,lastGrainTexture);
    }
    const beam = sketch.root.children.find(o => o.material?.uniforms?.brightness);
    assert.equal(beam.visible, false);
    for (let i = 120; i < Math.round(60 / setup.laser.frequency); i++) sketch.step(1/60,80,audio);
    assert.equal(shots.length, 1);
    assert.deepEqual(impulses, shots);
    assert.equal(beam.visible, true);
    assert.equal(beam.material.uniforms.impactPoint.value, hitTexture);
    sketch.step(0,80,audio);
    assert.equal(beam.material.uniforms.brightness.value, 1);
    for (let i = 0; i < 12; i++) sketch.step(1/60,80,audio);
    assert.equal(beam.visible, false);
    for (let i = 0; i < 240; i++) sketch.step(1/60,80,audio);
    assert.equal(shots.length, 2);
    assert.notDeepEqual(shots[0], shots[1]);
    assert.deepEqual(impulses, shots);
    const before = sketch.state;
    sketch.step(0,80,audio);
    assert.deepEqual(sketch.state,before);
  } finally { sketch.dispose(); }
});

test('live physics and laser controls survive a rebuild and accept older saves', async () => {
  await initPhysics();
  const defaults = defaultSetup();
  const legacy = validateSetup({ physics: { gravity: 4, friction: .7 } });
  assert.deepEqual(legacy.physics, { ...defaults.physics, gravity: 4, friction: .7 });
  assert.deepEqual(legacy.laser, defaults.laser);

  const setup = validateSetup({
    physics: { sphereRadius: 1.6, damping: 2.5, restitution: .6, stiffness: .75, settleSpeed: .12 },
    laser: { frequency: 2, color: '#364dff' },
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
  const audio = { update() {} };
  for (const initial of [legacy, setup]) {
    const sketch = createErosion(renderer, initial);
    const ball = sketch.root.children.find(child => child.geometry?.type === 'SphereGeometry');
    const beam = sketch.root.children.find(child => child.material?.uniforms?.beamColor);
    const tick = n => { for (let i = 0; i < n; i++) sketch.step(1/60, 80, audio); };
    try {
      assert.equal(beam.material.uniforms.beamColor.value.getHexString(), initial.laser.color.slice(1));
      assert.equal(ball.scale.x * ball.geometry.parameters.radius, initial.physics.sphereRadius);
      if (initial === legacy) sketch.configure(setup);
      shots = 0;
      tick(15);
      assert.equal(physics.radius.value, 1.6);
      assert.equal(ball.scale.x * ball.geometry.parameters.radius, 1.6);
      for (const key of ['damping', 'restitution', 'stiffness', 'settleSpeed']) {
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
      sketch.configure(setup);
      tick(60);
      assert.equal(shots, 3);
      sketch.configure(defaults);
      tick(1);
      assert.equal(physics.radius.value, CORE_RADIUS);
      assert.equal(ball.scale.x * ball.geometry.parameters.radius, CORE_RADIUS);
      assert.equal(physics.damping.value, 0);
      assert.equal(beam.material.uniforms.beamColor.value.getHexString(), defaults.laser.color.slice(1));
    } finally { sketch.dispose(); }
  }
});
