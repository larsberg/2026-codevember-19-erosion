import { attachPlayerBridge } from './player-bridge.js';
// Studio shell inherited from 12-feather.
import './style.css';
import './mesh-style.css';
import {
  ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PCFShadowMap,
  GridHelper, MOUSE, TOUCH, PerspectiveCamera, PMREMGenerator, Scene, SpotLight, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyCameraView, captureCameraView, configureOrbitInputs } from './camera.js';
import { initPhysics } from './physics.js';
import { createErosion } from './erosion.js';
import { FLOOR_Y } from './erosion-field.js';
import { createControls } from './controls.js';
import { defaultSetup, validateSetup, DEFAULT_CAMERA } from './settings.js';
import { requestSetup } from './persistence.js';
import { libraryPalettes } from './palette-library.js';

import { createStageFloor, createShadowFollow } from './shadows.js';
import { applyStudioLighting, bindLightingControls } from './lighting-controls.js';
import { drawerRequested } from './drawer-url.js';
import { applyMaterialSettings } from './material-settings.js';
import { bindMaterialControls } from './material-controls.js';
import { applyStudioPalette } from './studio-palettes.js';
import { createSceneEffects } from './scene-effects.js';
import { createAudio } from './score.js';
let settings = defaultSetup(), setupLoadError;
try { settings = await requestSetup(); } catch (error) { setupLoadError = error.message; console.warn(error.message); }
await initPhysics();
const canvas = document.querySelector('canvas');
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
const scene = new Scene(); scene.background = new Color(settings.studio.background);
// Preserve the studio camera range.
const camera = new PerspectiveCamera(42, innerWidth / innerHeight, .1, 900);
const orbit = new OrbitControls(camera, canvas);
configureOrbitInputs(orbit);
orbit.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
orbit.enablePan = true; orbit.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
orbit.minDistance = 5; orbit.maxDistance = 600; orbit.minPolarAngle = .09; orbit.maxPolarAngle = Math.PI - .09;
orbit.enableDamping = true; orbit.dampingFactor = .07;
const focus = new Vector3();
const pmrem = new PMREMGenerator(renderer), room = new RoomEnvironment();
let environmentBlur = settings.lighting.environment.blur;
let environment = pmrem.fromScene(room, environmentBlur); scene.environment = environment.texture;
function configureEnvironment() {
  const blur = settings.lighting.environment.blur;
  if (blur === environmentBlur) return;
  const previous = environment;
  environment = pmrem.fromScene(room, blur); environmentBlur = blur;
  scene.environment = environment.texture;
  floor.material.envMap = environment.texture;
  previous.dispose();
}
const hemisphere = new HemisphereLight('#fff8ed', '#7e8b9d', 1.4); scene.add(hemisphere);
const light = new DirectionalLight('#fff5df', 3.1);
light.position.set(-8, 18, 10); light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
Object.assign(light.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: .5, far: 900 });
light.shadow.camera.updateProjectionMatrix();
light.shadow.bias = -.00015; light.shadow.normalBias = .04; light.shadow.radius = 3;
scene.add(light, light.target);
const lightOffset = new Vector3();
const followShadow = createShadowFollow(light, () => { const l = settings.lighting.directional; return lightOffset.set(l.offsetX, l.height, l.offsetZ); });
const fill = new DirectionalLight('#c0e4ff', 1.1); fill.position.set(12, 8, -10);
fill.shadow.mapSize.set(2048, 2048); Object.assign(fill.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: .5, far: 900 });
fill.shadow.camera.updateProjectionMatrix();
scene.add(fill, fill.target);
const spotlight = new SpotLight(); spotlight.shadow.mapSize.set(2048, 2048);
spotlight.shadow.camera.near = 1; spotlight.shadow.camera.far = 240; scene.add(spotlight, spotlight.target);
const effects = createSceneEffects(renderer, scene, camera, { clampBeauty: false });

