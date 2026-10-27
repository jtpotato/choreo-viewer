export interface BeatDetectorCallbacks {
  onGrid: (bpm: number, beatTimes: number[], firstSignalAt: number | null) => void;
  onProgress: (seconds: number) => void;
  onFailure: (message: string) => void;
  onComplete: (foundTempo: boolean) => void;
}

interface AudioFrame {
  time: number;
  novelty: number;
}

interface TempoWindow {
  bpm: number;
  beatTimes: number[];
}

const SAMPLE_INTERVAL_MS = 50;
const ANALYSIS_WINDOW_SECONDS = 9;
const MAX_FRAMES = 600;
const NO_AUDIO_TIMEOUT_SECONDS = 30;

/** Analyzes a silent copy of the selected video; the visible player's audio graph is untouched. */
export class BeatDetector {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analysisVideo: HTMLVideoElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private frequencies: Uint8Array<ArrayBuffer> | null = null;
  private previousSpectrum: Uint8Array<ArrayBuffer> | null = null;
  private frames: AudioFrame[] = [];
  private rafId = 0;
  private lastSampleAt = 0;
  private lastEstimateAt = 0;
  private lastProgressAt = 0;
  private startedAt = 0;
  private signalSamples = 0;
  private firstSignalAt: number | null = null;
  private listenedSeconds = 0;
  private foundTempo = false;

  constructor(private readonly callbacks: BeatDetectorCallbacks) {}

  async start(sourceVideo: HTMLVideoElement): Promise<void> {
    if (typeof window === "undefined" || !("AudioContext" in window)) {
      this.callbacks.onFailure("Audio analysis is unavailable in this browser.");
      return;
    }

    try {
      cancelAnimationFrame(this.rafId);
      this.releaseAnalysisVideo();
      this.context ??= new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.15;
      this.frequencies = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.previousSpectrum = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.analyser.connect(this.silentGain);
      this.silentGain.connect(this.context.destination);

      const analysisVideo = document.createElement("video");
      analysisVideo.src = sourceVideo.currentSrc || sourceVideo.src;
      analysisVideo.preload = "auto";
      analysisVideo.playsInline = true;
      analysisVideo.controls = false;
      analysisVideo.disableRemotePlayback = true;
      analysisVideo.disablePictureInPicture = true;
      analysisVideo.setAttribute("aria-hidden", "true");
      Object.assign(analysisVideo.style, {
        position: "fixed",
        left: "-2px",
        top: "-2px",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
      });
      document.body.append(analysisVideo);
      this.analysisVideo = analysisVideo;

      this.sourceNode = this.context.createMediaElementSource(analysisVideo);
      this.sourceNode.connect(this.analyser);
      // This copy reaches the device only through a zero-gain node, so it cannot
      // add a second audible stream beside the native player.
      const contextReady = this.context.resume();
      const silentPlayback = analysisVideo.play();
      await Promise.all([contextReady, silentPlayback]);

      this.startedAt = 0;
      this.lastSampleAt = 0;
      this.lastEstimateAt = 0;
      this.lastProgressAt = 0;
      this.signalSamples = 0;
      this.firstSignalAt = null;
      this.listenedSeconds = 0;
      this.foundTempo = false;
      this.frames = [];
      this.previousSpectrum.fill(0);
      this.sample = this.sample.bind(this);
      this.sample();
    } catch {
      this.releaseAnalysisVideo();
      this.callbacks.onFailure("Couldn't read audio from this video in the browser.");
    }
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.releaseAnalysisVideo();
  }

