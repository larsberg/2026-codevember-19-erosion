import {
  BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial,
  Points, Quaternion, ShaderMaterial, Vector3,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { FLOOR_Y, GRAIN_COUNT, SIDE } from './erosion-field.js';
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
  return new ConvexGeometry(points);
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
  const root = new Group(), random = randomSource((seed ^ 0xa17b21) >>> 0);
  const transform = new Matrix4(), rotation = new Quaternion(), axis = new Vector3(), scale = new Vector3();
  const origin = new Vector3(), color = new Color();
  for (const [kind, mineral] of minerals.entries()) {
    const first = Math.floor(GRAIN_COUNT*kind/minerals.length), end = Math.floor(GRAIN_COUNT*(kind+1)/minerals.length);
    const material = new MeshStandardMaterial({ name: mineral.name, roughness: mineral.roughness, metalness: mineral.metalness,
      flatShading: true });
    material.onBeforeCompile = shader => {
      shader.uniforms.grainPositions = gpu.positions;
      shader.uniforms.firstGrain = { value: first };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        uniform sampler2D grainPositions;
        uniform int firstGrain;
        mat4 grainTransform() {
          int id = firstGrain + gl_InstanceID;
          ivec2 cell = ivec2(id % ${SIDE}, id / ${SIDE});
          vec4 p = texelFetch(grainPositions,cell,0);
          float c = cos(p.w), s = sin(p.w);
          mat4 m = instanceMatrix;
          vec3 x = m[0].xyz, z = m[2].xyz;
          m[0].xyz = c*x+s*z; m[2].xyz = -s*x+c*z;
          m[3].xyz = p.xyz;
          return m;
        }
        #define instanceMatrix grainTransform()`);
    };
    const geometry = hull(mineral.sides,random);
    geometry.scale(...mineral.scale);
    const hullRadius = meanContactRadius(geometry);
    const mesh = new InstancedMesh(geometry,material,end-first);
    mesh.name = mineral.name; mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    for (let i = first; i < end; i++) {
      axis.set(random()-.5,random()-.5,random()-.5).normalize();
      rotation.setFromAxisAngle(axis,random()*Math.PI*2);
      scale.setScalar(gpu.grainRadius(i) / hullRadius);
      mesh.setMatrixAt(i-first,transform.compose(origin,rotation,scale));
      color.set(mineral.color).multiplyScalar(.68+.54*random());
      mesh.setColorAt(i-first,color);
    }
    root.add(mesh);
  }

  // Project the simulated grain positions onto the ground.
  const dots = new BufferGeometry();
  dots.setAttribute('position',new BufferAttribute(Uint16Array.from({ length: GRAIN_COUNT }, (_, id) => id),1));
  const projectionMaterial = new ShaderMaterial({
    uniforms: { grainPositions: gpu.positions, opacity: { value: .10 } }, transparent: true, depthWrite: false,
    vertexShader: `uniform sampler2D grainPositions;
      void main() {
        int id=int(position.x);
        vec3 p=texelFetch(grainPositions,ivec2(id % ${SIDE},id / ${SIDE}),0).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p.x,${FLOOR_Y}+.014,p.z,1.);
        gl_PointSize=1.;
      }`,
    fragmentShader: `uniform float opacity;
      void main(){gl_FragColor=vec4(.12,.085,.053,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const plan = new Points(dots,projectionMaterial);
  plan.frustumCulled = false;
  return {
    root, plan,
    configure(opacity) { projectionMaterial.uniforms.opacity.value = opacity * .4; },
    dispose() {
      for (const mesh of root.children) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
      dots.dispose(); projectionMaterial.dispose();
    },
  };
}
