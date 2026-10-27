"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeatDetector } from "@/lib/beat-detector";
import { loadConfig, saveConfig } from "@/lib/config-store";
import { formatTime } from "@/lib/format-time";
import { identifyVideo } from "@/lib/video-identity";
import { listSavedVideos, removeSavedVideo, saveVideo, type SavedVideo } from "@/lib/video-library";
import { DEFAULT_CONFIG, type PracticeConfig, type VideoIdentity } from "@/lib/types";

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1] as const;

export function ChoreoViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const selfieVideoRef = useRef<HTMLVideoElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const detectorRef = useRef<BeatDetector | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const libraryRef = useRef<SavedVideo[]>([]);
  const sessionFilesRef = useRef(new Map<string, File>());
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [identity, setIdentity] = useState<VideoIdentity | null>(null);
  const [config, setConfig] = useState<PracticeConfig>(DEFAULT_CONFIG);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [bpmInput, setBpmInput] = useState("");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [error, setError] = useState("");
  const [bars, setBars] = useState(4);
  const [savedVideos, setSavedVideos] = useState<SavedVideo[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selfieEnabled, setSelfieEnabled] = useState(false);

  const beatDuration = useMemo(() => config.bpm ? 60 / config.bpm : 0, [config.bpm]);
  const barDuration = beatDuration * config.meter;

  useEffect(() => {
    if (identity) saveConfig(identity.key, config);
  }, [identity, config]);

  useEffect(() => {
    setBpmInput(config.bpm?.toString() ?? "");
  }, [config.bpm]);

  useEffect(() => {
    void listSavedVideos().then((videos) => {
      const merged = [...videos, ...libraryRef.current.filter((entry) => !videos.some((saved) => saved.id === entry.id))]
        .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
      libraryRef.current = merged;
      setSavedVideos(merged);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const preview = selfieVideoRef.current;
    const stream = cameraStreamRef.current;
    if (!selfieEnabled || !preview || !stream) return;
    preview.srcObject = stream;
    void preview.play().catch(() => setError("Could not start the camera preview."));
    return () => {
      preview.srcObject = null;
    };
  }, [selfieEnabled]);

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      setCurrentTime(video.currentTime);
      if (config.loopStart !== null && config.loopEnd !== null && video.currentTime >= config.loopEnd) {
        video.currentTime = config.loopStart;
      }
    };
    const metadata = () => setDuration(video.duration || 0);
    video.addEventListener("timeupdate", update);
    video.addEventListener("loadedmetadata", metadata);
    return () => {
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("loadedmetadata", metadata);
    };
  }, [videoUrl, config.loopStart, config.loopEnd]);

  useEffect(() => () => {
    detectorRef.current?.stop();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const updateConfig = useCallback((updates: Partial<PracticeConfig>) => {
    setConfig((previous) => ({ ...previous, ...updates }));
  }, []);

  const updateBeatMap = useCallback((bpm: number, detectedBeatTimes: number[], firstSignalAt: number | null) => {
    const interval = 60 / bpm;
    let firstBeat = detectedBeatTimes[0] ?? firstSignalAt ?? 0;
    if (firstSignalAt !== null) {
      while (firstBeat - interval >= firstSignalAt - 0.08) firstBeat -= interval;
    }
    const beatTimes = buildUniformBeatTimes(videoRef.current?.duration || duration, bpm, firstBeat);
    setConfig((previous) => {
      return {
        ...previous,
        bpm,
        beatTimes,
        barTimes: getBarTimes(beatTimes, previous.meter),
        beatOffset: firstBeat,
      };
    });
  }, [duration]);

  const openVideoFile = useCallback((file: File, videoIdentity: VideoIdentity) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setIdentity(videoIdentity);
    setConfig(loadConfig(videoIdentity.key, videoIdentity.key.replace("choreo-viewer:v1:", "eightcount:v1:")));
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setAnalysisMessage("");
    setError("");
    detectorRef.current?.stop();
    setAnalyzing(false);
  }, [videoUrl]);

  const rememberVideo = useCallback(async (file: File, videoIdentity: VideoIdentity, handle?: FileSystemFileHandle) => {
    sessionFilesRef.current.set(videoIdentity.key, file);
    const existing = libraryRef.current.find((entry) => entry.id === videoIdentity.key);
    const entry: SavedVideo = {
      id: videoIdentity.key,
      name: file.name,
      size: file.size,
      modifiedAt: file.lastModified,
      lastOpenedAt: Date.now(),
      ...(handle ?? existing?.handle ? { handle: handle ?? existing?.handle } : {}),
    };
    const next = [entry, ...libraryRef.current.filter((saved) => saved.id !== entry.id)]
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
    libraryRef.current = next;
    setSavedVideos(next);
    try {
      await saveVideo(entry);
    } catch {
      // The in-session library still works if IndexedDB or handle storage is unavailable.
    }
    return entry;
  }, []);

  const addVideoFiles = useCallback(async (files: File[], handles: FileSystemFileHandle[] = []) => {
    const validFiles = files.map((file, index) => ({ file, handle: handles[index] }))
      .filter(({ file }) => file.type.startsWith("video/"));
    if (validFiles.length === 0) {
      setError("Choose a video file.");
      return;
    }
    setError("");
    for (const [index, selected] of validFiles.entries()) {
      const { file, handle } = selected;
      let videoIdentity: VideoIdentity;
      try {
        videoIdentity = await identifyVideo(file);
      } catch {
        videoIdentity = {
          key: `choreo-viewer:v1:${file.name}:${file.size}:${file.lastModified}`,
          name: file.name,
          size: file.size,
          modifiedAt: file.lastModified,
        };
      }
      await rememberVideo(file, videoIdentity, handle);
      if (index === 0) openVideoFile(file, videoIdentity);
    }
    setLibraryOpen(false);
  }, [openVideoFile, rememberVideo]);

  const handleFileSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void addVideoFiles(files);
  }, [addVideoFiles]);

  const openPicker = useCallback(async () => {
    const filePicker = window as Window & {
      showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
    };
    if (!filePicker.showOpenFilePicker) {
      pickerRef.current?.click();
      return;
    }
    try {
      const handles = await filePicker.showOpenFilePicker({ multiple: true });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      await addVideoFiles(files, handles);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      pickerRef.current?.click();
    }
  }, [addVideoFiles]);

  const toggleSelfie = useCallback(async () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      setSelfieEnabled(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is unavailable in this browser.");
      return;
    }
    try {
      cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      setError("");
      setSelfieEnabled(true);
    } catch {
      setError("Camera access was denied or unavailable.");
    }
  }, []);

  const openSavedVideo = useCallback(async (entry: SavedVideo) => {
    const sessionFile = sessionFilesRef.current.get(entry.id);
    const videoIdentity = {
      key: entry.id,
      name: entry.name,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
    };
    if (sessionFile) {
      openVideoFile(sessionFile, videoIdentity);
      setLibraryOpen(false);
      return;
    }
    if (entry.handle) {
      try {
        const permissionedHandle = entry.handle as FileSystemFileHandle & {
          requestPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
          queryPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
        };
        const permission = permissionedHandle.requestPermission
          ? await permissionedHandle.requestPermission({ mode: "read" })
          : permissionedHandle.queryPermission
            ? await permissionedHandle.queryPermission({ mode: "read" })
            : "granted";
        if (permission === "granted") {
          const file = await entry.handle.getFile();
          const currentIdentity = await identifyVideo(file);
          await rememberVideo(file, currentIdentity, entry.handle);
          openVideoFile(file, currentIdentity);
          setLibraryOpen(false);
          return;
        }
      } catch {
        // If the handle expired, fall through to the platform's file picker.
      }
    }
    setLibraryOpen(false);
    pickerRef.current?.click();
  }, [openVideoFile, rememberVideo]);

  const forgetVideo = useCallback(async (id: string) => {
    const next = libraryRef.current.filter((entry) => entry.id !== id);
    libraryRef.current = next;
    setSavedVideos(next);
    sessionFilesRef.current.delete(id);
    try {
      await removeSavedVideo(id);
    } catch {
      // Removing a browser-library entry does not affect the current video.
    }
  }, []);

  const setPlaybackSpeed = useCallback((nextSpeed: number) => {
    setSpeed(nextSpeed);
    if (videoRef.current) videoRef.current.playbackRate = nextSpeed;
  }, []);

  const seekByCounts = useCallback((counts: number) => {
    if (!videoRef.current || !beatDuration) return;
    const barsToMove = counts / config.meter;
    const mappedBarTime = Number.isInteger(barsToMove)
      ? moveOnBarMap(config.barTimes, videoRef.current.currentTime, barsToMove)
      : null;
    if (mappedBarTime !== null) {
      videoRef.current.currentTime = mappedBarTime;
      setCurrentTime(mappedBarTime);
      return;
    }
    const alignedBar = snapToBar(videoRef.current.currentTime, config.bpm, config.beatOffset, config.barTimes, config.meter);
    const nextTime = Math.min(duration, Math.max(0, alignedBar + barsToMove * barDuration));
    videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [barDuration, beatDuration, config.barTimes, config.beatOffset, config.bpm, config.meter, duration]);

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setError("This video could not be played in your browser.");
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const startBeatAnalysis = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!detectorRef.current) {
      detectorRef.current = new BeatDetector({
        onGrid: (bpm, beatTimes, firstSignalAt) => {
          updateBeatMap(bpm, beatTimes, firstSignalAt);
          setAnalysisMessage(`${bpm} BPM`);
        },
        onProgress: (seconds) => {
          setAnalysisMessage(`Analyzing ${formatTime(seconds)}`);
        },
        onFailure: (message) => {
          setAnalysisMessage(message);
          setAnalyzing(false);
        },
        onComplete: (foundTempo) => {
          setAnalysisMessage(foundTempo ? "Analysis complete" : "No steady beat found");
          setAnalyzing(false);
        },
      });
    }
    setAnalyzing(true);
    setAnalysisMessage("Analyzing 0:00");
    try {
      await detectorRef.current.start(video);
    } catch {
      detectorRef.current?.stop();
      setAnalysisMessage("Audio analysis failed.");
      setAnalyzing(false);
    }
  }, [updateBeatMap]);

  const markLoopStart = useCallback(() => {
    const start = snapToBar(currentTime, config.bpm, config.beatOffset, config.barTimes, config.meter);
    const defaultEnd = mappedBarEnd(config.barTimes, start, bars) ?? start + Math.max(barDuration, bars * barDuration);
    updateConfig({ loopStart: start, loopEnd: Math.min(duration || defaultEnd, defaultEnd) });
  }, [bars, barDuration, config.beatOffset, config.barTimes, config.bpm, config.meter, currentTime, duration, updateConfig]);

  const markLoopEnd = useCallback(() => {
    const end = snapToBar(currentTime, config.bpm, config.beatOffset, config.barTimes, config.meter);
    const minimumLength = barDuration || 0.1;
    const safeEnd = Math.max(minimumLength, end);
    const mappedStart = mappedBarStart(config.barTimes, safeEnd, bars);
    const start = config.loopStart ?? mappedStart ?? Math.max(0, safeEnd - bars * barDuration);
    updateConfig({ loopStart: Math.max(0, Math.min(start, safeEnd - minimumLength)), loopEnd: safeEnd });
  }, [bars, barDuration, config.beatOffset, config.barTimes, config.bpm, config.loopStart, config.meter, currentTime, updateConfig]);

  const changeBarCount = useCallback((nextBars: number) => {
    setBars(nextBars);
    if (config.loopStart !== null) {
      const mappedEnd = mappedBarEnd(config.barTimes, config.loopStart, nextBars);
      const loopEnd = mappedEnd ?? config.loopStart + nextBars * barDuration;
      updateConfig({ loopEnd: Math.min(duration || Infinity, loopEnd) });
    }
  }, [barDuration, config.barTimes, config.loopStart, duration, updateConfig]);

  const changeMeter = useCallback((meter: 3 | 4) => {
    updateConfig({ meter, barTimes: getBarTimes(config.beatTimes, meter) });
  }, [config.beatTimes, updateConfig]);

  const changeBeatOffset = useCallback((delta: number) => {
    const nextOffset = Math.max(0, config.beatOffset + delta);
    const beatTimes = config.beatTimes.length
      ? shiftBeatTimes(config.beatTimes, delta)
      : config.bpm ? buildUniformBeatTimes(duration, config.bpm, nextOffset) : [];
    updateConfig({
      beatOffset: nextOffset,
      beatTimes,
      barTimes: getBarTimes(beatTimes, config.meter),
    });
  }, [config.beatOffset, config.beatTimes, config.bpm, config.meter, duration, updateConfig]);

  const saveManualBpm = useCallback(() => {
    if (bpmInput === "") {
      if (config.bpm === null) return;
      detectorRef.current?.stop();
      setAnalyzing(false);
      updateConfig({ bpm: null, beatTimes: [], barTimes: [] });
      return;
    }
    const value = Number(bpmInput);
    if (Number.isFinite(value)) {
      const bpm = Math.max(60, Math.min(180, Math.round(value)));
      if (bpm === config.bpm && config.beatTimes.length > 0) return;
      detectorRef.current?.stop();
      setAnalyzing(false);
      const beatTimes = buildUniformBeatTimes(duration, bpm, config.beatOffset);
      updateConfig({ bpm, beatTimes, barTimes: getBarTimes(beatTimes, config.meter) });
    }
  }, [bpmInput, config.beatOffset, config.beatTimes.length, config.bpm, config.meter, duration, updateConfig]);

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const clearLoop = useCallback(() => updateConfig({ loopStart: null, loopEnd: null }), [updateConfig]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top">CHOREO</a>
        <div className="topbar-title">{identity?.name ?? ""}</div>
        <div className="header-actions">
          <button className={`text-button selfie-button ${selfieEnabled ? "active" : ""}`} aria-label={selfieEnabled ? "Close selfie camera" : "Open selfie camera"} aria-pressed={selfieEnabled} onClick={() => void toggleSelfie()}><SelfieIcon /><span>Selfie</span></button>
          {videoUrl && <button className={`text-button mirror-button ${config.mirrored ? "active" : ""}`} aria-label="Mirror choreography video" title="Mirror" aria-pressed={config.mirrored} onClick={() => updateConfig({ mirrored: !config.mirrored })}><MirrorIcon /><span>Mirror</span></button>}
          <button className="text-button library-trigger" aria-label="Songs" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((open) => !open)}><LibraryIcon /><span>Songs</span> <span className="menu-chevron">▾</span></button>
          <button className="text-button open-video-button" aria-label="Open video" onClick={() => void openPicker()}><UploadIcon /><span>Open video</span></button>
          {libraryOpen && <div className="video-library-menu" role="menu" aria-label="Song library">
            <button className="library-add" role="menuitem" onClick={() => void openPicker()}><UploadIcon /> Add videos</button>
            <div className="library-divider" />
            {savedVideos.length === 0 ? <span className="library-empty">No saved videos</span> : savedVideos.map((entry) => <div className="library-row" key={entry.id}>
              <button className="library-entry" role="menuitem" title={entry.name} onClick={() => void openSavedVideo(entry)}>{entry.name}</button>
              <button className="library-remove" aria-label={`Remove ${entry.name} from songs`} onClick={() => void forgetVideo(entry.id)}>×</button>
            </div>)}
          </div>}
        </div>
        <input ref={pickerRef} className="visually-hidden" type="file" accept="video/*" multiple onChange={handleFileSelection} />
      </header>

      <div className="workspace" id="top">
        <section className="practice-column" aria-label="Video practice player">
          <div className={`video-stage ${selfieEnabled ? "with-selfie" : ""}`}>
            <div className={`video-frame ${videoUrl ? "has-video" : ""}`}>
              {videoUrl ? (
                <video
                  ref={videoRef}
                  className={config.mirrored ? "is-mirrored" : ""}
                  src={videoUrl}
                  playsInline
                  preload="metadata"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              ) : <WelcomeCard onChoose={() => void openPicker()} />}
            </div>
            {selfieEnabled && <div className="selfie-frame">
              <video ref={selfieVideoRef} className="selfie-video" autoPlay muted playsInline aria-label="Selfie camera preview" />
              <span className="selfie-caption">SELFIE</span>
            </div>}
          </div>

          {videoUrl && <LoopEditor
            config={config}
            currentTime={currentTime}
            duration={duration}
            bars={bars}
            barDuration={barDuration}
            enabled
            onBars={changeBarCount}
            onMarkStart={markLoopStart}
            onMarkEnd={markLoopEnd}
            onClear={clearLoop}
            onSeek={seekTo}
          />}

          {error && <p className="inline-error" role="alert">{error}</p>}
          {videoUrl && <TransportControls
            speed={speed}
            isPlaying={isPlaying}
            bpm={config.bpm}
            meter={config.meter}
            onSkip={seekByCounts}
            onToggle={togglePlayback}
            onSpeed={setPlaybackSpeed}
          />}
        </section>

        <aside className="tools-column" aria-label="Practice tools">
          <div className="panel beat-panel">
            <div className="tempo-display">
              <label className="tempo-input-wrap"><span>BPM</span><input aria-label="Tempo in beats per minute" type="number" inputMode="numeric" min="60" max="180" value={bpmInput} placeholder="—" onChange={(event) => setBpmInput(event.target.value)} onBlur={saveManualBpm} /></label>
              <button className={`analyze-button ${analyzing ? "is-listening" : ""}`} onClick={() => {
                if (analyzing) {
                  detectorRef.current?.stop();
                  setAnalyzing(false);
                  setAnalysisMessage("");
                  return;
                }
                void startBeatAnalysis();
              }} disabled={!videoUrl || duration === 0}>
                <PulseIcon /> {analyzing ? "Stop" : "Detect"}
              </button>
            </div>
            {analysisMessage && <p className="analysis-status" role="status">{analysisMessage}</p>}
            {config.bpm && <div className="offset-row">
              <span>OFFSET</span>
              <span className="offset-value">{formatTime(config.beatOffset)}</span>
              <button aria-label="Move beat offset earlier" onClick={() => changeBeatOffset(-beatDuration / 4)}>−</button>
              <button aria-label="Move beat offset later" onClick={() => changeBeatOffset(beatDuration / 4)}>+</button>
            </div>}
            <div className="meter-row">
              <span>METER</span>
              <div className="segmented-control" role="group" aria-label="Time signature">
                <button className={config.meter === 4 ? "selected" : ""} onClick={() => changeMeter(4)}>4/4</button>
                <button className={config.meter === 3 ? "selected" : ""} onClick={() => changeMeter(3)}>3/4</button>
              </div>
            </div>
          </div>

        </aside>
      </div>
    </main>
  );
}

