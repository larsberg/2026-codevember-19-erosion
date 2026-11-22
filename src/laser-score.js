import { resumeAudioContext } from './audio-autoplay.js';

const bassOrbit = 1;

// Keep the fundamental in the dry strike. Only the upper body feeds the echo.
function createEcho(api, context, settings) {
  const mixer = api.getSuperdoughAudioController();
  const source = mixer.getOrbit(bassOrbit, [0, 1]).output;
  const delay = context.createDelay(1), tone = context.createBiquadFilter();
  const feedback = context.createGain(), wet = context.createGain();
  const lowCut = context.createBiquadFilter();
  lowCut.type = 'highpass'; lowCut.frequency.value = 83; lowCut.Q.value = .6;
  tone.type = 'lowpass'; tone.frequency.value = 210; tone.Q.value = .5;
  const parameters = [
    ['echoLevel', wet.gain, 1],
    ['echoTimeMs', delay.delayTime, .001],
    ['echoFeedback', feedback.gain, 1],
  ];
  function configure(next, previous) {
    for (const [key, param, scale] of parameters) {
      if (!previous) param.value = next[key] * scale;
      else if (next[key] !== previous[key]) param.setTargetAtTime(next[key] * scale, context.currentTime, .015);
    }
  }
  configure(settings);
  source.connect(lowCut).connect(delay).connect(tone);
  tone.connect(feedback).connect(delay);
  tone.connect(wet).connect(mixer.output.destinationGain);
  return {
    configure,
    dispose() {
      source.disconnect(lowCut);
      for (const node of [lowCut, delay, tone, feedback, wet]) node.disconnect();
    },
  };
}

export function createLaserScore({ load = () => import('@strudel/web'), resume = resumeAudioContext,
  sample = new URL('./audio/bass-strike.wav', document.baseURI).href,
  makeEcho = createEcho, onError = console.warn } = {}) {
  let api, context, loading, loaded = false, disposed = false, wanted = false, activation, echo;
  let sound, hits = 0, manualHits = 0;
  const audible = () => wanted && loaded && context?.state === 'running';
  function reset() {
    echo?.dispose(); echo = undefined;
    if (loaded) api.resetGlobalEffects();
  }
  function unlock() {
    if (!context || context.state === 'running' || activation || !wanted) return;
    const request = resume(context);
    activation = request;
    request.ready.catch(onError).finally(() => { if (activation === request) activation = undefined; });
  }
  function prime() {
    loading ??= (async () => {
      api = await load();
      if (disposed) return;
      context = api.getAudioContext();
      unlock();
      await api.initAudio({ disableWorklets: true, maxPolyphony: 5 });
      if (disposed) return;
      await api.samples({ erosion_bass: { a1: [sample] } });
      await api.loadBuffer(sample, context, 'Erosion bass strike');
      if (!disposed) loaded = true;
    })().catch(error => { loading = undefined; onError(error); });
  }
  return {
    reset,
    get ready() { return audible(); },
    get state() { return { engine: 'Strudel', enabled: !!sound?.enabled, running: audible(), hits, notes: hits, manualHits }; },
    configure(settings, playing) {
      const previous = sound;
      sound = settings;
      const next = sound.enabled && playing && sound.volume > 0;
      if (!next && wanted) { reset(); activation?.cancel(); activation = undefined; }
      wanted = next;
      if (wanted) { echo?.configure(settings, previous); prime(); unlock(); }
    },
    hit(height, pan, manual = false) {
      if (!audible()) return;
      hits++;
      if (manual) manualHits++;
      const now = context.currentTime;
      echo ??= makeEcho(api, context, sound);
      const note = height < -.30 ? 31 : height > .42 ? 36 : 33;  // G1, C2, A1
      const voice = {
        s: 'erosion_bass', orbit: bassOrbit, note: note + sound.transpose, cut: 1, pan: .12 + .76 * pan, gain: sound.volume * .9,
        attack: sound.attackMs / 1000, release: sound.releaseMs / 1000,
        cutoff: sound.cutoffHz * (1 + height * 2 / 9),
      };
      void api.superdough(voice, now + .015, sound.lengthMs / 1000).catch(onError);
    },
    dispose() {
      disposed = true; wanted = false; reset(); activation?.cancel();
      if (context && context.state !== 'closed') void context.close().catch(onError);
    },
  };
}
