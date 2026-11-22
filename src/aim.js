import { Raycaster, Sphere, Vector2, Vector3 } from 'three';

// Intersect the mathematical sphere even when a layer of grains covers it.
export function bindSphereAim(canvas, camera, getSphere, fire) {
  const pointers = new Set(), ray = new Raycaster(), ndc = new Vector2();
  const sphere = new Sphere(), hit = new Vector3(), sight = new Vector3();
  let press;
  function down(e) {
    pointers.add(e.pointerId);
    if (pointers.size !== 1 || e.button !== 0 || !e.isPrimary || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      press = undefined;
      return;
    }
    press = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function moved(e) {
    if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press = undefined;
  }
  function up(e) {
    moved(e);
    pointers.delete(e.pointerId);
    if (press?.id !== e.pointerId) return;
    press = undefined;
    const rect = canvas.getBoundingClientRect();
    ndc.set(2 * (e.clientX - rect.left) / rect.width - 1, 1 - 2 * (e.clientY - rect.top) / rect.height);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return;
    getSphere(sphere);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectSphere(sphere, hit)) {
      fire(hit.sub(sphere.center).normalize(), sight.copy(ray.ray.direction).negate());
    }
  }
  function cancel(e) {
    pointers.delete(e.pointerId);
    if (e.pointerId === press?.id) press = undefined;
  }
  // Capture up before OrbitControls releases pointer capture. It owns dragging and pinching.
  const events = { pointerdown: down, pointermove: moved, pointerup: up, pointercancel: cancel, lostpointercapture: cancel };
  for (const [name, fn] of Object.entries(events)) canvas.addEventListener(name, fn, true);
  return () => { for (const [name, fn] of Object.entries(events)) canvas.removeEventListener(name, fn, true); };
}
