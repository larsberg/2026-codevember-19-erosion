import { Color } from 'three';
import { CORE_RADIUS, DEFAULT_FLOOR_GAP, floorHeight } from './erosion-field.js';
import { defaultLighting, validateLighting } from './lighting-settings.js';
import { defaultMaterials, validateMaterials } from './material-settings.js';
import { defaultPaletteLibrary, validatePaletteLibrary, libraryPalettes } from './palette-library.js';

export const DEFAULT_CAMERA = { yaw: 22, elevation: 30, distance: 16, minDistance: 5, maxDistance: 600, offsetX: 0, offsetY: 0, offsetZ: 0 };
export const fields = {
  generation: { seed: ['Seed', 19, 0, 0xffffffff, 1] },
  motion: { playing: ['Playing', true] },
  physics: {
    sphereRadius: ['Sphere radius', CORE_RADIUS, .1, 2.5, .005],
    floorGap: ['Floor gap (units)', DEFAULT_FLOOR_GAP, .05, 4, .01],
    gravity: ['Attraction', 9.8, 0, 1000, .1], friction: ['Grain friction', 1.1, 0, 10, .01],
    damping: ['Velocity damping (1/s)', 0, 0, 8, .05],
    restitution: ['Collision bounce', 0, 0, 1, .01],
    stiffness: ['Contact stiffness', .4, .05, 1, .01],
    settleSpeed: ['Settling speed', .068, .001, .3, .001],
    rotationScale: ['Grain rotation scale (×)', 10, 0, 30, .1],
  },
  laser: {
    color: ['Line tint', '#403c38'],
    frequency: ['Pulse frequency (Hz)', .30, 0, 3, .01],
  },
  drafting: {
    darkMode: ['Dark Mode', false],
    gridOpacity: ['Floor grid opacity', .11, 0, 1, .01],
    gridDivisions: ['Grid cells per side', 24, 2, 96, 1],
    planOpacity: ['Grain projection opacity', .128, 0, 1, .001],
    planColor: ['Projection ink', '#615241'],
    pointSize: ['Projection dot size (px)', 1, 1, 8, 1],
    samplePercent: ['Grains plotted (%)', 100, 0, 100, 1],
    slice: ['Project a horizontal slice', false],
    sliceHeight: ['Slice center above floor (units)', -floorHeight(CORE_RADIUS), 0, 12, .005],
    sliceThickness: ['Slice thickness (units)', .25, .02, 6, .01],
  },
  darkPalette: {
    cyan: ['Cyan grains', '#00e4f2'], magenta: ['Magenta grains', '#fb25cc'],
    yellow: ['Yellow grains', '#fff02a'], white: ['White grains', '#f6faff'],
    background: ['Background', '#0b1119'], floor: ['Floor', '#141d28'],
    grid: ['Grid lines', '#899fb0'], axes: ['Grid axes', '#c4d6e6'],
    projection: ['Projection ink', '#a8b7c1'], beam: ['Laser line', '#dcdcdb'],
  },
  studio: { background: ['Background', '#eee9df'], exposure: ['Exposure', .9, .1, 3, .01], shadowOpacity: ['Ground shadow opacity', .32, 0, 1, .01] },
  bloom: { enabled: ['Enable bloom', false], strength: ['Bloom strength', .85, 0, 4, .05], radius: ['Bloom radius', .45, 0, 1, .01], threshold: ['Bloom threshold', 1.4, 0, 3, .01] },
  focus: { enabled: ['Tilt blur', false], tilt: ['Sharp band angle °', 0, -85, 85, 1], band: ['Sharp band half-width', .18, .02, .5, .01], strength: ['Blur amount', 1.5, 0, 8, .1], offset: ['Band vertical offset', 0, -.5, .5, .01] },
  audio: {
    enabled: ['Sound', true], volume: ['Volume', .3, 0, 1, .01],
    transpose: ['Pitch (semitones)', 0, -12, 12, 1],
    attackMs: ['Attack (ms)', 2, 1, 150, 1],
    lengthMs: ['Strike length (ms)', 840, 20, 1200, 1],
    releaseMs: ['Release (ms)', 140, 10, 600, 1],
    cutoffHz: ['Tone cutoff (Hz)', 360, 50, 1500, 5],
    echoLevel: ['Echo level', .14, 0, 1, .01],
    echoTimeMs: ['Echo time (ms)', 290, 40, 950, 5],
    echoFeedback: ['Echo feedback', .18, 0, .85, .01],
    sandLevel: ['Falling sand level', .55, 0, 1, .01],
    sandCutoffHz: ['Sand tone cutoff (Hz)', 330, 80, 4000, 5],
    sandTexture: ['Clumpiness (%)', 55, 0, 100, 1],
    sandDelayMs: ['Delay after strike (ms)', 220, 0, 2000, 5],
    sandRiseMs: ['Swell time (ms)', 340, 5, 1800, 5],
    sandDecayMs: ['Fade time (ms)', 860, 40, 4000, 10],
  },
  visibility: { fps: ['Show frame-rate meter', false] },
  camera: {
    yaw: ['Yaw', DEFAULT_CAMERA.yaw, -360, 360, .1], elevation: ['Elevation', DEFAULT_CAMERA.elevation, -85, 85, .1],
    distance: ['Distance', DEFAULT_CAMERA.distance, .1, 10000, 'any'],
    minDistance: ['Minimum distance', DEFAULT_CAMERA.minDistance, .1, 10000, 'any'],
    maxDistance: ['Maximum distance', DEFAULT_CAMERA.maxDistance, .1, 10000, 'any'],
    offsetX: ['Target X', 0, -200, 200, .01],
    offsetY: ['Target Y', 0, -200, 200, .01], offsetZ: ['Target Z', 0, -200, 200, .01],
  },
};


