import {
  BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshNormalMaterial, MeshStandardMaterial,
  Points, Quaternion, ShaderMaterial, Sphere, Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GRAIN_COUNT, SIDE } from './erosion-field.js';
import { randomSource } from './random.js';

// A few reusable hulls and distinct mineral finishes keep the draw count independent of grain count.
const minerals = [
  { name: 'Quartz', color: '#d8c3a0', roughness: .32, metalness: .08, sides: 4, scale: [1,.76,.84] },
  { name: 'Sandstone', color: '#c89463', roughness: .90, metalness: 0, sides: 3, scale: [1,.82,.78] },
  { name: 'Basalt', color: '#544e49', roughness: .82, metalness: .04, sides: 4, scale: [.81,.78,1] },
  { name: 'Ochre', color: '#ac663a', roughness: .79, metalness: .05, sides: 3, scale: [1,.64,.78] },
  { name: 'Shell', color: '#efe3c8', roughness: .49, metalness: .06, sides: 4, scale: [1,.46,.7] },
  { name: 'Mica', color: '#b29b78', roughness: .21, metalness: .83, sides: 5, scale: [1,.30,.67] },
];
function hull(sides, random) {
  const points = [new Vector3(.12,.82,.18),new Vector3(-.21,-.78,-.08)];
  for (let i = 0; i < sides; i++) {
    const a = (i + .24 * random()) * 2 * Math.PI / sides;
    points.push(new Vector3(Math.cos(a), random()*.43-.21, Math.sin(a)));
  }
  // Flat shading computes face normals in the fragment shader, so adjacent faces can share corners.
  const triangles = new ConvexGeometry(points);
  triangles.deleteAttribute('normal');
  const indexed = mergeVertices(triangles);
  indexed.computeVertexNormals();
  triangles.dispose();
  return indexed;
}

// Average the hull's extent over possible contact normals, including the thin
// directions of the flakes. This keeps their visible faces close to the point contacts.
function meanContactRadius(geometry) {
  const vertices = geometry.attributes.position;
  const normal = new Vector3(), vertex = new Vector3();
  let total = 0;
  const samples = 64;
  for (let i = 0; i < samples; i++) {
    const y = 1 - 2 * (i + .5) / samples;
    const orbit = Math.sqrt(1 - y*y), angle = i * Math.PI * (3 - Math.sqrt(5));
    normal.set(orbit * Math.cos(angle), y, orbit * Math.sin(angle));
    let extent = 0;
    for (let j = 0; j < vertices.count; j++) {
      extent = Math.max(extent, vertex.fromBufferAttribute(vertices, j).dot(normal));
    }
    total += extent;
  }
  return total / samples;
}

