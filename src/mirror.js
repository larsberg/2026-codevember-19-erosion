import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { CORE_RADIUS } from './erosion-field.js';

export function createBall(radius = CORE_RADIUS, heat) {
  const ball = new Mesh(
    new SphereGeometry(1, 72, 48),
    new MeshStandardMaterial({ color: 0x383838, roughness: 0.6, metalness: 0 }),
  );
  if (heat) {
    ball.material.onBeforeCompile = shader => {
      shader.uniforms.heatHits = heat.impactPoint;
      shader.uniforms.heatSpots = heat.spots;
      shader.uniforms.sphereCenter = heat.sphereCenter;
      shader.uniforms.sphereRadius = heat.sphereRadius;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 surfaceDirection;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nsurfaceDirection = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 surfaceDirection;
          uniform sampler2D heatHits;
          uniform vec3 sphereCenter;
          uniform float sphereRadius;
          uniform vec4 heatSpots[${heat.spots.value.length}];`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec3 surface = normalize(surfaceDirection);
          float width = clamp(.21 / sphereRadius, .09, .38);
          for (int i = 0; i < ${heat.spots.value.length}; ++i) {
            float life = heatSpots[i].w;
            if (life <= 0.) continue;
            vec4 hit = texelFetch(heatHits, ivec2(0, i), 0);
            vec3 direction = hit.w > .5 ? normalize(hit.xyz - sphereCenter) : heatSpots[i].xyz;
            vec3 delta = surface - direction;
            float warmth = life * life * exp(-2. * dot(delta, delta) / (width * width));
            vec3 ember = mix(vec3(2.2, .09, .008), vec3(4., 1.6, .3), warmth);
            totalEmissiveRadiance += warmth * ember;
          }`);
    };
  }
  ball.scale.setScalar(radius);
  ball.castShadow = true;
  ball.layers.enable(1);
  return ball;
}
