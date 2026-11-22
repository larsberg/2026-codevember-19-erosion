import { GRAIN_RADIUS, GRAIN_RADIUS_SPREAD, SIDE } from './erosion-field.js';

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
uniform int impactRow;
uniform bool firing;
uniform float dt, attraction, friction, radius, damping, restitution, stiffness, settleSpeed;
uniform float rotationScale, floorY;
layout(location=0) out vec4 nextPosition;
layout(location=1) out vec4 nextVelocity;

const float spinStartSpeed = .12;   // world units per second
const float spinRate = 1.6;        // radians per second at 1×
const float spinStopTime = .20;    // seconds of friction after settling

// W carries the seeded radius variation in three bands: idle (0), spinning (-4), supported (+4).
float grainVariation(float state) {
  return state - 4. * round(state * .25);
}
float contactRadius(float state) {
  return ${GRAIN_RADIUS} + ${GRAIN_RADIUS_SPREAD} * grainVariation(state);
}
float advanceAngle(float angle, float fraction) {
  return mod(angle + dt * rotationScale * spinRate * fraction, 6.2831853);
}

// An ellipsoidal patch limits excavation to the struck surface and its shallow subsurface.
float craterWeight(vec3 delta, out vec3 lateral) {
  float depth = dot(delta, laserAxis);
  lateral = delta - depth * laserAxis;
  float d2 = dot(lateral, lateral) / (.45 * .45) + depth * depth / (.32 * .32);
  return 1. - smoothstep(.14, 1., d2);
}

