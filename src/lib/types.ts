export type Meter = 3 | 4;

export interface PracticeConfig {
  meter: Meter;
  bpm: number | null;
  beatOffset: number;
  beatTimes: number[];
  barTimes: number[];
  mirrored: boolean;
  loopStart: number | null;
  loopEnd: number | null;
}

export interface VideoIdentity {
  key: string;
  name: string;
  size: number;
  modifiedAt: number;
}

export const DEFAULT_CONFIG: PracticeConfig = {
  meter: 4,
  bpm: null,
  beatOffset: 0,
  beatTimes: [],
  barTimes: [],
  mirrored: false,
  loopStart: null,
  loopEnd: null,
};
