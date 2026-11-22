import { Group, Vector3 } from 'three';
import { createPhysics } from './physics.js';
import { CORE_RADIUS, GRAIN_COUNT } from './erosion-field.js';
import { createGpuSand } from './gpu-sand.js';
import { createGrains } from './grains.js';
import { createBall } from './mirror.js';

export function createErosion(renderer, settings) {
  const seed = settings.generation.seed, root = new Group();
  let radius = settings.physics.sphereRadius ?? CORE_RADIUS;
  const gpu = createGpuSand(renderer, seed, radius, settings.physics.floorGap), grains = createGrains(gpu,seed);
  const ball = createBall(radius, gpu.heat);
  root.add(grains.root, grains.plan, ball, gpu.beam);
  const physics = createPhysics({ gravity: 0, friction: settings.physics.friction });
  const sphere = physics.addBody({ object: ball, body: { type: 'static' },
    shapes: [{ type: 'sphere', radius }] });
  const center = new Vector3().copy(sphere.body.getPosition());
  let time = 0;
  physics.onAfterStep(dt => {
    time += dt;
    gpu.step(dt, center);
  });
  gpu.configure(settings.physics, settings.laser);
  grains.configure(settings.drafting);
  return {
    root,
    get state() { return { time, seed, grains: GRAIN_COUNT, hulls: grains.hullCount, center: ball.position.toArray() }; },
    configure(value) {
      const nextRadius = value.physics.sphereRadius ?? CORE_RADIUS;
      if (nextRadius !== radius) {
        const shape = sphere.body.createSphere({ radius: nextRadius, density: 1, friction: value.physics.friction });
        const previousShape = sphere.shapes[0];
        sphere.shapes[0] = shape;
        previousShape.destroy();
        previousShape.delete();
        ball.scale.setScalar(nextRadius);
        radius = nextRadius;
      }
      physics.configure({ gravity: 0, friction: value.physics.friction });
      gpu.configure(value.physics, value.laser);
      grains.configure(value.drafting);
    },
    step(dt) {
      physics.step(dt);
      gpu.interpolation.value = physics.interpolation;
    },
    dispose() {
      root.removeFromParent();
      physics.dispose();
      grains.dispose();
      gpu.dispose();
      ball.geometry.dispose();
      ball.material.dispose();
    },
  };
}
