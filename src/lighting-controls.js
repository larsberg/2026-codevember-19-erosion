import { lightingGroups } from './lighting-settings.js';

const controlGroups = lightingGroups.map(group => group.key === 'environment'
  ? { ...group, label: 'Softbox reflections', fields: group.fields.filter(([name]) => ['enabled', 'intensity', 'rotation', 'blur'].includes(name)) }
  : { ...group, label: group.key === 'directional' ? 'Studio key light' : group.key === 'hemisphere' ? 'Soft fill' : group.label });

export function lightingControlsMarkup() {
  return `<p class="camera-hint">Each light's shadow controls affect that light only when it is enabled.</p>` + controlGroups.map(({ key, label, fields }) => `
    <details class="material-group" ${key === 'spotlight' ? 'open' : ''}>
      <summary>${label}</summary>
      ${key === 'environment' ? '<p class="camera-hint">Neutral studio softboxes shape the reflections. Adjust their strength, rotation and blur.</p>' : ''}
      ${fields.map(([name, title, initial, min, max, step]) => {
        const id = `lighting-${key}-${name}`;
        if (typeof initial === 'boolean') return `<label class="lighting-toggle"><input id="${id}" type="checkbox" ${initial ? 'checked' : ''}>${title}</label>`;
        if (typeof initial === 'string') return `<label class="color-label" for="${id}">${title}<output>${initial}</output><input id="${id}" type="color" value="${initial}"></label>`;
        return `<label class="slider-label" for="${id}">${title}<output>${initial}</output></label>
          <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${initial}">`;
      }).join('')}
    </details>`).join('');
}

export function applyStudioLighting(settings, lights, center) {
  for (const key of ['directional', 'fill', 'spotlight']) {
    const source = lights[key], value = settings[key];
    source.visible = value.enabled;
    source.color.set(value.color);
    source.intensity = value.intensity;
    source.castShadow = value.castShadow;
    source.shadow.radius = value.softness;
    source.shadow.bias = value.shadowBias;
    source.shadow.normalBias = value.normalBias;
    source.position.set(center.x + value.offsetX, center.y + value.height, center.z + value.offsetZ);
    source.target.position.copy(center);
  }
  lights.spotlight.angle = settings.spotlight.angle * Math.PI / 180;
  lights.spotlight.penumbra = settings.spotlight.penumbra;
  const { hemisphere } = lights, value = settings.hemisphere;
  hemisphere.visible = value.enabled;
  hemisphere.color.set(value.skyColor);
  hemisphere.groundColor.set(value.groundColor);
  hemisphere.intensity = value.intensity;
  hemisphere.position.setFromSphericalCoords(1, value.tilt * Math.PI / 180, value.yaw * Math.PI / 180);
}

export function bindLightingControls(root, change) {
  const inputs = [];
  for (const { key, fields } of controlGroups) for (const [name] of fields) {
    const input = root.querySelector(`#lighting-${key}-${name}`);
    const output = root.querySelector(`label[for="${input.id}"] output`);
    inputs.push({ key, name, input, output });
    input.addEventListener('input', () => {
      const value = input.type === 'checkbox' ? input.checked : input.type === 'color' ? input.value : Number(input.value);
      change(key, name, value);
    });
  }
  return { set(settings) {
    for (const { key, name, input, output } of inputs) {
      const value = settings[key][name];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      if (output) output.value = String(value);
    }
  } };
}