export function defaultSetup() {
  const result = Object.fromEntries(Object.entries(fields).map(([group, entries]) => [group,
    Object.fromEntries(Object.entries(entries).map(([key, [, initial]]) => [key, initial]))]));
  result.version = 2;
  result.sketch = '19-erosion';
  result.lighting = defaultLighting(); result.materials = defaultMaterials();
  result.lighting.spotlight.enabled = false;
  result.lighting.directional.enabled = true;
  result.lighting.directional.intensity = 1.4;
  result.lighting.hemisphere.intensity = 1.2;
  result.lighting.fill.enabled = false;
  result.lighting.occlusion.enabled = false;
  result.paletteLibrary = defaultPaletteLibrary();
  result.paletteId = 'ink';
  return result;
}
export function validateSetup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid setup.');
  if (value.sketch !== undefined && value.sketch !== '19-erosion') throw Error('Expected a 19-erosion setup file.');
  if (value.version !== undefined && ![0, 1, 2].includes(value.version)) throw Error('Unsupported setup version.');
  const result = defaultSetup();
  // Unversioned files retain edits and acquire missing studio defaults.
  for (const [group, entries] of Object.entries(fields)) for (const [key, [, initial, min, max]] of Object.entries(entries)) {
    const x = value[group]?.[key] ?? result[group][key];
    const valid = typeof initial === 'number' ? Number.isFinite(x) && x >= min && x <= max
      : typeof initial === 'boolean' ? typeof x === 'boolean' : typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
    if (!valid) throw Error(`Invalid ${group}.${key}.`);
    result[group][key] = x;
  }
  if (value.drafting?.planOpacity == null && value.studio?.shadowOpacity != null) {
    result.drafting.planOpacity = result.studio.shadowOpacity * .4;
  }
  const camera = result.camera;
  if (camera.minDistance > camera.maxDistance) throw Error('Minimum camera distance exceeds maximum distance.');
  camera.distance = Math.min(camera.maxDistance, Math.max(camera.minDistance, camera.distance));
  if (!Number.isInteger(result.generation.seed)) throw Error('Generation seed must be a whole number.');
  if (!Number.isInteger(result.drafting.gridDivisions)) throw Error('Grid cells per side must be a whole number.');
  result.lighting = validateLighting(Object.fromEntries(Object.entries(result.lighting).map(([key, defaults]) => [key, { ...defaults, ...value.lighting?.[key] }])));
  result.materials = validateMaterials(value.materials);
  // Earlier saves derived these four dark colors from the artist's light palette.
  if (!value.darkPalette) {
    const palette = result.darkPalette;
    palette.background = '#' + new Color(result.studio.background).multiply(new Color('#0d141e')).getHexString();
    palette.floor = '#' + new Color(result.materials.panels.color).multiply(new Color('#192435')).getHexString();
    palette.projection = '#' + new Color(result.drafting.planColor).lerp(new Color('#bbcfdd'), .72).getHexString();
    palette.beam = '#' + new Color(result.laser.color).lerp(new Color('#ffffff'), .70).getHexString();
  }
  result.paletteLibrary = validatePaletteLibrary(value.paletteLibrary ?? result.paletteLibrary);
  result.paletteId = value.paletteId ?? result.paletteId;
  if (!libraryPalettes(result.paletteLibrary).some(p => p.id === result.paletteId)) throw Error('Invalid palette.');
  return result;
}
