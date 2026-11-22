// The inherited Audio tab and setup file own the complete synth configuration.
export const audioFields = {
  enabled: ['Sound', false], volume: ['Volume', .3, 0, 1, .01], tempo: ['Tempo (BPM)', 80, 20, 200, 1],
};
export const waveforms = ['triangle', 'sine', 'sawtooth', 'square'];
export const VOICE_NAMES = ['A', 'B'];
export const voiceFields = {
  level: ['Level', .6, 0, 1, .01], gate: ['Gesture length', .7, .1, 1, .01],
  attack: ['Attack (s)', .006, .001, 1, .001], decay: ['Decay (s)', .15, .01, 2, .01],
  sustain: ['Sustain', .8, 0, 1, .01], release: ['Release (s)', .025, .01, 2, .01],
  lowpass: ['Low-pass cutoff (Hz)', 4800, 20, 16000, 10], resonance: ['Filter resonance', .7, .1, 12, .1],
  highpass: ['High-pass cutoff (Hz)', 20, 10, 2000, 10],
  fm: ['FM depth', .1, 0, 12, .05], harmonicity: ['FM ratio', 2, .25, 8, .05],
  drive: ['Drive', .04, 0, 3, .01], pan: ['Pan', .5, 0, 1, .01],
  reverb: ['Reverb send', .12, 0, 1, .01], roomSize: ['Room size', .6, .1, 4, .1],
  delay: ['Delay send', .06, 0, 1, .01], delayTime: ['Delay spacing (beats)', .75, .125, 2, .125],
  delayFeedback: ['Delay feedback', .25, 0, .75, .01],
};
// Editable output endpoints bound the height mapping, including inverted ranges.
export const modulationTargets = {
  lowpass: ['Low-pass cutoff', 'Hz', 120, 4800], resonance: ['Filter resonance', '', .4, 6],
  highpass: ['High-pass cutoff', 'Hz', 15, 180], fm: ['FM depth', '', .1, 5],
  harmonicity: ['FM ratio', '', .5, 4], drive: ['Drive', '', .02, 1.5],
  delay: ['Delay send', '', .02, .65], reverb: ['Reverb send', '', .03, .8],
  pan: ['Pan', '', .2, .8],
};
export function defaultVoices() {
  return [0, 1].map(index => ({
    ...Object.fromEntries(Object.entries(voiceFields).map(([key, [, initial]]) => [key, initial])),
    enabled: true, sound: index ? 'triangle' : 'sine', note: index ? 43 : 74,
    rhythm: index ? 'x.....x.' : '..x.x..x',
    lowpass:index?7000:2600,fm:index?1:.18,attack:index?.006:.003,release:index?.14:.06,reverb:.02,delay:0,
    level: index ? .28 : .24, pan: index ? .65 : .35, gate: .88,
    modulations: Object.fromEntries(Object.entries(modulationTargets).map(([key, [,, min, max]], i) => [key, {
      enabled: false,
      corner: index ? 15 - i : i, heightMin: 0, heightMax: 4, min, max,
    }])),
  }));
}

export function validateVoices(value = defaultVoices()) {
  if (!Array.isArray(value) || value.length !== 2) throw Error('Use two synth voices.');
  return value.map((voice, i) => {
    const result = defaultVoices()[i], fail = key => { throw Error(`Invalid audio.voices.${i}.${key}.`); };
    if (!voice || typeof voice !== 'object') fail('voice');
    for (const [key, [,, min, max]] of Object.entries(voiceFields)) {
      const x = voice[key] ?? result[key];
      if (!Number.isFinite(x) || x < min || x > max) fail(key);
      result[key] = x;
    }
    result.enabled = voice.enabled ?? result.enabled; if (typeof result.enabled !== 'boolean') fail('enabled');
    result.sound = voice.sound ?? result.sound; if (!waveforms.includes(result.sound)) fail('sound');
    result.note = voice.note ?? result.note; if (!Number.isInteger(result.note) || result.note < 24 || result.note > 96) fail('note');
    result.rhythm = voice.rhythm ?? result.rhythm;
    if (typeof result.rhythm !== 'string' || !/^[xX.\-]{1,32}$/.test(result.rhythm)) fail('rhythm');
    result.rhythm = result.rhythm.toLowerCase().replaceAll('-', '.');
    for (const key of Object.keys(modulationTargets)) {
      const route = { ...result.modulations[key], ...voice.modulations?.[key] };
      if (typeof route.enabled !== 'boolean' || !Number.isInteger(route.corner) || route.corner < 0 || route.corner > 15
        || !['heightMin', 'heightMax', 'min', 'max'].every(field => Number.isFinite(route[field]))
        || route.heightMin === route.heightMax) fail(`modulations.${key}`);
      result.modulations[key] = route;
    }
    return result;
  });
}
