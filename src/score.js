import { createSynthPattern, modulateVoice, synthValue } from './synth.js';
import { createLiveModulation, liveSynthValue } from './live-modulation.js';
import { resumeAudioContext } from './audio-autoplay.js';
import { createAudioAnalysis, silentAnalysis } from './audio-analysis.js';

// Melt's saved enabled state and cancellable activation; native Strudel voices,
// patterns and bus modulation. The move clock is the only note clock.
export function createAudio({ load = () => import('@strudel/web'), onError = console.warn,
  onStatus = () => {}, loadEffects, synthLevel = 1, synthMaxVoices = Infinity, modulationHz = Infinity,
  resumeContext = resumeAudioContext, createModulation = createLiveModulation, createAnalysis = createAudioAnalysis } = {}) {
  let api, context, repl, loading, starting, contextResume, settings, modulation;
  let pattern, patternKey, busy = false, disposed = false, running = true;
  let active = false, waitingForInteraction = false, operation = 0, eventCount = 0, failed = false;
  let currentMove, recentNotes = [], recentEffects = [];
  let effects, synthSettings, synthEnds = [], modulatedAt = -Infinity;
  const sceneMix={levels:[1,1],pans:[0,0]};
  function applySceneMix() {
    if(!synthSettings)return;
    synthSettings.voices.forEach((voice,i)=>{voice.level=settings.voices[i].level*sceneMix.levels[i];voice.pan=Math.max(0,Math.min(1,settings.voices[i].pan+sceneMix.pans[i]));});
  }
  let analysis; const silence = silentAnalysis();
  const positions = new Float64Array(48); let floor = 0;
  const wanted = () => !disposed && running && settings?.enabled;
  function syncModulation() {
    const musical = synthLevel > 0 && settings.voices.some(voice => voice.enabled);
    if (musical && !modulation) modulation = createModulation(api, context);
    if (!musical && modulation) { modulation.dispose(); modulation = undefined; }
    modulation?.update(synthSettings, positions, floor);
  }
  function status(message, error = false) {
    onStatus({ message, error, enabled: !!settings?.enabled, paused: !running, playing: active, busy, waitingForInteraction });
  }
  function refresh() {
    if (!api || !settings) return;
    const key = JSON.stringify(settings.voices.map(({ rhythm, gate, enabled }) => ({ rhythm, gate, enabled })));
    if (key === patternKey) return;
    patternKey = key; pattern = createSynthPattern(api, settings.voices, index => index);
  }
  function halt() {
    effects?.stop(); synthEnds = []; modulatedAt = -Infinity;
    operation++; active = false; busy = false;
    contextResume?.cancel(); contextResume = undefined; waitingForInteraction = false;
    analysis?.dispose(); analysis = undefined; repl?.pause(); modulation?.dispose(); modulation = undefined;
    if (context) api?.resetGlobalEffects();
    if (context?.state === 'running') void context.suspend().catch(report);
    if (!disposed) status(settings?.enabled ? 'Sounds enabled · paused with sketch' : 'Sounds muted');
  }
  function report(error) {
    if (disposed) return;
    failed = true; halt(); status(error.message, true); onError(`Audio: ${error.message}`);
  }
  async function initialize() {
    loading ??= (async () => {
      api = await load(); if (disposed) return;
      context = api.getAudioContext(); repl = await api.initStrudel();
      if (disposed) { repl.stop(); if (context.state !== 'closed') await context.close(); return; }
      await api.initAudio(); if (disposed) { repl.stop(); return; }
      if (loadEffects) effects = await loadEffects(api, context);
      effects?.configure?.(settings);
      if (disposed) { effects?.dispose(); repl.stop(); return; }
      // Initialize the inherited transport without an independent beat.
      await repl.setPattern(api.silence, false); refresh();
    })().catch(error => { loading = undefined; patternKey = undefined; throw error; });
    return loading;
  }
  function scheduleMove(event) {
    if (!active || !wanted() || !pattern || synthLevel === 0) return;
    // Strudel rationalizes query bounds; 1e-9 can collapse onto an exact
    // rhythmic boundary and lose that onset. Query wider, then filter below.
    const begin = Math.max(0, event.from), end = Math.min(1, event.to + 1e-6);
    for (const hap of pattern.queryArc(begin, end)) {
      const onset = Number(hap.whole?.begin);
      if (!hap.hasOnset() || onset <= event.from || onset >= 1 || onset > event.to + 1e-9) continue;
      const voice = hap.value, duration = Number(hap.duration) * event.duration;
      if(event.voices&&!event.voices.includes(voice))continue;
      if (Number.isFinite(synthMaxVoices)) {
        synthEnds = synthEnds.filter(end => end > context.currentTime);
        if (synthEnds.length >= synthMaxVoices) continue;
        synthEnds.push(context.currentTime + .03 + duration + settings.voices[voice].release);
      }
      const value = liveSynthValue(synthValue(synthSettings, voice, positions, floor), voice);
      const token = operation;
      // superdough 1.3 expects an absolute AudioContext timestamp.
      void api.superdough(value, context.currentTime + .03, duration, 1 / event.duration, onset)
        .then(() => {
          if (token !== operation) return;
          eventCount++; recentNotes.push({ serial: event.serial, voice, duration }); recentNotes = recentNotes.slice(-24);
        }).catch(error => { if (token === operation) report(error); });
    }
  }
  function start() {
    if (!wanted() || active) return Promise.resolve();
    if (busy) return starting;
    const token = ++operation; busy = true; status('Loading sounds…');
    starting = (async () => { try {
      await initialize();
      if (token !== operation || !wanted()) return;
      contextResume = resumeContext(context, { onWaiting() { waitingForInteraction = true; status('Sounds enabled · touch or click to hear them'); } });
      const resumed = await contextResume.ready;
      if (token !== operation || !wanted()) return;
      contextResume = undefined; waitingForInteraction = false;
      if (!resumed) throw Error('Audio context closed. Reload to retry.');
      await repl.start();
      if (token !== operation || !wanted()) { repl.pause(); if (context.state === 'running') await context.suspend(); return; }
      syncModulation();
      active = true; busy = false; status('Sounds enabled');
      if (currentMove?.phase === 'moving') scheduleMove({ from: -1e-9, to: 0, serial: currentMove.serial,
        duration: currentMove.duration * (1 - currentMove.progress) });
    } catch (error) { if (token === operation) report(error); } })();
    return starting;
  }
  return {
    // The Fold scene has no live scopes. Allocate FFT taps only when inspected.
    get analysis() { if (active) analysis ??= createAnalysis(api, context); return active ? analysis?.read() ?? silence : silence; },
    get unlocked() { return active && context?.state === 'running'; },
    get diagnostics() { return { engine: 'Strudel', enabled: !!settings?.enabled, running: active, busy, waitingForInteraction,
      events: eventCount, effects: effects?.diagnostics, recentNotes, recentEffects, live: modulation?.diagnostics, context: context?.state ?? 'locked' }; },
    get modulation() { return settings?.voices.map(voice => modulateVoice(voice, positions, floor).routes) ?? []; },
    configure(next) {
      const changedEnabled = settings?.enabled !== next.enabled;
      settings = structuredClone(next); synthSettings = { ...settings, volume: settings.volume * synthLevel,voices:settings.voices.map(voice=>({...voice})) };applySceneMix();
      effects?.configure?.(settings);
      refresh(); if (active) syncModulation();
      if (!settings.enabled) { if (changedEnabled || active || busy) halt(); }
      else if (!running) status('Sounds enabled · paused with sketch');
      else if (changedEnabled) { failed = false; void start(); }
    },
    async unlock() { failed = false; return start(); },
    clearEffects() { effects?.stop(); },
    setScene(value) {
      sceneMix.levels=value.levels.map(v=>Math.max(0,Math.min(1,v)));
      sceneMix.pans=value.pans.map(v=>Math.max(-.2,Math.min(.2,v)));applySceneMix();
    },
    update(_dt, play, nextPositions, nextFloor = floor, events = [], move) {
      if (nextPositions) { positions.set(nextPositions); floor = nextFloor; }
      if (move) currentMove = move;
      const wasRunning = running; running = play;
      if (wasRunning && !play) halt();
      // Every frame, including gaps between moves and empty rhythms. Audio
      // control signals never wait for a note onset to follow a corner.
      if (modulation && context.currentTime - modulatedAt >= 1 / modulationHz) {
        modulation.update(synthSettings, positions, floor); modulatedAt = context.currentTime;
      }
      if (wanted() && !failed && !active && !busy) void start();
      if (active) for (const event of events) {
        if (event.effect && effects) {
          const token = operation;
          void effects.play(event, settings.volume, settings.voices, positions, floor).then(played => {
            if (!played || token !== operation) return;
            eventCount++; recentEffects.push({ effect:event.effect, time:event.time, generation:event.generation }); recentEffects=recentEffects.slice(-32);
          }).catch(error => { if (token === operation) report(error); });
        } else scheduleMove(event);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; halt(); effects?.dispose(); repl?.stop();
      if (context && context.state !== 'closed') void context.close();
    },
  };
}
