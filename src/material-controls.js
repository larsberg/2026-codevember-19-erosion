import { defaultMaterials, materialFieldsFor, materialGroups } from "./material-settings.js";

export function materialControlsMarkup() {
  const defaults = defaultMaterials();
  return materialGroups.map(([group, name], index) => {
    const values = defaults[group];
    const color = (key, label) => `<label class="color-label" for="material-${group}-${key}">
      ${label}<output>${values[key]}</output><input id="material-${group}-${key}" type="color" value="${values[key]}">
    </label>`;
    const slider = ([key, label, min, max, step]) => `<label class="slider-label" for="material-${group}-${key}">${label} <output>${values[key]}</output></label>
      <input id="material-${group}-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${values[key]}">`;
    const fields = materialFieldsFor(group);
    return `<details class="material-group" ${index === 0 ? "open" : ""}>
      <summary>${name}</summary>
      ${color('color', 'Color tint')}
      <p class="control-heading">Emission</p>
      ${color('emissive', 'Emission color')}
      ${slider(fields.find(([key]) => key === 'emissiveIntensity'))}
      <p class="control-heading">Surface</p>
      ${fields.filter(([key]) => key !== 'emissiveIntensity').map(slider).join('')}
      <div class="visibility-controls material-toggles">
        ${[["wireframe", "Wireframe"], group === 'panels' ? ['depthWrite', 'Write depth'] : ["flatShading", "Flat shading"]].map(([key, label]) =>
          `<label><input id="material-${group}-${key}" type="checkbox">${label}</label>`).join("")}
      </div>
    </details>`;
  }).join("");
}

export function bindMaterialControls(root, change) {
  const inputs = [];
  for (const [group, values] of Object.entries(defaultMaterials())) for (const key of Object.keys(values)) {
    const input = root.querySelector(`#material-${group}-${key}`);
    if (!input) continue;
    const output = root.querySelector(`label[for="${input.id}"] output`);
    inputs.push({ group, key, input, output });
    input.addEventListener('input', () => {
      const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
      change(group, key, value);
    });
  }
  return { set(settings) {
    for (const { group, key, input, output } of inputs) {
      const value = settings[group][key];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      if (output) output.value = String(value);
    }
  } };
}
