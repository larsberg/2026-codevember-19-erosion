import { modulateVoice } from './synth.js';

// Native Strudel bus modulators feed AudioParams on the sounding synth and
// effect nodes. These are control signals only; Strudel creates all the audio.
const targets = {
  lowpass: ['cutoff', 1], resonance: ['resonance', .001], highpass: ['hcutoff', 1],
  fm: ['fmi', .001], harmonicity: ['fmh', .001], drive: ['distort', .001],
  delay: ['delay', .001], reverb: ['room', .001], pan: ['pan', .5], gain: ['gain', .001],
};
const busId = (voice, index) => 100 + voice * 32 + index;
const frequency = note => 440 * 2 ** ((note - 69) / 12);

export function liveSynthValue(value, voice) {
  const result = { ...value }, ids = Object.keys(targets);
  result.bmod = { __ids: ids };
  ids.forEach((key, i) => {
    const [control, baseline] = targets[key];
    result[control] = baseline;
    // The engine scales bus input by depthabs / .3. Use unity gain.
    result.bmod[key] = { bus: busId(voice, i), control, depthabs: .3 };
  });
  return result;
}

export function createLiveModulation(api, context) {
  const sources = [0, 1].map(voice => Object.fromEntries(Object.keys(targets).map((key, i) => {
    const source = context.createConstantSource();
    source.offset.value = 0;
    source.connect(api.getSuperdoughAudioController().getBus(busId(voice, i)));
    source.start();
    return [key, source];
  })));
  let values = [], updates = 0;
  return {
    update(audio, positions, floor) {
      values = audio.voices.map(voice => modulateVoice(voice, positions, floor).parameters);
      values.forEach((p, voice) => {
        const hz = frequency(p.note);
        // FM gain is multiplied by its initial modulator frequency in Strudel.
        const offsets = { lowpass: p.lowpass - 1, resonance: p.resonance - .001, highpass: p.highpass - 1,
          fm: p.fm * p.harmonicity / .001 - .001, harmonicity: hz * (p.harmonicity - .001),
          drive: p.drive - .001, delay: p.delay - .001, reverb: p.reverb - .001, pan: 2 * p.pan - 1,
          gain: (audio.enabled && p.enabled ? audio.volume * p.level * .65 : 0) - .001 };
        for (const [key, value] of Object.entries(offsets)) {
          // Smooth frame-rate steps after the height mapping is clamped.
          sources[voice][key].offset.setTargetAtTime(value, context.currentTime, .015);
        }
      });
      updates++;
    },
    get diagnostics() { return { updates, values: values.map(p => Object.fromEntries(Object.keys(targets).filter(k => k !== 'gain').map(k => [k, p[k]]))) }; },
    dispose() { for (const voice of sources) for (const source of Object.values(voice)) { source.stop(); source.disconnect(); } },
  };
}
