import { describe, expect, it } from 'vitest';
import { clusterRadarDetections } from '../../src/sim/radarFusion';
import type { HeightMap } from '../../src/sim/grid';
import type { SiteMeasurement } from '../../src/sim/scenario';
import type { Vec3 } from '../../src/sim/types';

const flat: HeightMap = { ox: -20, oy: -20, cell: 0.25, nx: 160, ny: 160, top: new Float32Array(25600).fill(0), bottom: new Float32Array(25600).fill(0), count: new Uint16Array(25600).fill(1) };
const EPS = 6;

function meas(site: Vec3, victim: Vec3 | null, hotspotId: string, i: number): SiteMeasurement {
  const d = victim ? Math.hypot(site[0] - victim[0], site[1] - victim[1], site[2] - victim[2]) : 0;
  return {
    id: `M${i}`, siteId: `${hotspotId}-L${i}`, hotspotId, droneId: 'r', simTime: 0, sitePos: site,
    signal: new Float32Array(0), fs: 20, spectrum: { freq: new Float32Array(0), power: new Float32Array(0) },
    detection: { detected: !!victim, confidence: 0.9, breathingHz: victim ? 0.25 : null, heartHz: null, breathingSnrDb: 20, heartSnrDb: 0, disturbed: false },
    rangeElectrical: victim ? Math.sqrt(EPS) * d : null, snrDb: 20, truthVictimId: victim ? 'V' : null, truthSlant: victim ? d : null,
  };
}

describe('fuzja pomiarów radaru w osoby', () => {
  it('jedna osoba słyszana z lądowisk dwóch hot spotów → jedna hipoteza z pozycją 3D', () => {
    const v: Vec3 = [1, 0.5, -1.2];
    const ms = [
      meas([2.5, 0, 0], v, 'H1', 1), meas([0, 2, 0], v, 'H1', 2),
      meas([-0.8, -1, 0], v, 'H2', 3), meas([2.2, 2.4, 0], v, 'H2', 4),
      meas([9, 9, 0], null, 'H2', 5),
    ];
    const hyps = clusterRadarDetections(ms, flat);
    expect(hyps.length).toBe(1);
    expect(hyps[0].members.length).toBe(4);
    expect(hyps[0].estimate).toBeTruthy();
    expect(Math.hypot(hyps[0].position[0] - v[0], hyps[0].position[1] - v[1])).toBeLessThan(0.5);
  });

  it('dwie osoby 8 m od siebie → dwie hipotezy', () => {
    const a: Vec3 = [0, 0, -1], b: Vec3 = [8, 0, -1];
    const ms = [
      meas([1.5, 0, 0], a, 'H1', 1), meas([-1, 1.3, 0], a, 'H1', 2), meas([-0.6, -1.5, 0], a, 'H1', 3),
      meas([9.5, 0, 0], b, 'H2', 4), meas([7, 1.4, 0], b, 'H2', 5), meas([7.3, -1.6, 0], b, 'H2', 6),
    ];
    const hyps = clusterRadarDetections(ms, flat).sort((p, q) => p.position[0] - q.position[0]);
    expect(hyps.length).toBe(2);
    expect(Math.hypot(hyps[0].position[0] - a[0], hyps[0].position[1] - a[1])).toBeLessThan(0.5);
    expect(Math.hypot(hyps[1].position[0] - b[0], hyps[1].position[1] - b[1])).toBeLessThan(0.5);
  });

  it('pojedyncza detekcja → hipoteza bez pozycji 3D', () => {
    const hyps = clusterRadarDetections([meas([0, 0, 0], [1, 0, -1], 'H1', 1)], flat);
    expect(hyps.length).toBe(1);
    expect(hyps[0].estimate).toBeNull();
  });
});
