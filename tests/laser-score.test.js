import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { bindSphereAim } from '../src/aim.js';
import { createLaserScore } from '../src/laser-score.js';
import { defaultSetup } from '../src/settings.js';

test('screen picking aims through the chosen pixel and excludes drags, misses and multi-touch', () => {
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 200 });
  const camera = new PerspectiveCamera(45, 1, .1, 100);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  const shots = [], origin = new Vector3();
  const release = bindSphereAim(canvas, camera, s => s.set(origin, 1),
    (normal, sight) => shots.push([normal.clone(), sight.clone()]));
  function pointer(name, x = 110, id = 1, primary = true) {
    canvas.dispatchEvent(Object.assign(new Event(name), {
      clientX: x, clientY: 110, button: 0, pointerId: id, isPrimary: primary,
    }));
  }
  pointer('pointerdown', 135); pointer('pointerup', 135);
  const [normal, sight] = shots[0];
  assert.ok(Math.abs(normal.length() - 1) < 1e-8);
  assert.ok(Math.abs(normal.clone().project(camera).x - .25) < 1e-6);
  assert.ok(normal.clone().sub(camera.position).normalize().dot(sight) < -.99999);
  pointer('pointerdown'); pointer('pointermove', 145); pointer('pointerup');
  pointer('pointerdown', 12); pointer('pointerup', 12);
  pointer('pointerdown'); pointer('pointerdown', 110, 2, false); pointer('pointerup', 110, 2, false); pointer('pointerup');
  pointer('pointerdown'); pointer('pointercancel'); pointer('pointerup');
  assert.equal(shots.length, 1);
  release();
});

test('each automatic and manual laser strike triggers one bass note while playing', async () => {
  const calls = [], files = [], echoOrbits = [];
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = { connect: target => target, disconnect() {} }, gains = [];
  const delay = { ...node, delayTime: param() };
  const ctx = {
    state: 'running', currentTime: 2, close: async () => {},
    createDelay: () => delay,
    createBiquadFilter: () => ({ ...node, frequency: param(), Q: param() }),
    createGain() { const gain = param(); gains.push(gain); return { ...node, gain }; },
  };
  const api = {
    getAudioContext: () => ctx, initAudio: async () => {}, samples: async bank => assert.deepEqual(bank, { erosion_bass: { a1: ['bass-strike.wav'] } }),
    loadBuffer: async url => files.push(url), resetGlobalEffects() {},
    getSuperdoughAudioController: () => ({ getOrbit(orbit) { echoOrbits.push(orbit); return { output: node }; }, output: { destinationGain: node } }),
    superdough: async (voice, when, duration) => calls.push({ voice, when, duration }),
  };
  const score = createLaserScore({ load: async () => api, sample: 'bass-strike.wav' });
  const setup = { ...defaultSetup().audio, volume: .5 };
  score.configure(setup, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(files, ['bass-strike.wav']);
  assert.equal(score.ready, true);
  assert.equal(calls.length, 0);
  score.hit(-1, 0);
  ctx.currentTime += .20; score.hit(0, .5);
  ctx.currentTime += .20; score.hit(1, 1, true);
  ctx.currentTime += 2; score.hit(0, .5);
  assert.deepEqual(calls.map(c => c.voice.note), [31, 33, 36, 33]);
  assert.equal(echoOrbits.length, 1);
  assert.ok(calls.every(c => c.voice.s === 'erosion_bass' && c.voice.orbit === echoOrbits[0]));
  assert.ok(calls[0].voice.pan < .15 && calls[2].voice.pan > .85);
  assert.ok(calls[0].when > 2);
  const [feedback, wet] = gains;
  assert.deepEqual([wet.value, delay.delayTime.value, feedback.value], [.14, .29, .18]);
  const shaped = { ...setup, transpose: -5, attackMs: 12, lengthMs: 95, releaseMs: 20,
    cutoffHz: 120, echoLevel: 0, echoTimeMs: 450, echoFeedback: .41 };
  score.configure(shaped, true);
  assert.deepEqual([wet.value, delay.delayTime.value, feedback.value], [0, .45, .41]);
  score.hit(0, .5);
  const { voice, duration } = calls.at(-1);
  assert.deepEqual([voice.note, voice.attack, duration, voice.release, voice.cutoff], [28, .012, .095, .02, 120]);
  score.reset();
  score.hit(0, .5);
  assert.deepEqual(calls.at(-1).voice, voice);
  score.configure(setup, false);
  score.hit(0, .5, true);
  assert.equal(calls.length, 6);
  score.dispose();
});
