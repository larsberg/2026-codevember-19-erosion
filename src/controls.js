import { lightingControlsMarkup } from './lighting-controls.js';
import { materialControlsMarkup } from './material-controls.js';
import { fields } from './settings.js';
import { synthControlsMarkup, bindSynthControls } from './synth-controls.js';
import { libraryPalettes } from './palette-library.js';
import { paletteWorkshopMarkup, bindPaletteWorkshop } from './palette-workshop.js';
import Stats from 'three/addons/libs/stats.module.js';
const icon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const paths={pause:'M8 5v14M16 5v14',play:'m8 5 11 7-11 7Z',restart:'M3 4v6h6M3 10a8 8 0 1 1 2 8',save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',reload:'M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 7v5l-5-5'};
function field(group,key){const [label,initial,min,max,step]=fields[group][key],id=`${group}-${key}`,data=`data-group="${group}" data-key="${key}"`;
  if(typeof initial==='boolean')return `<label class="lighting-toggle"><input id="${id}" ${data} type="checkbox">${label}</label>`;
  if(typeof initial==='string')return `<label class="color-label" for="${id}">${label}<output></output><input id="${id}" ${data} type="color"></label>`;
  if(group==='camera'||key==='seed')return `<label for="${id}">${label}<input id="${id}" ${data} type="number" min="${min}" max="${max}" step="${step}"></label>`;
  return `<label class="slider-label" for="${id}">${label}<output></output></label><input id="${id}" ${data} type="range" min="${min}" max="${max}" step="${step}">`;
}
export function createControls({settings,change,save,reload,resetView,exportDrawing,togglePlaying,toggleSound,setSoundEnabled,audition,reset,regenerate,selectPalette,changeLibrary}) {
  const shell=document.querySelector('.sketch'),tabs=['Mesh','Motion','Physics','Palettes','Audio','Materials','Lighting','Camera','Info'];
  const group=(g,keys=Object.keys(fields[g]))=>keys.map(k=>field(g,k)).join('');
  const saveLabel=import.meta.env?.PROD?'Save on this device':'Save settings';
  shell.insertAdjacentHTML('beforeend',`
    <button class="icon-button drawer-toggle" aria-label="Open controls" title="Open controls" aria-expanded="false" aria-controls="controls-drawer">${icon('m6 6 12 12M18 6 6 18')}</button>
    <aside id="controls-drawer" class="control-panel" aria-label="Sketch controls" hidden>
      <div class="drawer-header"><div class="panel-toolbar">
        <button class="icon-button run" aria-label="Pause" title="Pause">${icon(paths.pause)}</button>
        <button class="icon-button restart" aria-label="Reset settings" title="Reset settings">${icon(paths.restart)}</button>
        <button class="icon-button save-setup" aria-label="${saveLabel}" title="${saveLabel}">${icon(paths.save)}</button>
        <button class="icon-button reload-setup" aria-label="Reload saved settings" title="Reload saved settings">${icon(paths.reload)}</button>
      </div></div>
      <label class="fps-toggle"><input id="visibility-fps" data-group="visibility" data-key="fps" type="checkbox">Show frame-rate meter</label>
      <div class="control-tabs" role="tablist" aria-label="Control sections">${tabs.map((name,i)=>`<button id="tab-${name.toLowerCase()}" role="tab" aria-controls="panel-${name.toLowerCase()}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${name}</button>`).join('')}</div>
      <div class="drawer-content"><p class="setup-status" role="status" aria-live="polite"></p><fieldset class="panel-body">
        <section id="panel-mesh" role="tabpanel" aria-labelledby="tab-mesh"><button data-action="export">Export PNG</button></section>
        <section id="panel-motion" role="tabpanel" aria-labelledby="tab-motion" hidden><button data-action="regenerate">Regenerate</button></section>
        <section id="panel-physics" role="tabpanel" aria-labelledby="tab-physics" hidden>${group('physics')}<p class="control-heading">Laser</p>${group('laser')}</section>
        <section id="panel-palettes" role="tabpanel" aria-labelledby="tab-palettes" hidden>${paletteWorkshopMarkup()}</section>
        <section id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" hidden><p class="control-heading">Strudel</p><div class="audio-toolbar"><button type="button" class="audio-start">Enable sounds</button><button type="button" class="audio-stop">Mute sounds</button><button type="button" data-action="audition">Preview voices (F)</button></div><p class="audio-status" role="status">Sounds muted</p>${group('audio',['volume','tempo'])}${synthControlsMarkup()}</section>
        <section id="panel-materials" role="tabpanel" aria-labelledby="tab-materials" hidden>${materialControlsMarkup()}</section>
        <section id="panel-lighting" role="tabpanel" aria-labelledby="tab-lighting" hidden><p class="control-heading">Studio</p>${group('studio')}${lightingControlsMarkup()}<details class="material-group"><summary>Bloom</summary>${group('bloom')}</details></section>
        <section id="panel-camera" role="tabpanel" aria-labelledby="tab-camera" hidden><div class="camera-controls">${group('camera')}</div><button class="reset-camera">Reset view</button><details class="material-group"><summary>Tilt blur</summary>${group('focus')}</details></section>
        <section id="panel-info" role="tabpanel" aria-labelledby="tab-info" hidden><p class="camera-hint">Left-drag to orbit. Right-drag to pan. Scroll to zoom.</p><p class="camera-hint">P pause · H controls · M sound · F preview voices</p></section>
      </fieldset></div>
    </aside>`);
  const query=s=>shell.querySelector(s),drawer=query('.control-panel'),toggle=query('.drawer-toggle');
  let ui=false,current=settings,stats;
  function showControls(enabled){
    ui=enabled;
    toggle.hidden=!enabled;
    toggle.disabled=!enabled;
    drawer.inert=!enabled;
    shell.classList.toggle('controls-visible',enabled);
    if(enabled)open(true);
    else{drawer.hidden=true;toggle.setAttribute('aria-expanded','false');}
  }
  function open(on){if(!ui)return;drawer.hidden=!on;toggle.setAttribute('aria-expanded',String(on));toggle.title=on?'Close controls':'Open controls';toggle.setAttribute('aria-label',toggle.title);if(document.hasFocus())(on?drawer.querySelector('button'):toggle).focus({preventScroll:true});}
  toggle.addEventListener('click',()=>open(drawer.hidden));
  const tabButtons=[...shell.querySelectorAll('[role="tab"]')];
  function select(tab){for(const item of tabButtons){const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;query(`#${item.getAttribute('aria-controls')}`).hidden=!active;}query('.drawer-content').scrollTop=0;shell.dispatchEvent(new CustomEvent('control-tab-change',{detail:tab.id}));}
  tabButtons.forEach((tab,i)=>{tab.addEventListener('click',()=>select(tab));tab.addEventListener('keydown',e=>{const next=e.key==='ArrowRight'?tabButtons[(i+1)%tabButtons.length]:e.key==='ArrowLeft'?tabButtons[(i+tabButtons.length-1)%tabButtons.length]:e.key==='Home'?tabButtons[0]:e.key==='End'?tabButtons.at(-1):null;if(next){e.preventDefault();select(next);if(document.hasFocus())next.focus();}});});
  select(query('#tab-mesh'));
  function status(message,error=false){query('.setup-status').textContent=message;query('.setup-status').dataset.error=error;}
  function audioStatus(state){const start=query('.audio-start'),stop=query('.audio-stop'),message=query('.audio-status');start.textContent=state.waitingForInteraction?'Tap to enable sounds':state.busy?'Loading…':state.enabled?'Sounds enabled':'Enable sounds';start.disabled=(state.busy&&!state.waitingForInteraction)||state.playing||(state.enabled&&state.paused);start.setAttribute('aria-pressed',String(state.enabled));stop.disabled=!state.enabled;message.textContent=state.message;message.dataset.error=String(state.error);}
  query('.audio-start').addEventListener('click',()=>setSoundEnabled(true));query('.audio-stop').addEventListener('click',()=>setSoundEnabled(false));
  const action=fn=>async()=>{try{await fn();}catch(e){status(e.message,true);}};
  for(const [selector,fn]of [['[data-action="audition"]',audition],['.run',togglePlaying],['.restart',reset],['.save-setup',save],['.reload-setup',reload],['.reset-camera',resetView],['[data-action="regenerate"]',regenerate],['[data-action="export"]',exportDrawing]])query(selector)?.addEventListener('click',action(fn));
  function syncInput(input){
    const value=current[input.dataset.group][input.dataset.key];
    if(input.type==='checkbox')input.checked=value;
    else if(input!==document.activeElement&&input.value!==String(value))input.value=value;
    const out=query(`label[for="${input.id}"] output`);
    if(out)out.textContent=typeof value==='number'?Number(value.toFixed(3)):value;
  }
  for(const input of shell.querySelectorAll('[data-group]')){
    input.addEventListener('input',()=>{if(!input.checkValidity()||input.value==='')return;const value=input.type==='checkbox'?input.checked:input.type==='color'||input.tagName==='SELECT'?input.value:Number(input.value);change(input.dataset.group,input.dataset.key,value);});
    input.addEventListener('blur',()=>syncInput(input));
  }
  const synthControls=bindSynthControls(shell,{getVoices:()=>current.audio.voices,change:voices=>change('audio','voices',voices)});
  const workshop=bindPaletteWorkshop(shell,{getLibrary:()=>current.paletteLibrary,getPalettes:()=>libraryPalettes(current.paletteLibrary),getCurrentId:()=>current.paletteId,preview:selectPalette,change:changeLibrary});
  return {element:shell,status,audioStatus,showControls,close(){if(!drawer.hidden)open(false);},frame(audio){
    if(!drawer.hidden&&!query('#panel-audio').hidden)synthControls.frame(audio.modulation);
    stats?.update();
  },set(value){
    current=value;
    synthControls.sync();for(const input of shell.querySelectorAll('[data-group]'))syncInput(input);
    const run=query('.run'),label=value.motion.playing?'Pause':'Play';
    if(run.getAttribute('aria-label')!==label){run.innerHTML=icon(value.motion.playing?paths.pause:paths.play);run.setAttribute('aria-label',label);}
    if(value.visibility.fps&&!stats){stats=new Stats();stats.dom.className='frame-rate-meter';stats.dom.style.cssText='position:absolute;top:16px;left:16px;z-index:4';shell.append(stats.dom);}else if(!value.visibility.fps&&stats){stats.dom.remove();stats=null;}
  },syncPalette(){workshop.syncPreview();}};
}