export function createGrains(gpu, seed) {
  const random = randomSource((seed ^ 0xa17b21) >>> 0);
  const rotation = new Quaternion(), axis = new Vector3();
  // One instance draws one of each mineral. The template carries each hull's ID range and finish.
  const hulls = [];
  const instanceCount = Math.ceil(GRAIN_COUNT / minerals.length);
  const poses = minerals.map(() => new Float32Array(instanceCount * 4));
  const shades = [new Float32Array(instanceCount * 3), new Float32Array(instanceCount * 3)];
  for (const [kind, mineral] of minerals.entries()) {
    const first = Math.floor(GRAIN_COUNT * kind / minerals.length);
    const end = Math.floor(GRAIN_COUNT * (kind + 1) / minerals.length);
    const shape = hull(mineral.sides, random);
    shape.scale(...mineral.scale);
    const hullRadius = meanContactRadius(shape);
    const vertices = shape.attributes.position.count, color = new Color(mineral.color);
    const colors = new Float32Array(vertices * 3), batches = new Float32Array(vertices * 4);
    for (let i = 0; i < vertices; i++) {
      color.toArray(colors, i * 3);
      batches.set([kind, first, mineral.roughness, mineral.metalness], i * 4);
    }
    shape.setAttribute('color', new BufferAttribute(colors, 3));
    shape.setAttribute('grainBatch', new BufferAttribute(batches, 4));
    hulls.push(shape);
    for (let id = first; id < end; id++) {
      axis.set(random() - .5, random() - .5, random() - .5).normalize();
      rotation.setFromAxisAngle(axis, random() * Math.PI * 2);
      // q * v * conjugate(q) scales by |q|², folding the contact radius into the rotation.
      const size = Math.sqrt(gpu.grainRadius(id) / hullRadius), i = id - first;
      poses[kind].set([rotation.x * size, rotation.y * size, rotation.z * size, rotation.w * size], i * 4);
      shades[Math.floor(kind / 3)][i * 3 + kind % 3] = .68 + .54 * random();
    }
  }
  const template = mergeGeometries(hulls);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(template.index);
  for (const [key, attribute] of Object.entries(template.attributes)) geometry.setAttribute(key, attribute);
  geometry.instanceCount = instanceCount;
  poses.forEach((data, i) => geometry.setAttribute('pose' + i, new InstancedBufferAttribute(data, 4)));
  shades.forEach((data, i) => geometry.setAttribute('shade' + i, new InstancedBufferAttribute(data, 3)));
  for (const hull of hulls) hull.dispose();
  template.dispose();
  const renderUniforms = {
    grainPositions: gpu.positions, previousPositions: gpu.previousPositions, interpolation: gpu.interpolation,
  };
  const samplePosition = `uniform sampler2D grainPositions, previousPositions;
    uniform float interpolation;
    vec4 displayGrain(ivec2 uv) {
      vec4 a = texelFetch(previousPositions, uv, 0), b = texelFetch(grainPositions, uv, 0);
      float turn = mod(b.w - a.w + 3.14159265, 6.28318531) - 3.14159265;
      return vec4(mix(a.xyz, b.xyz, interpolation), a.w + interpolation * turn);
    }`;
  function applyGrainPose(shader) {
    Object.assign(shader.uniforms, renderUniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      ${samplePosition}
      attribute vec4 pose0, pose1, pose2, pose3, pose4, pose5;
      attribute vec4 grainBatch;
      vec3 orient(vec3 v, vec4 q, vec2 cs) {
        // The seeded pose maps the local Y spin axis to one fixed axis per grain.
        v.xz = vec2(cs.x * v.x - cs.y * v.z, cs.y * v.x + cs.x * v.z);
        return dot(q,q) * v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v);
      }`).replace('void main() {', `void main() {
      int kind = int(grainBatch.x), id = int(grainBatch.y) + gl_InstanceID;
      if (id >= (kind + 1) * ${GRAIN_COUNT} / ${minerals.length}) {
        gl_Position = vec4(2., 2., 2., 1.); return;
      }
      vec4 grain = displayGrain(ivec2(id % ${SIDE}, id / ${SIDE}));
      vec4 rotations[6] = vec4[6](pose0, pose1, pose2, pose3, pose4, pose5);
      vec4 orientQ = rotations[kind];
      vec2 cs = vec2(cos(grain.w), sin(grain.w));`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = orient(normal, orientQ, cs);')
      .replace('#include <begin_vertex>', 'vec3 transformed = grain.xyz + orient(position, orientQ, cs);');
  }
  const material = new MeshStandardMaterial({ name: 'Mineral grains', flatShading: true, vertexColors: true });
  material.onBeforeCompile = shader => {
    applyGrainPose(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 shade0, shade1;
      flat varying vec2 finish;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb *= kind < 3 ? shade0[kind % 3] : shade1[kind % 3];
        finish = grainBatch.zw;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n flat varying vec2 finish;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = finish.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = finish.y;');
  };
  const root = new Mesh(geometry, material);
  const aoMaterial = new MeshNormalMaterial({ flatShading: true });
  aoMaterial.onBeforeCompile = applyGrainPose;
  aoMaterial.allowOverride = false;
  root.userData.aoNormalMaterial = aoMaterial;
  root.layers.enable(1);
  root.name = 'Sand';
  root.frustumCulled = false;
  root.receiveShadow = true;

  // Project the simulated grain positions onto the ground.
  const dots = new BufferGeometry();
  // Positions live in a texture. Three uses this center to sort the transparent plan.
  dots.boundingSphere = new Sphere(new Vector3(), Infinity);
  // An odd stride visits every texel in the power-of-two state texture once.
  // Shorter draw ranges sample all six minerals with stable grain IDs.
  const plotIds = Uint16Array.from({ length: GRAIN_COUNT }, (_, i) => (i * 40503) % GRAIN_COUNT);
  dots.setAttribute('position', new BufferAttribute(plotIds, 1));
  const projectionMaterial = new ShaderMaterial({
    uniforms: {
      ...renderUniforms, floorY: gpu.floorY, opacity: { value: 0 },
      ink: { value: new Color() }, pointSize: { value: 1 },
      sliceHeight: { value: 0 }, halfThickness: { value: -1 },
    }, transparent: true, depthWrite: false,
    vertexShader: `${samplePosition}
      uniform float floorY, sliceHeight, halfThickness, pointSize;
      void main() {
        int id=int(position.x);
        vec3 p=displayGrain(ivec2(id % ${SIDE},id / ${SIDE})).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p.x,floorY+.014,p.z,1.);
        float height = p.y - floorY;
        if (halfThickness >= 0. && abs(height - sliceHeight) > halfThickness)
          gl_Position = vec4(2., 2., 2., 1.);
        gl_PointSize=pointSize;
      }`,
    fragmentShader: `uniform float opacity;
      uniform vec3 ink;
      void main(){gl_FragColor=vec4(ink,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const plan = new Points(dots,projectionMaterial);
  plan.frustumCulled = false;
  return {
    root, plan, hullCount: minerals.length,
    configure(drafting) {
      const count = Math.round(GRAIN_COUNT * drafting.samplePercent / 100);
      dots.setDrawRange(0, count);
      dots.boundingSphere.center.y = gpu.floorY.value;
      plan.visible = drafting.planOpacity > 0 && count > 0;
      const { opacity, ink, pointSize, sliceHeight, halfThickness } = projectionMaterial.uniforms;
      opacity.value = drafting.planOpacity;
      ink.value.set(drafting.planColor);
      pointSize.value = drafting.pointSize;
      sliceHeight.value = drafting.sliceHeight;
      halfThickness.value = drafting.slice ? drafting.sliceThickness / 2 : -1;
    },
    dispose() {
      geometry.dispose(); material.dispose(); aoMaterial.dispose();
      dots.dispose(); projectionMaterial.dispose();
    },
  };
}
