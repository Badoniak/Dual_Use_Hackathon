import { describe, expect, it } from 'vitest';
import { runScoutPipeline, type DisplayCloud } from '../../src/sim/pipeline';
import { pointInPolygon } from '../../src/sim/geo';
import { diskSource, hasData } from './data';


describe.skipIf(!hasData)('pełny pipeline fazy 1 na danych z symulacji', () => {
  it('hot spoty = potencjalne miejsca osób (termowizja + mikrofon), lądowiska blisko', async () => {
    const stages: string[] = [];
    // obszar ~50 × 30 m wokół zawalonej remizy (układ lokalny sesji)
    const area: [number, number][] = [[-2, -15], [46, -15], [46, 15], [-2, 15]];
    let early: DisplayCloud | null = null;
    const res = await runScoutPipeline(diskSource, { areaLocal: area }, s => { if (!stages.includes(s)) stages.push(s); }, c => { early = c; });
    console.log('czasy', res.stats.timingsMs, 'punkty obszaru', res.stats.points);
    for (const h of res.hotspots) console.log(h.id, h.position.map(v => v.toFixed(1)).join(','), `conf ${h.confidence.toFixed(2)} T ${h.evidence.thermal.toFixed(2)} A ${h.evidence.acoustic.toFixed(2)}`, 'lądowiska', res.landingSites.filter(s => s.hotspotId === h.id).map(s => s.distance.toFixed(1)).join('/'));
    expect(stages).toEqual(['telemetria', 'lidar', 'rgbd', 'termowizja', 'akustyka', 'fuzja', 'podgląd', 'gotowe']);
    // chmura do wyświetlenia: wysłana wcześnie, ta sama kolejność punktów co w wyniku, tylko obszar + margines
    expect(early).not.toBeNull();
    expect(early!.count).toBe(res.cloud.count);
    expect(early!.positions[3 * 100]).toBe(res.cloud.positions[3 * 100]);
    for (let i = 0; i < res.cloud.count; i += 997) {
      const x = res.cloud.positions[3 * i], y = res.cloud.positions[3 * i + 1];
      expect(x >= -6.01 && x <= 50.01 && y >= -19.01 && y <= 19.01).toBe(true);
    }
    // hot spoty: jeden rodzaj, zawsze obie składowe, wszystkie w obszarze
    expect(res.hotspots.length).toBeGreaterThan(2);
    for (const h of res.hotspots) {
      expect(h.kind).toBe('fused');
      expect(h.label).toBe('Potencjalne miejsce osoby');
      expect(h.thermalNote).toMatch(/^Termowizja/);
      expect(h.acousticNote).toMatch(/^Mikrofon/);
      expect(pointInPolygon(h.position[0], h.position[1], area) || Math.abs(h.position[0]) < 60).toBe(true);
    }
    // miejsce z silną anomalią cieplną i narastającymi trzaskami (ground truth: 26, −5) — obie składowe wysokie
    const best = res.hotspots.find(h => Math.hypot(h.position[0] - 26, h.position[1] + 5) < 2.5)!;
    expect(best).toBeTruthy();
    expect(best.evidence.thermal).toBeGreaterThan(0.3);
    expect(best.evidence.acoustic).toBeGreaterThan(0.5);
    expect(best.radarCandidate).toBe(true);
    // lądowiska: bezpieczne i blisko hot spotów
    expect(res.landingSites.length).toBeGreaterThanOrEqual(3);
    const d = res.landingSites.map(s => s.horizontal).sort((a, b) => a - b);
    for (const s of res.landingSites) {
      if (s.method === 'land') {
        expect(s.slopeDeg).toBeLessThan(15);
        expect(s.horizontal).toBeGreaterThanOrEqual(0.8);
      } else {
        // wariant T: sonda na lince tuż przy hot spocie
        expect(s.horizontal).toBeLessThanOrEqual(2.0);
      }
      expect(s.distance).toBeLessThanOrEqual(5.5);
    }
    console.log('odległości poziome', d.map(v => v.toFixed(1)).join(' '));
    expect(d[Math.floor(d.length / 2)]).toBeLessThanOrEqual(2.6);
    expect(res.landingSites.some(s => s.method === 'probe')).toBe(true);
    expect(res.ortho.rgb.width).toBeGreaterThan(100);
    expect(res.groundTruth.length).toBe(4);
  });
});