// The floor carries the live stippled plan of the grain stream.
const span = 24;
const floor = createStageFloor(span);
floor.position.y = FLOOR_Y;
floor.layers.enable(1);
floor.material.envMap = environment.texture;
const grid = new GridHelper(span, span, '#545755', '#88877e');
grid.position.y = FLOOR_Y + .004;
grid.material.transparent = true;
grid.material.opacity = .11;
grid.material.depthWrite = false;
scene.add(floor, grid);

let simulation;
function rebuild(next) {
  const candidate = createErosion(renderer, next);
  candidate.configure(next);
  simulation?.dispose();
  simulation = candidate;
  scene.add(simulation.root);
}
rebuild(settings);
let controls, lightingControls, materialControls;
let audioStatus;
const audio = createAudio({ onStatus(state) {
  audioStatus = state;
  controls?.audioStatus(state);
} });
const lights = { directional: light, hemisphere, spotlight, fill };
const running = () => settings.motion.playing && !document.hidden;

function configure(restoreCamera = false) {
  simulation.configure(settings);
  scene.background.set(settings.studio.background);
  renderer.toneMappingExposure = settings.studio.exposure;
  applyMaterialSettings(floor.material, settings.materials.panels, 'panels');
  materialControls?.set(settings.materials);
  configureEnvironment();
  const env = settings.lighting.environment;
  scene.environmentRotation.y = env.rotation * Math.PI / 180;
  scene.environmentIntensity = env.enabled ? env.intensity : 0;
  floor.material.envMapRotation.y = scene.environmentRotation.y;
  floor.material.envMapIntensity *= env.enabled ? env.intensity : 0;
  applyStudioLighting(settings.lighting, lights, focus);
  lightingControls?.set(settings.lighting);
  for (const source of [light, fill, spotlight]) source.shadow.intensity = settings.studio.shadowOpacity;
  effects.configure(settings.lighting.occlusion);
  effects.configureBloom(settings.bloom);
  effects.configureFocus(settings.focus);
  audio.update(0, running());
  audio.configure(settings.audio);
  if (restoreCamera) applyCameraView(settings.camera, camera, orbit, focus);
  if (settings.visibility.fps && !controls) mountControls();
  controls?.set(settings);
}

function restore(value) {
  const next = validateSetup(value);
  rebuild(next);
  settings = next;
  document.activeElement?.blur();
  configure(true);
  controls?.syncPalette();
}

function change(group, key, value) {
  const next = { ...settings, [group]: { ...settings[group], [key]: value } };
  settings = validateSetup(next);
  configure(group === 'camera');
  controls?.status('Unsaved changes');
}

function render() {
  followShadow(focus);
  effects.render(focus);
}