function WelcomeCard({ onChoose }: { onChoose: () => void }) {
  return <div className="welcome-card">
    <div className="welcome-content">
      <button className="primary-button" onClick={onChoose}><UploadIcon /> Choose video</button>
    </div>
  </div>;
}

interface TransportProps {
  speed: number;
  isPlaying: boolean;
  bpm: number | null;
  meter: 3 | 4;
  onSkip: (counts: number) => void;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
}

function TransportControls(props: TransportProps) {
  const { speed, isPlaying, bpm, meter, onSkip, onToggle, onSpeed } = props;
  return <div className="transport">
    <div className="control-row">
      <div className="speed-controls" aria-label="Playback speed">
        <span className="control-label">SPEED</span>
        {SPEED_PRESETS.map((preset) => <button key={preset} className={speed === preset ? "active" : ""} onClick={() => onSpeed(preset)}>{preset}×</button>)}
        <label className="custom-speed"><input aria-label="Custom playback speed" type="range" min="0.25" max="2" step="0.05" value={speed} onChange={(event) => onSpeed(Number(event.target.value))} /><span>{speed.toFixed(2)}×</span></label>
      </div>
      <div className="center-controls">
        <button className="skip-button" aria-label={`Back two bars, ${meter * 2} counts`} onClick={() => onSkip(-meter * 2)} disabled={!bpm}><SkipIcon reverse /><span>{meter * 2}</span></button>
        <button className="play-button" aria-label={isPlaying ? "Pause video" : "Play video"} onClick={onToggle}>{isPlaying ? <PauseIcon /> : <PlayIcon />}</button>
        <button className="skip-button" aria-label={`Forward two bars, ${meter * 2} counts`} onClick={() => onSkip(meter * 2)} disabled={!bpm}><SkipIcon /><span>{meter * 2}</span></button>
      </div>
      <div className="counts-hint">{bpm ? <><span className="count-dot" />{meter * 2} counts <span>·</span> 2 bars</> : "DETECT BEAT TO COUNT"}</div>
    </div>
  </div>;
}

