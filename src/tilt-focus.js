import { Vector2 } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// A screen-space sharp band with Gaussian blur outside it. No depth texture,
// extra scene render, world focus plane, or camera-distance calculation.
export function createTiltFocus() {
  const makePass = direction => new ShaderPass({
    uniforms: { tDiffuse: { value: null }, direction: { value: direction },
      resolution: { value: new Vector2(1, 1) }, normal: { value: new Vector2(0, 1) },
      band: { value: .18 }, strength: { value: 1.5 }, offset: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 direction,resolution,normal;
      uniform float band,strength,offset; varying vec2 vUv;
      void main(){
        vec2 p=vUv-.5; p.x*=resolution.x/resolution.y;
        float distanceFromBand=abs(dot(p,normal)-offset);
        float radius=strength*4.*smoothstep(band,band+.32,distanceFromBand);
        vec4 sum=texture2D(tDiffuse,vUv)*.2;float total=.2;
        for(int i=1;i<=6;i++)for(int side=0;side<2;side++){
          float stepSize=float(i)/6.*(side==0?-1.:1.);
          vec2 uv=clamp(vUv+direction/resolution*radius*stepSize,vec2(0.),vec2(1.));
          float weight=exp(-2.*stepSize*stepSize);
          sum+=texture2D(tDiffuse,uv)*weight;total+=weight;
        }
        gl_FragColor=sum/total;
      }`,
  });
  const passes = [makePass(new Vector2(1,0)), makePass(new Vector2(0,1))];
  return {
    passes,
    configure(value) {
      const angle=value.tilt*Math.PI/180;
      for(const p of passes){
        p.enabled=value.enabled&&value.strength>0;
        p.uniforms.normal.value.set(-Math.sin(angle),Math.cos(angle));
        p.uniforms.band.value=value.band;p.uniforms.strength.value=value.strength;p.uniforms.offset.value=value.offset;
      }
    },
    resize(w,h) { passes.forEach(p=>p.uniforms.resolution.value.set(w,h)); },
    render() {},
    dispose() { passes.forEach(p=>p.dispose()); },
  };
}
