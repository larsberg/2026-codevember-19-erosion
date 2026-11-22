import { studioColorFields, migrateStudioColors } from './studio-palettes.js';

// Shared by the drawer and setup API so ranges and saved values agree.
export const lightingGroups = [
  { key: "spotlight", label: "Stage spotlight", fields: [
    ["enabled", "Enabled", true], ["color", "Color", "#ffffff"],
    ["intensity", "Intensity", 180000, 0, 300000, 10],
    ["offsetX", "Offset X", -30, -200, 200, 0.1],
    ["height", "Offset Y", 80, 1, 300, 0.1],
    ["offsetZ", "Offset Z", 50, -200, 200, 0.1],
    ["angle", "Cone half-angle °", 50, 10, 80, 1],
    ["penumbra", "Soft edge", 0.5, 0, 1, 0.01],
    ["castShadow", "Cast shadows", true],
    ["softness", "Shadow softness", 1.2, 0, 16, 0.1],
    ["shadowBias", "Shadow bias", -0.00001, -0.01, 0.01, 0.00001],
    ["normalBias", "Shadow normal bias", .002, 0, 0.1, 0.001],
  ] },
  { key: "directional", label: "Directional light", fields: [
    ["enabled", "Enabled", false], ["color", "Color", "#ffffff"],
    ["intensity", "Intensity", 3.2, 0, 10, 0.01],
    ["offsetX", "Offset X", -30, -200, 200, 0.1],
    ["height", "Offset Y", 9, 1, 30, 0.1],
    ["offsetZ", "Offset Z", 5, -20, 20, 0.1],
    ["castShadow", "Cast shadows", true],
    ["softness", "Shadow softness", 6, 0, 16, 0.1],
    ["shadowBias", "Shadow bias", 0, -0.01, 0.01, 0.00001],
    ["normalBias", "Shadow normal bias", .002, 0, 0.1, 0.001],
  ] },
  { key: "hemisphere", label: "Hemisphere light", fields: [
    ["enabled", "Enabled", true], ["skyColor", "Sky color", "#ffffff"],
    ["groundColor", "Ground color", "#acaaa6"],
    ["intensity", "Intensity", 2.2, 0, 10, 0.01],
    ["yaw", "Yaw °", 0, -180, 180, 1],
    ["tilt", "Tilt °", 0, 0, 180, 1],
  ] },
  { key: "environment", label: "Environment reflections", fields: [
    ["enabled", "Enabled", true],
    ["intensity", "Intensity", 1, 0, 3, 0.01],
    ["rotation", "Rotation °", 0, -180, 180, 1],
    // At the studio's 256px cube resolution PMREM's blur kernel supports .04
    // radians without clipping. Roughness supplies further material blur.
    ["blur", "Softbox blur", .04, 0, .04, .001],
    ...studioColorFields,
  ] },
  { key: "occlusion", label: "Contact shading · GTAO", fields: [
    ["enabled", "Enabled", true],
    ["intensity", "Strength", 1.5, 0, 5, 0.01],
    ["radius", "Radius", 0.8, 0.05, 3, 0.01],
    ["aoOnly", "AO only · preview", false],
  ] },
];

const directional = lightingGroups.find(group => group.key === 'directional');
const fillDefaults = { enabled: true, color: '#c0e4ff', intensity: 1.1, offsetX: 12, height: 8, offsetZ: -10, castShadow: false };
lightingGroups.splice(2, 0, { key: 'fill', label: 'Fill light', fields: directional.fields.map(([key, label, initial, ...range]) =>
  [key, label, fillDefaults[key] ?? initial, ...range]) });

export function defaultLighting() {
  return Object.fromEntries(lightingGroups.map(({ key, fields }) =>
    [key, Object.fromEntries(fields.map(([name, , value]) => [name, value]))]));
}

export function validateLighting(value) {
  const result = defaultLighting();
  // Earlier saves used the directional key light. Retain its palette color
  // while adopting the spotlight once; subsequent saves keep both toggles.
  if (value && value.spotlight === undefined) value = { ...value,
    spotlight: { ...result.spotlight, color: value.directional?.color ?? result.spotlight.color },
    directional: { ...value.directional, enabled: false } };
  for (const { key, fields } of lightingGroups) {
    for (const [name, , initial, min, max] of fields) {
      const field = value?.[key]?.[name];
      if (typeof initial === "number") {
        if (typeof field !== "number" || !Number.isFinite(field) || field < min || field > max)
          throw new Error(`Lighting ${key}.${name} must be between ${min} and ${max}.`);
      } else if (typeof initial === "boolean") {
        if (typeof field !== "boolean") throw new Error(`Lighting ${key}.${name} must be true or false.`);
      } else if (typeof field !== "string" || !/^#[0-9a-f]{6}$/i.test(field)) {
        throw new Error(`Lighting ${key}.${name} must be a six-digit hex color.`);
      }
      result[key][name] = typeof field === "string" ? field.toLowerCase() : field;
    }
  }
  result.environment = migrateStudioColors(result.environment);
  return result;
}
