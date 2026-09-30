import { describe, expect, it } from 'vitest';
import { DEFAULT_RADAR_PARAMS, detectVitalSigns, maxDetectionRange, simulateRadarSignal, vitalSnrDb } from '../../src/sim/radar';
import { locateVictim } from '../../src/sim/multilateration';
import type { HeightMap } from '../../src/sim/grid';
import type { Vec3 } from '../../src/sim/types';

const victim = { breathHz: 0.25, heartHz: 1.2, breathMm: 5, heartMm: 0.4 };
const fs = DEFAULT_RADAR_PARAMS.fs;

describe('radar SFCW — model łącza', () => {
  it('zgodny z dokumentem koncepcji (α = 20 dB/m → ~1,78 m po wylądowaniu)', () => {
    const r = maxDetectionRange({ ...DEFAULT_RADAR_PARAMS, attenuationDbPerM: 20, antennaHeight: 0 });
    expect(r).toBeGreaterThan(1.6);
    expect(r).toBeLessThan(1.9);
  });
});

describe('detektor oznak życia', () => {
  it('wykrywa oddech i serce przy płytkim zasypaniu', () => {
    let hits = 0, heart = 0;
    for (let s = 1; s <= 20; s++) {
      const sig = simulateRadarSignal({ victim, snrDb: vitalSnrDb(1.2), seed: s, disturbance: false });
      const d = detectVitalSigns(sig, fs).detection;
      if (d.detected && Math.abs(d.breathingHz! - 0.25) < 0.03) hits++;
      if (d.heartHz && Math.abs(d.heartHz - 1.2) < 0.05) heart++;
    }
    expect(hits).toBeGreaterThanOrEqual(19);
    expect(heart).toBeGreaterThanOrEqual(15);
  });

  it('nie wykrywa ofiary poza zasięgiem budżetu łącza', () => {
    let hits = 0;
    for (let s = 1; s <= 20; s++) {
      const sig = simulateRadarSignal({ victim, snrDb: vitalSnrDb(maxDetectionRange() + 2), seed: s, disturbance: false });
      if (detectVitalSigns(sig, fs).detection.detected) hits++;
    }
    expect(hits).toBeLessThanOrEqual(2);
  });

  it('mało fałszywych alarmów bez ofiary, także gdy ratownik przechodzi w wiązce', () => {
    let fa = 0, disturbedFlag = 0;
    for (let s = 1; s <= 60; s++) {
      const dist = s % 2 === 0;
      const sig = simulateRadarSignal({ victim: null, snrDb: 0, seed: 1000 + s, disturbance: dist });
      const d = detectVitalSigns(sig, fs).detection;
      if (d.detected) fa++;
      if (dist && d.disturbed) disturbedFlag++;
    }
    expect(fa).toBeLessThanOrEqual(3);
    expect(disturbedFlag).toBeGreaterThanOrEqual(25);
  });
});

describe('multilateracja z nieznaną εr', () => {
  const flat: HeightMap = { ox: -10, oy: -10, cell: 0.25, nx: 80, ny: 80, top: new Float32Array(6400).fill(0), bottom: new Float32Array(6400).fill(0), count: new Uint16Array(6400).fill(1) };
  const truth: Vec3 = [0.6, -0.4, -1.5];
  const sites: Vec3[] = [[2, 0, 0], [-1.2, 1.8, 0], [-1.0, -1.9, 0], [0.4, 2.4, 0]];
  it('przedział głębokości zawiera prawdziwą głębokość', () => {
    for (const eps of [4.5, 6, 8]) {
      let seed = 3;
      const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
      const ms = sites.map(s => ({ site: s, rangeElectrical: Math.sqrt(eps) * Math.hypot(s[0] - truth[0], s[1] - truth[1], s[2] - truth[2]) + noise() }));
      const est = locateVictim(ms, flat, 'H1', [0, 0, -1])!;
      expect(est).toBeTruthy();
      expect(est.depthMin).toBeLessThanOrEqual(1.5 + 0.15);
      expect(est.depthMax).toBeGreaterThanOrEqual(1.5 - 0.15);
      expect(Math.hypot(est.position[0] - truth[0], est.position[1] - truth[1])).toBeLessThan(0.5 + est.horizontalErr);
      console.log(`εr=${eps}: głębokość ${est.depthMin.toFixed(2)}–${est.depthMax.toFixed(2)} m (best ${est.depthBest.toFixed(2)}), εr∈[${est.epsMin.toFixed(1)}, ${est.epsMax.toFixed(1)}], poz. ±${est.horizontalErr.toFixed(2)} m`);
    }
  });
  it('3 punkty: rozwiązanie istnieje, ale przedział głębokości jest szerszy', () => {
    const eps = 6;
    const ms = sites.slice(0, 3).map(s => ({ site: s, rangeElectrical: Math.sqrt(eps) * Math.hypot(s[0] - truth[0], s[1] - truth[1], s[2] - truth[2]) }));
    const est = locateVictim(ms, flat, 'H1', [0, 0, -1])!;
    expect(est.depthMax - est.depthMin).toBeGreaterThan(0.2);
    expect(est.depthMin).toBeLessThanOrEqual(1.55);
    expect(est.depthMax).toBeGreaterThanOrEqual(1.45);
  });
});
