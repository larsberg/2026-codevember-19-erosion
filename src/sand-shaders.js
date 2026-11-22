import { FLOOR_Y, GRAIN_RADIUS, GRAIN_RADIUS_SPREAD, SIDE } from './erosion-field.js';

export const precision = `precision highp float;
precision highp int;
precision highp sampler2D;
`;
const cells = 64;
export const atlasWidth = cells * 8 * 2, atlasHeight = cells * 8;
const grid = `
const float maxRadius = ${GRAIN_RADIUS + GRAIN_RADIUS_SPREAD};
const float contactSkin = .0015;
const float cellSize = 2. * maxRadius + contactSkin;
ivec3 cellAt(vec3 p) { return ivec3(floor(p / cellSize)); }
ivec2 atlas(ivec3 cell, int lane) {
  ivec3 c = cell & ivec3(${cells - 1});
  return ivec2((c.y % 8) * ${cells} + c.x + lane * ${atlasWidth / 2}, (c.y / 8) * ${cells} + c.z);
}
`;

// Each cell keeps up to two actual grain IDs. Distant cells share slots, so
// the contact pass always checks the grains' world-space separation.
export const scatterVertex = grid + `
in float position;
uniform sampler2D positions;
flat out vec2 grainId;
void main() {
  // Opposite draw orders retain the first and last grain in each occupied cell.
  int lane = gl_InstanceID;
  int id = lane == 0 ? int(position) : ${SIDE*SIDE - 1} - int(position);
  ivec2 texel = ivec2(id % ${SIDE}, id / ${SIDE});
  vec3 p = texelFetch(positions, texel, 0).xyz;
  ivec2 slot = atlas(cellAt(p), lane);
  gl_Position = vec4((vec2(slot) + .5) * 2. / vec2(${atlasWidth}., ${atlasHeight}.) - 1., 0., 1.);
  gl_PointSize = 1.;
  grainId = vec2(texel) / 255.;
}`;
export const scatterFragment = `flat in vec2 grainId;
out vec4 record;
void main() { record = vec4(grainId, 1., 1.); }`;
export const screenVertex = `in vec2 position;
void main() { gl_Position=vec4(position,0.,1.); }`;

