import { DEFAULT_CONFIG, type PracticeConfig } from "./types";

export function loadConfig(key: string, legacyKey?: string): PracticeConfig {
  try {
    const saved = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    if (!saved) return DEFAULT_CONFIG;
    const parsed: unknown = JSON.parse(saved);
    if (!isPracticeConfig(parsed)) return DEFAULT_CONFIG;
    const beatTimes = numericTimes(parsed.beatTimes);
    const barTimes = numericTimes(parsed.barTimes);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      beatTimes,
      barTimes,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function numericTimes(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((time): time is number => typeof time === "number" && Number.isFinite(time) && time >= 0)
    : [];
}

export function saveConfig(key: string, config: PracticeConfig): void {
  try {
    localStorage.setItem(key, JSON.stringify(config));
  } catch {
    // Private browsing and full storage can disable persistence; practice still works.
  }
}

function isPracticeConfig(value: unknown): value is PracticeConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<PracticeConfig>;
  return (config.meter === 3 || config.meter === 4)
    && (config.bpm === null || (typeof config.bpm === "number" && config.bpm > 0))
    && typeof config.beatOffset === "number"
    && (config.beatTimes === undefined || Array.isArray(config.beatTimes))
    && (config.barTimes === undefined || Array.isArray(config.barTimes))
    && (config.mirrored === undefined || typeof config.mirrored === "boolean")
    && (config.loopStart === null || typeof config.loopStart === "number")
    && (config.loopEnd === null || typeof config.loopEnd === "number");
}
