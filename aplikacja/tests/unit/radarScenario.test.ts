import { describe, expect, it } from 'vitest';
import { runScoutPipeline } from '../../src/sim/pipeline';
import { measureAtSite, DEFAULT_SCENARIO, type SimVictim } from '../../src/sim/scenario';
import { clusterRadarDetections } from '../../src/sim/radarFusion';
import { radarFusionOptions } from '../../src/store/useMissionStore';
import type { Hotspot, Vec3 } from '../../src/sim/types';
import { diskSource, hasData } from './data';

describe.skipIf(!hasData)('faza 2 na geometrii ze skanu: osoba 1 m pod hot spotem', () => {
  it('radar wykrywa osobę, pozycja < 1 m, przedział głębokości zawiera prawdę, brak fałszywych alarmów', async () => {
    const area: [number, number][] = [[-8, -16], [44, -16], [44, 16], [-8, 16]];
    const res = await runScoutPipeline(diskSource, { areaLocal: area });
    const reachable = (h: Hotspot) => res.landingSites.filter(l => l.hotspotId === h.id && Math.hypot(l.position[0] - h.position[0], l.position[1] - h.position[1], l.position[2] - (h.position[2] - 1)) <= 2.6).length >= 3;
    const targets = res.hotspots.filter(h => h.radarCandidate && reachable(h));
    expect(targets.length).toBeGreaterThan(0);
    for (const h of targets) {
      const v: SimVictim = { id: 'P', name: 'test', position: [h.position[0], h.position[1], h.position[2] - 1] as Vec3, breathHz: 0.25, heartHz: 1.2, source: 'operator' };
      const ms = res.landingSites.map((l, i) => measureAtSite(l, [v], DEFAULT_SCENARIO, 1000 + i, 'r', 0));
      expect(ms.filter(m => m.detection.detected && !m.truthVictimId).length).toBe(0);
      const hyps = clusterRadarDetections(ms, res.heightmap, radarFusionOptions(res.hotspots, res.heightmap));
      const hyp = hyps.sort((a, b) => Math.hypot(a.position[0] - v.position[0], a.position[1] - v.position[1]) - Math.hypot(b.position[0] - v.position[0], b.position[1] - v.position[1]))[0];
      expect(hyp?.estimate).toBeTruthy();
      const e = hyp.estimate!;
      console.log(`${h.id}: ${hyp.members.length} pkt, błąd poziomy ${Math.hypot(e.position[0] - v.position[0], e.position[1] - v.position[1]).toFixed(2)} m, głębokość ${e.depthMin.toFixed(2)}–${e.depthMax.toFixed(2)} m`);
      expect(Math.hypot(e.position[0] - v.position[0], e.position[1] - v.position[1])).toBeLessThan(1);
      expect(e.depthMin - 0.15).toBeLessThanOrEqual(1);
      expect(e.depthMax + 0.15).toBeGreaterThanOrEqual(1);
      expect(e.depthMax - e.depthMin).toBeLessThan(2.5);
    }
  });
});