  private sample(): void {
    const video = this.analysisVideo;
    const analyser = this.analyser;
    const frequencies = this.frequencies;
    const previous = this.previousSpectrum;
    if (!video || !analyser || !frequencies || !previous) return;

    const now = performance.now();
    if (now - this.lastProgressAt >= 1000) {
      this.lastProgressAt = now;
      this.callbacks.onProgress(video.currentTime);
    }

    if (video.ended) {
      this.releaseAnalysisVideo();
      this.callbacks.onComplete(this.foundTempo);
      return;
    }

    if (now - this.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      this.lastSampleAt = now;
      analyser.getByteFrequencyData(frequencies);
      const upperBin = Math.min(180, Math.floor(frequencies.length * 0.42));
      let flux = 0;
      let energy = 0;
      for (let bin = 2; bin < upperBin; bin += 1) {
        const value = frequencies[bin] ?? 0;
        flux += Math.max(0, value - (previous[bin] ?? 0));
        energy += value;
        previous[bin] = value;
      }

      if (energy > 10) {
        this.signalSamples += 1;
        this.firstSignalAt ??= video.currentTime;
      }
      this.frames.push({
        time: video.currentTime,
        novelty: energy < 10 ? 0 : flux / (upperBin - 2),
      });
      if (this.frames.length > MAX_FRAMES) this.frames.shift();
      this.listenedSeconds = video.currentTime - this.startedAt;

      if (this.listenedSeconds >= NO_AUDIO_TIMEOUT_SECONDS && this.signalSamples < 10) {
        this.releaseAnalysisVideo();
        this.callbacks.onFailure("No audio signal found in this video.");
        return;
      }

      if (this.listenedSeconds >= ANALYSIS_WINDOW_SECONDS && this.listenedSeconds - this.lastEstimateAt >= 2) {
        this.lastEstimateAt = this.listenedSeconds;
        const estimate = estimateTempo(this.frames, video.currentTime);
        if (estimate) {
          this.foundTempo = true;
          this.releaseAnalysisVideo();
          this.callbacks.onGrid(estimate.bpm, estimate.beatTimes, this.firstSignalAt);
          this.callbacks.onComplete(true);
          return;
        }
      }
    }

    this.rafId = requestAnimationFrame(this.sample);
  }

  private releaseAnalysisVideo(): void {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.analysisVideo) {
      this.analysisVideo.pause();
      this.analysisVideo.removeAttribute("src");
      this.analysisVideo.load();
      this.analysisVideo.remove();
      this.analysisVideo = null;
    }
    this.analyser?.disconnect();
    this.silentGain?.disconnect();
    this.silentGain = null;
  }
}

function estimateTempo(frames: AudioFrame[], currentTime: number): TempoWindow | null {
  const window = frames.filter((frame) => currentTime - frame.time <= ANALYSIS_WINDOW_SECONDS);
  if (window.length < 120) return null;
  const envelope = window.map((frame) => frame.novelty);
  const average = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  if (average < 0.03) return null;

  const centered = envelope.map((value) => value - average);
  const sampleRate = 1000 / SAMPLE_INTERVAL_MS;
  const minLag = Math.floor(sampleRate * 60 / 180);
  const maxLag = Math.ceil(sampleRate * 60 / 60);
  const correlations: number[] = [];

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let product = 0;
    let leftPower = 0;
    let rightPower = 0;
    for (let index = lag; index < centered.length; index += 1) {
      const left = centered[index] ?? 0;
      const right = centered[index - lag] ?? 0;
      product += left * right;
      leftPower += left * left;
      rightPower += right * right;
    }
    correlations[lag] = product / Math.sqrt(Math.max(1, leftPower * rightPower));
  }

  let bestLag = 0;
  let bestBpm = 0;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const base = correlations[lag] ?? 0;
    const doubleTempo = correlations[Math.round(lag / 2)] ?? 0;
    const score = base + doubleTempo * 0.02;
    const bpm = sampleRate * 60 / lag;
    if (score > bestScore + 0.04 || (Math.abs(score - bestScore) <= 0.04 && bpm > bestBpm)) {
      bestScore = score;
      bestLag = lag;
      bestBpm = bpm;
    }
  }

  if (bestLag === 0 || bestScore < 0.12) return null;

  let strongestPhase = 0;
  let strongestPhaseScore = Number.NEGATIVE_INFINITY;
  for (let phase = 0; phase < bestLag; phase += 1) {
    let score = 0;
    for (let index = phase; index < centered.length; index += bestLag) {
      score += Math.max(0, centered[index] ?? 0);
    }
    if (score > strongestPhaseScore) {
      strongestPhase = phase;
      strongestPhaseScore = score;
    }
  }

  const beatTimes: number[] = [];
  const peakThreshold = Math.max(0.025, average * 0.5);
  for (let index = strongestPhase; index < window.length; index += bestLag) {
    const frame = window[index];
    if (frame && (centered[index] ?? 0) >= peakThreshold) beatTimes.push(frame.time);
  }
  if (beatTimes.length < 5) return null;
  return { bpm: Math.round(bestBpm), beatTimes };
}