interface LoopEditorProps {
  config: PracticeConfig;
  currentTime: number;
  duration: number;
  bars: number;
  barDuration: number;
  enabled: boolean;
  onBars: (bars: number) => void;
  onMarkStart: () => void;
  onMarkEnd: () => void;
  onClear: () => void;
  onSeek: (time: number) => void;
}

function LoopEditor({ config, currentTime, duration, bars, barDuration, enabled, onBars, onMarkStart, onMarkEnd, onClear, onSeek }: LoopEditorProps) {
  const loopStart = config.loopStart;
  const loopEnd = config.loopEnd;
  const active = loopStart !== null && loopEnd !== null;
  return <div className="loop-editor">
    <div className={`loop-track ${active ? "loop-active" : ""}`}>
      <div className="timeline-rail">
        <div className="track-line" />
        <div className="track-ticks">{config.barTimes.map((time) => <i key={time} style={{ left: `${duration ? time / duration * 100 : 0}%` }} />)}</div>
        {active && duration > 0 && <div className="loop-region" style={{ left: `${loopStart! / duration * 100}%`, width: `${(loopEnd! - loopStart!) / duration * 100}%` }}><span>A</span><span>B</span></div>}
      </div>
      <input className="timeline-seek" aria-label="Seek and snap to nearest bar" type="range" min="0" max={duration || 1} step="0.02" value={Math.min(currentTime, duration || 1)} onChange={(event) => onSeek(snapToBar(Number(event.target.value), config.bpm, config.beatOffset, config.barTimes, config.meter))} disabled={!enabled || duration === 0} />
    </div>
    <div className="timeline-timecodes"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
    <div className="loop-controls">
    <div className="bar-select-row">
      <span>LOOP</span>
      <div className="bar-stepper"><button disabled={!enabled || bars <= 1} onClick={() => onBars(Math.max(1, bars - 1))}>−</button><strong>{bars} <small>{bars === 1 ? "bar" : "bars"}</small></strong><button disabled={!enabled} onClick={() => onBars(Math.min(16, bars + 1))}>+</button></div>
    </div>
    <div className="loop-actions"><button className={`mark-button ${active ? "marked" : ""}`} disabled={!enabled} onClick={onMarkStart}><span className="mark-letter">A</span><strong>{active ? formatBarLabel(loopStart, config) : "Set start"}</strong></button><button className={`mark-button ${active ? "marked" : ""}`} disabled={!enabled} onClick={onMarkEnd}><span className="mark-letter mark-b">B</span><strong>{active ? formatBarLabel(loopEnd, config) : "Set end"}</strong></button></div>
    <div className="loop-footer">{active ? <><span><span className="loop-status-dot" />{formatBarLength(loopStart, loopEnd!, config, barDuration)}</span><button onClick={onClear}>Clear</button></> : <span />}</div>
    </div>
  </div>;
}