// Remove closing speed and dissipate slip under the contact's normal load.
vec3 contactImpulse(vec3 relativeVelocity, vec3 normal, float bounce) {
  float closing = dot(relativeVelocity, normal);
  // Omit restitution for approaches slow enough to be resting contact.
  float rebound = -closing > max(settleSpeed, attraction * dt) ? -bounce * closing : 0.;
  float impulse = max(0., rebound - closing);
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

// A grain can rebound from the floor into the underside of the sphere in the same tick.
vec3 advanceAboveFloor(vec3 start, inout vec3 velocity, float seconds, float floorContact, float shell) {
  start.y = max(start.y, floorContact);
  for (int bounce = 0; bounce < 4; bounce++) {
    vec3 end = start + seconds * velocity;
    if (velocity.y >= 0. || end.y > floorContact) return end;
    float toFloor = (floorContact - start.y) / velocity.y;
    start += toFloor * velocity;
    start.y = floorContact;
    seconds -= toFloor;
    velocity += contactImpulse(velocity, vec3(0., 1., 0.), mix(.45, 1., restitution));

    vec3 travel = seconds * velocity;
    float toSphere = hitTime(start - center, travel, shell);
    if (toSphere > 1.) return start + travel;
    start += toSphere * travel;
    velocity += contactImpulse(velocity, normalize(start - center), restitution);
    seconds *= 1. - toSphere;
  }
  return start;
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 p = texelFetch(positions, id, 0), v = texelFetch(velocities, id, 0);
  // Supported grains store their support texel in XY and residual spin in Z.
  // A negative X identifies the sphere. Free grains use XYZ for velocity.
  bool sleeping = v.w > 2.;
  float variation = grainVariation(v.w);
  float spinFraction = sleeping ? v.z : float(v.w < -2.);
  vec3 previousVelocity = sleeping ? vec3(0.) : v.xyz;
  float grainRadius = contactRadius(v.w);
  float floorContact = floorY + grainRadius;
  if (p.y < floorContact - contactSkin) sleeping = false;
  p.y = max(p.y, floorContact);
  vec3 outward = p.xyz / max(length(p.xyz), .0001);
  vec4 impact = vec4(0.);
  if (firing) impact = texelFetch(impactPoint, ivec2(0, impactRow), 0);
  if (impact.w > .5) {
    vec3 lateral;
    float weight = craterWeight(p.xyz - impact.xyz, lateral);
    if (weight > 0.) {
      sleeping = false;
      previousVelocity += weight * ((5.3 + .7 * variation) * laserAxis + 15. * lateral);
    }
  }
  float drag = exp(-damping * dt);
  previousVelocity *= drag;
  vec3 velocity = previousVelocity - dt * attraction * outward;
  if (length(previousVelocity) > spinStartSpeed) spinFraction = 1.;
  vec3 travel = dt * velocity;
  float shell = radius + grainRadius;
  ivec2 supportId = ivec2(-1);
  vec3 obstacle = center;
  float contactDistance = shell;
  float hit = hitTime(p.xyz - center, travel, shell);
  float bestFacing = 0.;
  vec3 supportNormals = vec3(0.);
  int supports = 0;
  vec3 impulse = vec3(0.);
  vec3 overlapCorrection = vec3(0.);
  float contactCount = 0.;
  float supportCosine = inversesqrt(1. + (.92 * friction) * (.92 * friction));
  float travelLength = length(travel), reach = grainRadius + maxRadius + contactSkin + travelLength;
  // Sample along fast steps to catch stationary grains on the way to the ball.
  int probes = clamp(int(ceil(travelLength / cellSize)), 1, 8);
  ivec3 previousCell = ivec3(0);
  for (int probe = 0; probe < probes; probe++) {
    ivec3 cell = cellAt(p.xyz + travel * (float(probe) + .5) / float(probes));
    if (probe > 0 && cell == previousCell) continue;
    for (int z = -1; z <= 1; z++)
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          ivec3 neighbor = cell + ivec3(x,y,z);
          // Swept hits use the full travel vector, so overlapping probe regions have already tested these cells.
          if (probe > 0 && all(lessThanEqual(abs(neighbor - previousCell), ivec3(1)))) continue;
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
              if (t <= 1.) {
                vec3 contactDelta = delta + t * travel;
                vec3 n = contactDelta / max(.00001, length(contactDelta));
                float facing = dot(n, outward);
                // Only nearby load-bearing contacts can form a resting pocket.
                if (facing > .1 && d2 <= (diameter + contactSkin) * (diameter + contactSkin)) {
                  supportNormals += n;
                  supports++;
                }
                if (t < hit || (t == hit && facing > bestFacing)) {
                  hit = t;
                  bestFacing = facing;
                  obstacle = otherPosition;
                  supportId = other;
                  contactDistance = diameter;
                }
              }
            } else if (probe == 0 && d2 < diameter * diameter) {
              float distance = sqrt(d2);
              // Resolve coincident centers with opposite normals for each grain.
              float signX = (id.y > other.y || (id.y == other.y && id.x > other.x)) ? 1. : -1.;
              vec3 normal = distance > .00001 ? delta / distance : vec3(signX, 0., 0.);
              // Correct packing errors in position so they cannot launch either grain.
              float overlap = max(0., diameter - distance - .5 * contactSkin);
              overlapCorrection += .5 * min(stiffness * overlap, .25 * grainRadius) * normal;
              impulse += .5 * contactImpulse(previousVelocity - otherState.xyz * drag, normal, sleeping ? 0. : restitution);
              contactCount += 1.;
            }
          }
        }
    previousCell = cell;
  }
  bool inPocket = supports >= 2 && dot(supportNormals, outward) >= supportCosine * length(supportNormals);
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
    vec3 kick = (impulse + contactImpulse(impulse, normal, 0.)) / max(1., .5 * contactCount);
    // An expanding sphere can overtake a grain even while its support is at rest.
    bool outsideSphere = length(p.xyz - center) >= shell - contactSkin;
    // A small release margin keeps a resting contact stable across half-float rounding.
    bool supported = atRest && distance <= limit + 2. * contactSkin && (inPocket || dot(normal, outward) >= supportCosine - .02);
    if (outsideSphere && supported && length(kick) < max(.07, .70 * friction * attraction * dt)) {
      float remaining = max(0., spinFraction - dt / spinStopTime);
      float correction = min(.25 * grainRadius, .5 * max(0., limit - distance - .5 * contactSkin));
      nextPosition = vec4(p.xyz + correction * normal, advanceAngle(p.w, .5 * (spinFraction + remaining)));
      nextPosition.y = max(nextPosition.y, floorContact);
      nextVelocity = vec4(v.xy, remaining, v.w);
      return;
    }
    if (hit <= 1.) velocity += kick;
  }
  sleeping = false;
  float floorHit = travel.y < 0. ? (floorContact - p.y) / travel.y : 2.;
  if (hit <= 1. && hit < floorHit) {
    vec3 contactPoint = p.xyz + hit * travel;
    vec3 delta = contactPoint - obstacle;
    vec3 normal = length(delta) > .00001 ? normalize(delta) : outward;
    vec3 loadNormal = inPocket ? normalize(supportNormals) : normal;
    velocity += contactImpulse(velocity, loadNormal, restitution);
    float penetration = max(0., contactDistance - length(delta));
    bool onSphere = supportId.x < 0;
    float restSpeed = inPocket ? max(settleSpeed, friction * attraction * dt) : settleSpeed;
    if ((inPocket || dot(normal, outward) >= supportCosine) && length(velocity) < restSpeed) {
      velocity = vec3(0.);
      sleeping = true;
    }
    float gentleCorrection = min(.5 * penetration, .25 * grainRadius);
    float impactSpeed = max(0., -dot(previousVelocity, normal));
    float correction = onSphere ? penetration + .00025 : mix(gentleCorrection, penetration + .00025, smoothstep(.12, .65, impactSpeed));
    p.xyz = advanceAboveFloor(contactPoint + correction * normal, velocity, (1. - hit) * dt, floorContact, shell);
  } else {
    float weight = 1. / max(1., .5 * contactCount);
    velocity += weight * impulse;
    p.xyz = advanceAboveFloor(p.xyz + weight * overlapCorrection, velocity, dt, floorContact, shell);
  }
  // A second contact in the same tick can push a grain back into the ball.
  vec3 fromCenter = p.xyz - center;
  float ballDistance = length(fromCenter);
  if (ballDistance < shell) {
    vec3 normal = ballDistance > .00001 ? fromCenter / ballDistance : outward;
    p.xyz = center + (shell + .00025) * normal;
    velocity += contactImpulse(velocity, normal, restitution);
    supportId = ivec2(-1);
    sleeping = length(velocity) < settleSpeed;
    if (sleeping) velocity = vec3(0.);
  }
  if (length(velocity) > spinStartSpeed) spinFraction = 1.;
  p.w = advanceAngle(p.w, spinFraction);
  nextPosition = p;
  nextVelocity = sleeping ? vec4(vec2(supportId), spinFraction, variation + 4.)
                          : vec4(velocity, spinFraction > 0. ? variation - 4. : variation);
}`;
