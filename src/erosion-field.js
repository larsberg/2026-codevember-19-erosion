import { randomSource } from './random.js';

export const SIDE = 256;
export const GRAIN_COUNT = SIDE * SIDE;
export const CORE_RADIUS = 0.775;
export const GRAIN_RADIUS = 0.020;
export const GRAIN_RADIUS_SPREAD = 0.004;
export const DEFAULT_FLOOR_GAP = .2;

export function floorHeight(sphereRadius, gap = DEFAULT_FLOOR_GAP) {
  return -sphereRadius - gap;
}

// Sample the air around the ball once. Each state texel owns one grain until reset.
export function seedSand(seed, sphereRadius = CORE_RADIUS, floorGap = DEFAULT_FLOOR_GAP) {
  const random = randomSource(seed);
  const positions = new Float32Array(GRAIN_COUNT * 4);
  const velocities = new Float32Array(positions.length);
  const clearance = .06;
  const minY = Math.max(-3.4, floorHeight(sphereRadius, floorGap) + clearance);
  for (let k = 0; k < positions.length; k += 4) {
    let x, y, z;
    do {
      x = (2*random() - 1) * 5.4;
      y = minY + random() * (3.4 - minY);
      z = (2*random() - 1) * 4.6;
    } while ((x/5.4)**2 + (y/3.4)**2 + (z/4.6)**2 > 1 ||
             x*x + y*y + z*z < (sphereRadius + clearance)**2);
    positions[k] = x;
    positions[k+1] = y;
    positions[k+2] = z;
    positions[k+3] = random() * 2 * Math.PI;
    // XYZ velocity starts at zero. W is a permanent per-grain variation.
    velocities[k+3] = 2*random() - 1;
  }
  return { positions, velocities };
}
