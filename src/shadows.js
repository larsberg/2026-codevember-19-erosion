import { Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';

export function createStageFloor(span) {
  // Stock lit material: cone attenuation, distance falloff, surface shading
  // and cast shadows all come from Three's actual scene lights.
  const material = new MeshStandardMaterial({ name:'Matte stage floor',
    color:'#8a8a8a', roughness:1, metalness:0, envMapIntensity:0 });
  const floor = new Mesh(new PlaneGeometry(span, span), material);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  return floor;
}

export function createShadowFollow(light, getOffset = () => new Vector3(-8, 24, 12)) {
  const offset = new Vector3(-8, 24, 12), forward = offset.clone().normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), forward).normalize();
  const up = new Vector3().crossVectors(forward, right), anchor = new Vector3();
  return position => {
    offset.copy(getOffset()); forward.copy(offset).normalize();
    right.crossVectors(new Vector3(0, 1, 0), forward);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0); else right.normalize();
    up.crossVectors(forward, right); anchor.copy(position);
    const { camera, mapSize } = light.shadow;
    const dx = (camera.right - camera.left) / (camera.zoom * mapSize.x);
    const dy = (camera.top - camera.bottom) / (camera.zoom * mapSize.y);
    // Keep the shadow texel grid fixed in world space as the camera follows.
    // Otherwise every tiny camera movement resamples the cast silhouette.
    light.target.position.copy(right).multiplyScalar(Math.round(anchor.dot(right) / dx) * dx)
      .addScaledVector(up, Math.round(anchor.dot(up) / dy) * dy)
      .addScaledVector(forward, anchor.dot(forward));
    light.position.copy(light.target.position).add(offset);
  };
}