function snapToBar(time: number, bpm: number | null, offset: number, barTimes: number[], meter: 3 | 4): number {
  if (barTimes.length > 0) return closestValue(barTimes, time) ?? Math.max(0, time);
  const barDuration = bpm ? 60 / bpm * meter : 0;
  if (!barDuration) return Math.max(0, time);
  return Math.max(0, offset + Math.round((time - offset) / barDuration) * barDuration);
}

function getBarTimes(beatTimes: number[], meter: 3 | 4): number[] {
  return beatTimes.filter((_, index) => index % meter === 0);
}

function formatBarLabel(time: number, config: PracticeConfig): string {
  if (config.barTimes.length > 0) {
    const index = nearestIndex(config.barTimes, time);
    return `Bar ${index + 1}`;
  }
  const barDuration = config.bpm ? 60 / config.bpm * config.meter : 0;
  const index = barDuration > 0 ? Math.max(0, Math.round((time - config.beatOffset) / barDuration)) : 0;
  return `Bar ${index + 1}`;
}

function formatBarLength(start: number, end: number, config: PracticeConfig, barDuration: number): string {
  const startIndex = nearestIndex(config.barTimes, start);
  const endIndex = nearestIndex(config.barTimes, end);
  const numberOfBars = startIndex >= 0 && endIndex >= startIndex
    ? endIndex - startIndex
    : barDuration > 0 ? Math.max(1, Math.round((end - start) / barDuration)) : 1;
  return `${numberOfBars} ${numberOfBars === 1 ? "bar" : "bars"}`;
}

