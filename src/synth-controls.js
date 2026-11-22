import { defaultVoices, modulationTargets, voiceFields, waveforms, VOICE_NAMES } from './synth-settings.js';

const noteName = midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
export function synthControlsMarkup() {
  const slider = (voice, key) => {
    const [label,, min, max, step] = voiceFields[key], id = `synth-${voice}-${key}`;
    return `<label class="slider-label" for="${id}">${label}<output></output></label><input id="${id}" data-synth-voice="${voice}" data-synth-key="${key}" type="range" min="${min}" max="${max}" step="${step}">`;
  };
  return defaultVoices().map((voice, i) => `
    <details class="material-group" open><summary>Voice ${i + 1} · ${VOICE_NAMES[i]}</summary>
      <label class="lighting-toggle"><input type="checkbox" id="synth-${i}-enabled" data-synth-voice="${i}" data-synth-key="enabled">Enabled</label>
      <label class="audio-field">Waveform<select id="synth-${i}-sound" data-synth-voice="${i}" data-synth-key="sound">${waveforms.map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
      <label class="audio-field">Note<select id="synth-${i}-note" data-synth-voice="${i}" data-synth-key="note">${Array.from({ length: 73 }, (_, n) => n + 24).map(note => `<option value="${note}">${noteName(note)}</option>`).join('')}</select></label>
      <label class="audio-field">Rhythm<input id="synth-${i}-rhythm" data-synth-voice="${i}" data-synth-key="rhythm" type="text" maxlength="32" required spellcheck="false" aria-label="Voice ${i + 1} rhythm"></label>
      ${['level', 'gate'].map(key => slider(i, key)).join('')}
      <details class="material-group"><summary>Envelope</summary>${['attack', 'decay', 'sustain', 'release'].map(key => slider(i, key)).join('')}</details>
      <details class="material-group"><summary>Filters and effects</summary><p class="camera-hint">Base values apply when a parameter's height mapping is off.</p>${Object.keys(voiceFields).filter(key => !['level', 'gate', 'attack', 'decay', 'sustain', 'release'].includes(key)).map(key => slider(i, key)).join('')}</details>
      <p class="control-heading">Body height modulation</p><p class="camera-hint">Height above the ground colors each gesture when it starts. Values stay within your output min and max, including during high jumps. Swap output endpoints to invert it.</p>
      ${Object.entries(modulationTargets).map(([key, [label, unit]]) => `<details class="material-group synth-route"><summary>${label}</summary>
        <label class="lighting-toggle"><input id="synth-${i}-${key}-enabled" data-synth-voice="${i}" data-synth-route="${key}" data-synth-key="enabled" type="checkbox">Use body height</label>
        <label class="audio-field">Body<select id="synth-${i}-${key}-corner" data-synth-voice="${i}" data-synth-route="${key}" data-synth-key="corner">${Array.from({ length: 16 }, (_, n) => `<option value="${n}">Body ${n + 1}</option>`).join('')}</select></label>
        <div class="synth-range">${[['heightMin', 'Height min'], ['heightMax', 'Height max'], ['min', `Output min ${unit}`], ['max', `Output max ${unit}`]].map(([field, title]) => `<label class="audio-field">${title}<input id="synth-${i}-${key}-${field}" data-synth-voice="${i}" data-synth-route="${key}" data-synth-key="${field}" type="number" step="any" required></label>`).join('')}</div>
        <output class="audio-position" data-synth-value="${i}:${key}"></output>
      </details>`).join('')}
    </details>`).join('');
}

export function bindSynthControls(root, { getVoices, change }) {
  const inputs = [...root.querySelectorAll('[data-synth-voice][data-synth-key]')];
  function sync() {
    const voices = getVoices();
    for (const input of inputs) {
      const { synthVoice, synthKey, synthRoute } = input.dataset;
      const values = synthRoute ? voices[synthVoice].modulations[synthRoute] : voices[synthVoice], value = values[synthKey];
      if (input.type === 'checkbox') input.checked = value;
      else if (input !== root.ownerDocument?.activeElement) input.value = value;
      const output = root.querySelector(`label[for="${input.id}"] output`); if (output) output.value = String(value);
    }
  }
  for (const input of inputs) {
    input.addEventListener(input.type === 'range' || input.type === 'checkbox' ? 'input' : 'change', () => {
      if (!input.checkValidity() || input.value === '') return;
      const { synthVoice, synthKey, synthRoute } = input.dataset, voices = structuredClone(getVoices());
      const values = synthRoute ? voices[synthVoice].modulations[synthRoute] : voices[synthVoice];
      values[synthKey] = input.type === 'checkbox' ? input.checked : ['sound', 'rhythm'].includes(synthKey) ? input.value : Number(input.value);
      change(voices);
    });
    input.addEventListener('blur', sync);
  }
  return { sync, frame(modulation) {
    for (const output of root.querySelectorAll('[data-synth-value]')) {
      const [index, key] = output.dataset.synthValue.split(':'), route = modulation[index]?.[key];
      if (route) output.value = `${route.enabled ? `Body ${route.corner + 1} · ${route.height.toFixed(2)} →` : 'Base →'} ${Number(route.value.toFixed(3))} ${modulationTargets[key][1]}`;
    }
  } };
}
