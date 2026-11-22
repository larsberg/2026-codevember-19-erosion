import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyCameraView, captureCameraView } from '../src/camera.js';
import { validateSetup } from '../src/settings.js';

test('camera limits clamp the live orbit and survive view capture and reload', () => {
  const camera = new PerspectiveCamera(42, 1, .1, 900);
  const orbit = new OrbitControls(camera), focus = new Vector3();
  const legacy = validateSetup({ camera: { distance: 24 } }).camera;
  assert.deepEqual([legacy.minDistance, legacy.maxDistance, legacy.distance], [5, 600, 24]);

  const view = validateSetup({ camera: { minDistance: .5, maxDistance: 1600 } }).camera;
  applyCameraView(view, camera, orbit, focus);
  for (const [requested, expected] of [[.2, .5], [2000, 1600]]) {
    camera.position.set(0, 0, requested);
    orbit.update();
    assert.equal(orbit.getDistance(), expected);
    const saved = validateSetup({ camera: captureCameraView(camera, orbit, focus) }).camera;
    assert.deepEqual([saved.minDistance, saved.maxDistance, saved.distance], [.5, 1600, expected]);
  }
  assert.ok(camera.far > orbit.maxDistance);
  const tight = validateSetup({ camera: { ...view, distance: 16, maxDistance: 2 } }).camera;
  applyCameraView(tight, camera, orbit, focus);
  assert.ok(Math.abs(orbit.getDistance() - 2) < 1e-9);
  assert.equal(camera.far, 900);
  assert.throws(() => validateSetup({ camera: { minDistance: 10, maxDistance: 1 } }));
});
