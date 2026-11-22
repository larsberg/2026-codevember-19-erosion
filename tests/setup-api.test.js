import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createSetupHandler } from '../server/setup-api.js';
import { defaultSetup } from '../src/settings.js';

test('atomic GET/PUT round trip uses Erosion ownership and retains the complete studio setup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'erosion-setup-')),file=join(dir,'settings.json'),handler=createSetupHandler(file);
 async function request(method,body,id='19-erosion') {
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method,url:'/api/setup',headers:{host:'127.0.0.1:1234','content-type':'application/json','x-sketch-id':id}});
  let output; const headers={};const res={setHeader(k,v){headers[k]=v;},end(v){output=JSON.parse(v);}};
  await handler(req,res,()=>assert.fail('unexpected route'));return {body:output,status:res.statusCode,headers};
 }
 try {
  const setup=defaultSetup();setup.generation.seed=184847;setup.physics.gravity=6;setup.camera.yaw=67;setup.bloom.enabled=true;setup.focus.enabled=true;
  Object.assign(setup.camera, { minDistance: .5, maxDistance: 3200 });
  Object.assign(setup.physics, { sphereRadius: 1.35, floorGap: .42, damping: 2.4, restitution: .35, stiffness: .8, settleSpeed: .12, rotationScale: 17.5 });
  Object.assign(setup.drafting, { gridOpacity: .5, gridDivisions: 8, planOpacity: 0, planColor: '#654321',
    pointSize: 4, samplePercent: 16, slice: true, sliceHeight: .6, sliceThickness: .07 });
  setup.laser = { color: '#44aaff', frequency: 1.5 };
  setup.materials.panels.roughness=.13;setup.audio.enabled=false;setup.lighting.environment.intensity=1.8;
  Object.assign(setup.lighting.spotlight,{penumbra:.9,softness:7.5,intensity:11200});
  const older=await request('PUT',{...setup,audio:{enabled:true,volume:.2}});
  assert.deepEqual(older.body.audio,{enabled:false,volume:.2});
  assert.equal((await request('PUT',setup,'01-fold')).status,409);
  assert.equal((await request('PUT',setup)).status,200);
  const saved=await request('GET');assert.equal(saved.headers['X-Sketch-Id'],'19-erosion');assert.deepEqual(saved.body,setup);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),setup);
  assert.equal((await request('PUT',{...setup,physics:{gravity:-1}})).status,400);
  assert.equal((await request('PUT',{...setup,drafting:{gridDivisions:2.5}})).status,400);
  for (const invalid of [{ laser: { frequency: -1 } }, { laser: { color: 'red' } }, { physics: { damping: -1 } }, { physics: { sphereRadius: 0 } }]) {
    assert.equal((await request('PUT', { ...setup, ...invalid })).status, 400);
  }
  assert.deepEqual((await request('GET')).body,setup);
 }finally{await rm(dir,{recursive:true,force:true});}
});