const actions = {
  change,
  async save() {
    settings.camera = captureCameraView(camera, orbit, focus);
    const saved = await requestSetup('PUT', settings);
    controls?.status(import.meta.env.PROD ? 'Saved on this device.' : 'Saved to public/settings.json.');
    return saved;
  },
  async reload() {
    restore(await requestSetup());
    controls?.status('Settings reloaded.');
    return structuredClone(settings);
  },
  reset() {
    restore(defaultSetup());
    controls?.status('Defaults restored.');
  },
  regenerate() {
    const generation = { seed: crypto.getRandomValues(new Uint32Array(1))[0] };
    const next = { ...settings, generation };
    rebuild(next);
    settings = next;
    controls?.set(settings);
    controls?.status('Unsaved changes');
  },
  resetView() { settings.camera = { ...DEFAULT_CAMERA }; configure(true); },
  togglePlaying() { change('motion', 'playing', !settings.motion.playing); },
  toggleSound() { actions.setSoundEnabled(!settings.audio.enabled); },
  setSoundEnabled(value) {
    change('audio', 'enabled', value);
    if (value) return audio.unlock();
  },
  async audition() {
    if (!running()) return;
    await actions.setSoundEnabled(true);
    if (audio.unlocked) audio.update(0, running(), undefined, 0, [
      { from: -1e-9, to: 0, duration: 60 / settings.audio.tempo, serial: 0 },
    ]);
  },
  selectPalette(id) {
    settings.lighting = applyStudioPalette(settings.lighting, id, libraryPalettes(settings.paletteLibrary));
    settings.paletteId = id;
    configure();
    controls?.status('Unsaved changes');
  },
  changeLibrary(library) {
    settings.paletteLibrary = library;
    controls?.set(settings);
    controls?.syncPalette();
    controls?.status('Unsaved changes');
  },
  exportDrawing() {
    render();
    canvas.toBlob(blob => {
      if (!blob) return controls?.status('PNG export failed.', true);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url;
      link.download = '19-erosion.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  },
};
function mountControls() {
  if (controls) return;
  controls = createControls({ ...actions, settings });
  lightingControls = bindLightingControls(controls.element, (group, key, value) => {
    change('lighting', group, { ...settings.lighting[group], [key]: value });
  });
  materialControls = bindMaterialControls(controls.element, (group, key, value) => {
    change('materials', group, { ...settings.materials[group], [key]: value });
  });
  lightingControls.set(settings.lighting);
  materialControls.set(settings.materials);
  controls.set(settings);
  controls.showControls(false);
  if (audioStatus) controls.audioStatus(audioStatus);
  if (setupLoadError) controls.status(setupLoadError, true);
}

let uiVisible = false;
function showControls(show) {
  if (show) mountControls();
  uiVisible = show;
  controls?.showControls(show);
}
let urlFlag = drawerRequested(location.href);
configure(true);
showControls(urlFlag);
window.addEventListener('hashchange', () => {
  const next = drawerRequested(location.href);
  if (next !== urlFlag) showControls(next);
  urlFlag = next;
});
document.addEventListener('keydown', event => {
  if (!document.hasFocus() || event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
      event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  switch (event.code) {
    case 'KeyH': event.preventDefault(); showControls(!uiVisible); break;
    case 'Escape': controls?.close(); break;
    case 'KeyP': event.preventDefault(); actions.togglePlaying(); break;
    case 'KeyM': actions.toggleSound(); break;
    case 'KeyF': void actions.audition(); break;
  }
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  effects.resize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.zoom = Math.min(1, camera.aspect);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
orbit.addEventListener('end', () => {
  settings.camera = captureCameraView(camera, orbit, focus);
  controls?.set(settings);
});
canvas.addEventListener('pointerdown', () => {
  if (settings.audio.enabled) void audio.unlock();
});

let previousTime;
renderer.setAnimationLoop(now => {
  const dt = (now - (previousTime ?? now)) / 1000;
  previousTime = now;
  if (running()) simulation.step(dt, settings.audio.tempo, audio);
  else audio.update(0, false);
  orbit.update();
  render();
  controls?.frame(audio);
});
document.addEventListener('visibilitychange', () => {
  previousTime = undefined;
  audio.update(0, running());
});

const sketch = {
  getSetup: () => structuredClone(settings),
  getState: () => ({ playing: settings.motion.playing, physics: 'Box3D', ...simulation.state, audio: audio.diagnostics }),
  setup(value) { restore(value); return sketch.getSetup(); },
  play() { if (!settings.motion.playing) actions.togglePlaying(); },
  pause() { if (settings.motion.playing) actions.togglePlaying(); },
  reset: actions.reset, saveSetup: actions.save, loadSetup: actions.reload,
};
window.__erosionSketch = sketch;
const detachPlayer = attachPlayerBridge(sketch);
window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null);
  detachPlayer();
  audio.dispose();
  simulation.dispose();
  orbit.dispose();
  effects.dispose();
  floor.geometry.dispose();
  floor.material.dispose();
  grid.dispose();
  for (const source of [light, fill, spotlight]) source.shadow.dispose();
  environment.dispose();
  room.dispose();
  pmrem.dispose();
  renderer.dispose();
  window.removeEventListener('resize', resize);
}, { once: true });
