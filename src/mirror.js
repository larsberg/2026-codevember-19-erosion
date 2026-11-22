import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { CORE_RADIUS } from './erosion-field.js';

export function createBall(radius = CORE_RADIUS) {
  const ball = new Mesh(
    new SphereGeometry(1, 72, 48),
    new MeshStandardMaterial({ color: 0x383838, roughness: 0.6, metalness: 0 }),
  );
  ball.scale.setScalar(radius);
  ball.castShadow = true;
  ball.layers.enable(1);
  return ball;
}
