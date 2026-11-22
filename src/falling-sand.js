// Each return reads a different stretch of noise. A second, inaudible buffer
// modulates the gain so clumpiness can change while the sand is falling.
function makeNoise(context) {
  const rate = 12000;
  const noise = context.createBuffer(1, 3 * rate, rate), clumps = context.createBuffer(1, 3 * rate, rate);
  const samples = noise.getChannelData(0), modulation = clumps.getChannelData(0);
  let rumble = 0, clump = 0;
  for (let i = 0; i < samples.length; i++) {
    const white = Math.random() * 2 - 1;
    rumble += .035 * (white - rumble); // leave space below 70 Hz for the bass
    samples[i] = white - rumble;
    clump = Math.random() < .003 ? 1 : clump * .993;
    modulation[i] = 2.4 * clump - .75;
  }
  return { noise, clumps };
}

export function createFallingSand(context, destination, settings) {
  const { noise, clumps } = makeNoise(context);
  const level = context.createGain(), active = new Set();
  const tone = context.createBiquadFilter(), texture = context.createGain(), depth = context.createGain();
  const modulator = context.createBufferSource();
  tone.type = 'lowpass'; tone.Q.value = -3;
  texture.gain.value = .75;
  tone.connect(texture).connect(level).connect(destination);
  modulator.buffer = clumps; modulator.loop = true;
  modulator.connect(depth).connect(texture.gain);
  modulator.start();
  function configure(next, initial = false) {
    function set(param, value) {
      if (initial) param.value = value;
      else param.setTargetAtTime(value, context.currentTime, .015);
    }
    if (initial || next.volume !== settings.volume || next.sandLevel !== settings.sandLevel) set(level.gain, next.volume * next.sandLevel);
    if (initial || next.sandCutoffHz !== settings.sandCutoffHz) set(tone.frequency, next.sandCutoffHz);
    if (initial || next.sandTexture !== settings.sandTexture) set(depth.gain, next.sandTexture / 100);
    settings = next;
  }
  configure(settings, true);
  return {
    configure,
    hit(when, pan) {
      const start = when + settings.sandDelayMs / 1000;
      const crest = start + settings.sandRiseMs / 1000, end = crest + settings.sandDecayMs / 1000;
      const source = context.createBufferSource(), envelope = context.createGain(), stereo = context.createStereoPanner();
      source.buffer = noise; source.loop = true;
      stereo.pan.value = (pan - .5) * 1.2;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(1, crest);
      envelope.gain.exponentialRampToValueAtTime(.001, end);
      source.connect(envelope).connect(stereo).connect(tone);
      active.add(source);
      source.onended = () => {
        active.delete(source);
        source.disconnect(); envelope.disconnect(); stereo.disconnect();
      };
      source.start(start, Math.random() * noise.duration, end - start);
    },
    dispose() {
      level.disconnect();
      for (const source of active) source.stop();
      modulator.stop();
      for (const node of [modulator, depth, texture, tone]) node.disconnect();
    },
  };
}
