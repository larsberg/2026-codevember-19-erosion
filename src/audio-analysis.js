export const ANALYSIS_FFT_SIZE = 4096;
export const analysisFrame = () => ({
  spectrum: new Float32Array(ANALYSIS_FFT_SIZE / 2).fill(-Infinity),
  wave: new Float32Array(ANALYSIS_FFT_SIZE), left: new Float32Array(ANALYSIS_FFT_SIZE), right: new Float32Array(ANALYSIS_FFT_SIZE),
  rms: 0, peak: 0, leftRms: 0, rightRms: 0, correlation: 0, centroid: 0, peakHz: 0,
});
export const silentAnalysis = () => ({ active: false, sampleRate: 48000, fftSize: ANALYSIS_FFT_SIZE, voices: [analysisFrame(), analysisFrame()] });

export function measureAudio(frame, sampleRate, fftSize = ANALYSIS_FFT_SIZE) {
  let l2 = 0, r2 = 0, lr = 0, peak = 0, energy = 0, weighted = 0, highest = -Infinity, peakBin = 0;
  for (let i = 0; i < frame.wave.length; i++) {
    l2 += frame.left[i] ** 2; r2 += frame.right[i] ** 2;
    lr += frame.left[i] * frame.right[i]; peak = Math.max(peak, Math.abs(frame.left[i]), Math.abs(frame.right[i]));
  }
  for (let i = 1; i < frame.spectrum.length; i++) {
    const db = frame.spectrum[i], power = Number.isFinite(db) ? 10 ** (db / 10) : 0;
    energy += power; weighted += power * i * sampleRate / fftSize;
    if (db > highest) { highest = db; peakBin = i; }
  }
  const n = frame.wave.length;
  Object.assign(frame, { rms: Math.sqrt((l2 + r2) / (2 * n)), peak, leftRms: Math.sqrt(l2 / n), rightRms: Math.sqrt(r2 / n),
    correlation: l2 * r2 > 1e-20 ? Math.max(-1, Math.min(1, lr / Math.sqrt(l2 * r2))) : 0,
    centroid: energy > 1e-20 ? weighted / energy : 0, peakHz: energy > 1e-20 ? peakBin * sampleRate / fftSize : 0 });
  return frame;
}

// Read-only taps on the native Strudel orbit outputs include dry signal and
// delay/reverb tails. They never replace or reconnect the audible output path.
export function createAudioAnalysis(api, context) {
  const result = silentAnalysis(); result.sampleRate = context.sampleRate;
  const controller = api.getSuperdoughAudioController();
  const taps = result.voices.map((frame, voice) => {
    const output = controller.getOrbit(voice + 1, [0, 1]).output;
    const nodes = [0, 1, 2].map(() => {
      const node = context.createAnalyser(); node.fftSize = ANALYSIS_FFT_SIZE;
      node.smoothingTimeConstant = .65; node.minDecibels = -100; node.maxDecibels = 0; return node;
    });
    const [mono, left, right] = nodes, splitter = context.createChannelSplitter(2);
    output.connect(mono); output.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
    return { output, nodes, splitter, mono, left, right, frame };
  });
  let previous = -Infinity, disposed = false;
  return {
    read() {
      if (disposed || context.state !== 'running') { result.active = false; return result; }
      result.active = true;
      if (context.currentTime - previous < 1 / 30) return result;
      previous = context.currentTime;
      for (const { mono, left, right, frame } of taps) {
        mono.getFloatFrequencyData(frame.spectrum); mono.getFloatTimeDomainData(frame.wave);
        left.getFloatTimeDomainData(frame.left); right.getFloatTimeDomainData(frame.right);
        measureAudio(frame, context.sampleRate);
      }
      return result;
    },
    dispose() {
      if (disposed) return; disposed = true; result.active = false;
      for (const { output, nodes, splitter, mono } of taps) {
        output.disconnect(mono); output.disconnect(splitter); splitter.disconnect(); nodes.forEach(node => node.disconnect());
      }
    },
  };
}
