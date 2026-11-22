import test from 'node:test';
import assert from 'node:assert/strict';
import {drawerRequested} from '../src/drawer-url.js';

test('preview anchors accept the same UI flag as standalone sketch URLs',()=>{
  const root='http://127.0.0.1:1234/';
  for(const suffix of ['#pdf-001?ui=true','?ui=true#pdf-001','?ui=1','#pdf-001?page=1&ui=1']){
    assert.equal(drawerRequested(root+suffix),true,suffix);
  }
  for(const suffix of ['','#pdf-001','?ui=false#pdf-001?ui=true']){
    assert.equal(drawerRequested(root+suffix),false,suffix);
  }
});
