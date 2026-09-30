// Scenariusz dla syntetycznego radaru fazy 2 (wg planu hackathonu: symulacja, bez sprzętu).
// "Prawda" o zasypanych osobach pochodzi z ground_truth symulacji (źródła typu voice) oraz
// z poszkodowanych dodanych przez operatora. Pipeline fazy 1 nigdy nie widzi tych danych.
import { rng, gaussian } from './dsp';
import { DEFAULT_RADAR_PARAMS, detectVitalSigns, simulateRadarSignal, vitalSnrDb, type RadarParams, type VitalSpectrum } from './radar';
import type { LandingSite, SoundSourceGT, Vec3, VitalDetection } from './types';

export interface SimVictim {
  id: string;
  name: string;
  position: Vec3;
  breathHz: number;
  heartHz: number;
  source: 'ground_truth' | 'operator';
}

export interface RadarScenarioConfig {
  attenuationDbPerM: number;
  /** rzeczywista przenikalność gruzu w scenariuszu (nieznana dla algorytmu) */
  epsTrue: number;
  /** prawdopodobieństwo, że ratownik wejdzie w wiązkę podczas pomiaru */
  disturbanceProb: number;
  measureS: number;
}

export const DEFAULT_SCENARIO: RadarScenarioConfig = {
  attenuationDbPerM: 10,
  epsTrue: 6.2,
  disturbanceProb: 0.15,
  measureS: 90,
};

export function victimsFromGroundTruth(gt: SoundSourceGT[]): SimVictim[] {
  return gt
    .filter(s => s.type === 'voice')
    .map((s, i) => ({
      id: `V${i + 1}`,
      name: s.name,
      position: [...s.xyz] as Vec3,
      breathHz: 0.22 + 0.05 * ((i * 37) % 5) / 4,
      heartHz: 1.05 + 0.3 * ((i * 53) % 7) / 6,
      source: 'ground_truth' as const,
    }));
}

export interface SiteMeasurement {
  id: string;
  siteId: string;
  hotspotId: string;
  droneId: string;
  simTime: number;
  sitePos: Vec3;
  signal: Float32Array;
  fs: number;
  spectrum: VitalSpectrum;
  detection: VitalDetection;
  /** zmierzona odległość elektryczna do ofiary (tylko gdy wykryto) */
  rangeElectrical: number | null;
  snrDb: number;
  /** ukryta prawda (tylko do ewaluacji w trybie demo) */
  truthVictimId: string | null;
  truthSlant: number | null;
}

export function measureAtSite(site: LandingSite, victims: SimVictim[], cfg: RadarScenarioConfig, seed: number, droneId: string, simTime: number): SiteMeasurement {
  const params: RadarParams = { ...DEFAULT_RADAR_PARAMS, attenuationDbPerM: cfg.attenuationDbPerM, durationS: cfg.measureS };
  const r = rng(seed);
  let best: { v: SimVictim; d: number; snr: number } | null = null;
  for (const v of victims) {
    const d = Math.hypot(v.position[0] - site.position[0], v.position[1] - site.position[1], v.position[2] - site.position[2]);
    const snr = vitalSnrDb(d, params);
    if (!best || snr > best.snr) best = { v, d, snr };
  }
  const disturbance = r() < cfg.disturbanceProb;
  const victim = best && best.snr > -20 ? best : null;
  const signal = simulateRadarSignal({
    victim: victim ? { breathHz: victim.v.breathHz, heartHz: victim.v.heartHz, breathMm: 5, heartMm: 0.4 } : null,
    snrDb: victim ? victim.snr : 0,
    seed: seed * 7 + 1,
    disturbance,
    params,
  });
  const { detection, spectrum } = detectVitalSigns(signal, params.fs, params);
  const rangeElectrical = detection.detected && victim ? Math.sqrt(cfg.epsTrue) * victim.d + gaussian(r) * params.rangeSigma : null;
  return {
    id: `M-${site.id}`,
    siteId: site.id,
    hotspotId: site.hotspotId,
    droneId,
    simTime,
    sitePos: site.position,
    signal,
    fs: params.fs,
    spectrum,
    detection,
    rangeElectrical,
    snrDb: victim ? victim.snr : -Infinity,
    truthVictimId: victim && detection.detected ? victim.v.id : null,
    truthSlant: victim ? victim.d : null,
  };
}
