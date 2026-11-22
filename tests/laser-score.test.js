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
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; },
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = { connect: target => target, disconnect() {} }, gains = [];
  const delay = { ...node, delayTime: param() };
  const returns = [], modulators = [], filters = [], sandPans = [];
  const ctx = {
    state: 'running', currentTime: 2, close: async () => {},
    createDelay: () => delay,
    createBiquadFilter() {
      const filter = { ...node, frequency: param(), Q: param() };
      filters.push(filter); return filter;
    },
    createGain() { const gain = param(); gains.push(gain); return { ...node, gain }; },
    createBuffer: (channels, frames, rate) => ({ duration: frames / rate, getChannelData: () => new Float32Array(frames) }),
    createStereoPanner() {
      const pan = param(); sandPans.push(pan);
      return { ...node, pan };
    },
    createBufferSource() {
      return { ...node, start(time, offset, duration) {
        if (duration == null) modulators.push(this);
        else returns.push({ time, offset, duration, source: this });
      }, stop() { this.stopped = true; } };
    },
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
  assert.deepEqual(returns.map(r => r.time), calls.map(c => c.when + .22));
  assert.equal(modulators.length, 1);
  assert.equal(echoOrbits.length, 1);
  assert.ok(calls.every(c => c.voice.s === 'erosion_bass' && c.voice.orbit === echoOrbits[0]));
  assert.deepEqual(calls.map(c => c.voice.pan), [0, .5, 1, .5]);
  assert.deepEqual(sandPans.map(p => p.value), [-1, 0, 1, 0]);
  assert.ok(calls[0].when > 2);
  const [feedback, wet, sandGain] = gains;
  assert.equal(sandGain.value, setup.volume * setup.sandLevel);
  const sandTone = filters.at(-1), depth = gains[4];
  assert.equal(sandTone.frequency.value, setup.sandCutoffHz);
  assert.equal(depth.value, setup.sandTexture / 100);
  assert.deepEqual([wet.value, delay.delayTime.value, feedback.value], [.14, .29, .18]);
  const shaped = { ...setup, transpose: -5, attackMs: 12, lengthMs: 95, releaseMs: 20,
    cutoffHz: 120, echoLevel: 0, echoTimeMs: 450, echoFeedback: .41,
    sandDelayMs: 790, sandRiseMs: 1800, sandDecayMs: 4000, sandCutoffHz: 805, sandTexture: 85 };
  score.configure(shaped, true);
  assert.deepEqual([wet.value, delay.delayTime.value, feedback.value], [0, .45, .41]);
  assert.equal(sandTone.frequency.value, 805);
  assert.equal(depth.value, .85);
  score.hit(0, .5);
  const { voice, duration } = calls.at(-1);
  assert.equal(returns.at(-1).time, calls.at(-1).when + .79);
  assert.ok(Math.abs(returns.at(-1).duration - 5.8) < 1e-10 && returns.at(-1).source.loop);
  score.configure({ ...shaped, sandLevel: 0 }, true);
  assert.equal(sandGain.value, 0);
  assert.deepEqual([voice.note, voice.attack, duration, voice.release, voice.cutoff], [28, .012, .095, .02, 120]);
  score.reset();
  assert.ok(returns.every(r => r.source.stopped));
  assert.ok(modulators.every(source => source.stopped));
  score.hit(0, .5);
  assert.deepEqual(calls.at(-1).voice, voice);
  score.configure(setup, false);
  score.hit(0, .5, true);
  assert.equal(calls.length, 6);
  assert.equal(returns.length, 5);
  score.dispose();
});
