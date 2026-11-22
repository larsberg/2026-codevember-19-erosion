import { Group, Vector3 } from 'three';
import { createPhysics } from './physics.js';
import { CORE_RADIUS, FLOOR_Y, GRAIN_COUNT } from './erosion-field.js';
import { createGpuSand } from './gpu-sand.js';
import { createGrains } from './grains.js';
import { createBall } from './mirror.js';

export function createErosion(renderer, settings) {
  const seed = settings.generation.seed, root = new Group();
  let radius = settings.physics.sphereRadius ?? CORE_RADIUS;
  const gpu = createGpuSand(renderer,seed,radius), grains = createGrains(gpu,seed);
  const ball = createBall(radius);
  root.add(grains.root, grains.plan, ball, gpu.beam);
  const physics = createPhysics({ gravity: 0, friction: settings.physics.friction });
  const sphere = physics.addBody({ object: ball, body: { type: 'static' },
    shapes: [{ type: 'sphere', radius }] });
  const center = new Vector3().copy(sphere.body.getPosition());
  const audioPositions = new Float64Array(48);
  let time = 0, cycle = 0;
  physics.onAfterStep(dt => {
    time += dt;
    gpu.step(dt, center);
  });
  gpu.configure(settings.physics, settings.laser);
  return {
    root,
    get state() { return { time, seed, grains: GRAIN_COUNT, hulls: grains.root.children.length, center: ball.position.toArray() }; },
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
      grains.configure(value.studio.shadowOpacity);
    },
    step(dt, tempo, audio) {
      const before = time;
      physics.step(dt);
      const elapsed = time-before;
      const duration = 240/tempo, end = cycle + elapsed/duration;
      const events = [];
      for (let serial = Math.floor(cycle); elapsed > 0 && serial < end; serial++) {
        const from = cycle<=serial ? -1e-9 : cycle-serial;
        events.push({ serial, from, to: Math.min(1,end-serial), duration });
      }
      cycle=end;
      for (let i=0; i<16; i++) {
        const angle = 2*Math.PI*i/16;
        audioPositions[3*i] = center.x+radius*Math.cos(angle);
        audioPositions[3*i+1] = center.y+.55*Math.sin(angle+.7*time);
        audioPositions[3*i+2] = center.z+radius*Math.sin(angle);
      }
      audio.update(elapsed,true,audioPositions,FLOOR_Y,events);
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