function buildUniformBeatTimes(duration: number, bpm: number, offset: number): number[] {
  const interval = 60 / bpm;
  const beatTimes: number[] = [];
  for (let time = Math.max(0, offset); time <= duration; time += interval) {
    beatTimes.push(Math.round(time * 1000) / 1000);
  }
  return beatTimes;
}

function shiftBeatTimes(beatTimes: number[], delta: number): number[] {
  if (!delta) return beatTimes;
  return beatTimes.map((time) => Math.max(0, time + delta));
}

function mappedBarEnd(barTimes: number[], start: number, bars: number): number | null {
  const startIndex = nearestIndex(barTimes, start);
  const endIndex = startIndex + bars;
  return startIndex >= 0 ? barTimes[endIndex] ?? null : null;
}

function mappedBarStart(barTimes: number[], end: number, bars: number): number | null {
  const endIndex = nearestIndex(barTimes, end);
  const startIndex = endIndex - bars;
  return endIndex >= 0 ? barTimes[startIndex] ?? null : null;
}

function moveOnBarMap(barTimes: number[], current: number, bars: number): number | null {
  if (barTimes.length === 0) return null;
  let index = 0;
  while (index + 1 < barTimes.length && (barTimes[index + 1] ?? Infinity) <= current) index += 1;
  return barTimes[index + bars] ?? null;
}

function nearestIndex(times: number[], target: number): number {
  if (times.length === 0) return -1;
  let closest = 0;
  let distance = Math.abs((times[0] ?? 0) - target);
  for (let index = 1; index < times.length; index += 1) {
    const nextDistance = Math.abs((times[index] ?? 0) - target);
    if (nextDistance < distance) {
      closest = index;
      distance = nextDistance;
    }
  }
  return closest;
}

function closestValue(times: number[], target: number): number | null {
  const index = nearestIndex(times, target);
  return index >= 0 ? times[index] ?? null : null;
}

function UploadIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" /></svg>; }
function SelfieIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3l1.5-2h7l1.5 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none" /></svg>; }
function PauseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>; }
function PulseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>; }
function MirrorIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4 7h5v10H4zM15 7h5v10h-5z" /></svg>; }
function LibraryIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16" /></svg>; }
function SkipIcon({ reverse = false }: { reverse?: boolean }) { return <svg className={reverse ? "reverse-icon" : ""} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l11-7zM19 5v14"/><path d="M11 3h2" className="skip-eight" /></svg>; }