export const stepFragment = grid + `
uniform sampler2D positions, velocities, contacts;
uniform vec3 center, laserAxis;
uniform sampler2D impactPoint;
uniform bool firing;
uniform float dt, attraction, friction, radius, damping, restitution, stiffness, settleSpeed;
layout(location=0) out vec4 nextPosition;
layout(location=1) out vec4 nextVelocity;

float contactRadius(float state) {
  float variation = state > 2. ? state - 4. : state;
  return ${GRAIN_RADIUS} + ${GRAIN_RADIUS_SPREAD} * variation;
}

// An ellipsoidal patch limits excavation to the struck surface and its shallow subsurface.
float craterWeight(vec3 delta, out vec3 lateral) {
  float depth = dot(delta, laserAxis);
  lateral = delta - depth * laserAxis;
  float d2 = dot(lateral, lateral) / (.45 * .45) + depth * depth / (.32 * .32);
  return 1. - smoothstep(.14, 1., d2);
}

// Remove closing speed and dissipate slip under the contact's normal load.
vec3 contactImpulse(vec3 relativeVelocity, vec3 normal, float separationSpeed, float bounce) {
  float closing = dot(relativeVelocity, normal);
  // Omit restitution for approaches slow enough to be resting contact.
  float rebound = -closing > max(settleSpeed, attraction * dt) ? -bounce * closing : 0.;
  float impulse = max(0., max(separationSpeed, rebound) - closing);
  vec3 tangent = relativeVelocity - closing * normal;
  return impulse * normal - tangent * min(1., (.62 * friction) * impulse / max(.0001, length(tangent)));
}

// Find the earliest impact along a step, including an initially overlapping pair.
float hitTime(vec3 start, vec3 travel, float radius) {
  float outside = dot(start,start) - radius*radius;
  if (outside <= 0.) return 0.;
  float approach = dot(start, travel);
  float discriminant = approach*approach - dot(travel,travel)*outside;
  if (approach >= 0. || discriminant < 0.) return 2.;
  return outside / (-approach + sqrt(discriminant));
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 p = texelFetch(positions, id, 0), v = texelFetch(velocities, id, 0);
  vec3 outward = p.xyz / max(length(p.xyz), .0001);
  // Sleeping grains store their supporting grain's texel in XY. A negative X
  // identifies the sphere. Moving grains use XYZ for velocity.
  bool sleeping = v.w > 2.;
  float spin = sleeping ? v.w - 4. : v.w;
  vec3 previousVelocity = sleeping ? vec3(0.) : v.xyz;
  vec4 impact = vec4(0.);
  if (firing) impact = texelFetch(impactPoint, ivec2(0), 0);
  if (impact.w > .5) {
    vec3 lateral;
    float weight = craterWeight(p.xyz - impact.xyz, lateral);
    if (weight > 0.) {
      sleeping = false;
      previousVelocity += weight * ((5.3 + .7 * spin) * laserAxis + 15. * lateral);
    }
  }
  float drag = exp(-damping * dt);
  previousVelocity *= drag;
  vec3 velocity = previousVelocity - dt * attraction * outward;
  vec3 travel = dt * velocity;
  float grainRadius = contactRadius(v.w);
  float shell = radius + grainRadius;
  ivec2 supportId = ivec2(-1);
  vec3 obstacle = center;
  float contactDistance = shell;
  float hit = hitTime(p.xyz - center, travel, shell);
  vec3 impulse = vec3(0.);
  float contactCount = 0.;
  float supportCosine = inversesqrt(1. + (.92 * friction) * (.92 * friction));
  float travelLength = length(travel), reach = grainRadius + maxRadius + contactSkin + travelLength;
  // Sample along fast steps to catch stationary grains on the way to the ball.
  int probes = clamp(int(ceil(travelLength / cellSize)), 1, 8);
  for (int probe = 0; probe < probes; probe++) {
    ivec3 cell = cellAt(p.xyz + travel * (float(probe) + .5) / float(probes));
    for (int z = -1; z <= 1; z++)
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          ivec3 neighbor = cell + ivec3(x,y,z);
          ivec2 previousId = ivec2(-1);
          for (int lane = 0; lane < 2; lane++) {
            vec4 record = texelFetch(contacts, atlas(neighbor, lane), 0);
            if (record.b == 0.) continue;
            ivec2 other = ivec2(round(record.rg * 255.));
            if (other == id || other == previousId) continue;
            previousId = other;
            vec3 otherPosition = texelFetch(positions, other, 0).xyz;
            vec3 delta = p.xyz - otherPosition;
            float d2 = dot(delta, delta);
            if (d2 > reach * reach) continue;
            vec4 otherState = texelFetch(velocities, other, 0);
            float diameter = grainRadius + contactRadius(otherState.w);
            // Neighbors ejected in the same tick cease to be static supports together.
            if (impact.w > .5) {
              vec3 lateral;
              if (craterWeight(otherPosition - impact.xyz, lateral) > 0.) continue;
            }
            if (otherState.w > 2.) {
              float t = hitTime(delta, travel, diameter);
              if (t < hit) {
                hit = t;
                obstacle = otherPosition;
                supportId = other;
                contactDistance = diameter;
              }
            } else if (probe == 0 && d2 < diameter * diameter) {
              float distance = sqrt(d2);
              // Resolve coincident centers with opposite normals for each grain.
              float signX = (id.y > other.y || (id.y == other.y && id.x > other.x)) ? 1. : -1.;
              vec3 normal = distance > .00001 ? delta / distance : vec3(signX, 0., 0.);
              // Packing error alone cannot dislodge a grain from its support.
              float separationSpeed = sleeping ? 0. : stiffness * (diameter - distance) / dt;
              impulse += .5 * contactImpulse(previousVelocity - otherState.xyz * drag, normal, separationSpeed, sleeping ? 0. : restitution);
              contactCount += 1.;
            }
          }
        }
  }
  if (sleeping) {
    bool onBall = v.x < 0.;
    ivec2 support = ivec2(v.xy);
    vec3 supportPosition = onBall ? center : texelFetch(positions, support, 0).xyz;
    float supportState = onBall ? 0. : texelFetch(velocities, support, 0).w;
    bool atRest = onBall || supportState > 2.;
    vec3 delta = p.xyz - supportPosition;
    float distance = length(delta);
    float limit = onBall ? shell : grainRadius + contactRadius(supportState);
    vec3 normal = delta / max(distance, .00001);
    // The support absorbs inward impacts. Tangential impacts can dislodge a grain.
    vec3 kick = impulse + contactImpulse(impulse, normal, 0., 0.);
    // An expanding sphere can overtake a grain even while its support is at rest.
    bool outsideSphere = length(p.xyz - center) >= shell - contactSkin;
    if (outsideSphere && atRest && distance <= limit + contactSkin && dot(normal, outward) + .00001 >= supportCosine &&
        length(kick) < max(.07, .70 * friction * attraction * dt)) {
      nextPosition = p;
      nextVelocity = v;
      return;
    }
  }
  sleeping = false;
  if (hit <= 1.) {
    vec3 contactPoint = p.xyz + hit * travel;
    vec3 delta = contactPoint - obstacle;
    vec3 normal = length(delta) > .00001 ? normalize(delta) : outward;
    velocity += contactImpulse(velocity, normal, 0., restitution);
    if (dot(normal, outward) >= supportCosine && length(velocity) < settleSpeed) {
      velocity = vec3(0.);
      sleeping = true;
    }
    p.xyz = obstacle + (contactDistance + .00025) * normal + (1. - hit) * dt * velocity;
  } else {
    velocity += impulse / max(1., .5 * contactCount);
    p.xyz += dt * velocity;
  }
  // A second contact in the same tick can push a grain back into the ball.
  vec3 fromCenter = p.xyz - center;
  float ballDistance = length(fromCenter);
  if (ballDistance < shell) {
    vec3 normal = ballDistance > .00001 ? fromCenter / ballDistance : outward;
    p.xyz = center + (shell + .00025) * normal;
    velocity += contactImpulse(velocity, normal, 0., restitution);
    supportId = ivec2(-1);
    sleeping = length(velocity) < settleSpeed;
    if (sleeping) velocity = vec3(0.);
  }
  float floorContact = ${FLOOR_Y} + grainRadius;
  if (p.y < floorContact) {
    p.y = floorContact;
    velocity += contactImpulse(velocity, vec3(0.,1.,0.), 0., restitution);
  }
  p.w = mod(p.w + dt * 1.6 * length(velocity) * spin, 6.2831853);
  nextPosition = p;
  nextVelocity = sleeping ? vec4(vec2(supportId), 0., spin + 4.) : vec4(velocity, spin);
}`;
