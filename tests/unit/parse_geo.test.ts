import { describe, expect, it } from 'vitest';
import { parseFrameIndex, parseGps, parsePly, parseSoundSourcesYaml, parseTrajectory, parseWav } from '../../src/sim/parse';
import { fitGpsAnchor, lngLatToLocal, localToLngLat, pointInPolygon, polygonArea, trajectoryAt } from '../../src/sim/geo';
import { hasData, readBuffer, readText } from './data';

describe.skipIf(!hasData)('parsery danych z symulacji', () => {
  it('trajektoria, GPS i georeferencja', () => {
    const tr = parseTrajectory(readText('trajectory.csv'));
    expect(tr.t.length).toBeGreaterThan(2000);
    const gps = parseGps(readText('gps/gps.csv'));
    const fit = fitGpsAnchor(gps, tr);
    // punkt (0,0) świata Gazebo ~ 52.2297 N, 21.0122 E, szum GPS ~1-2 m
    expect(fit.lat0).toBeCloseTo(52.2297, 3);
    expect(fit.lon0).toBeCloseTo(21.0122, 3);
    expect(fit.residualM).toBeLessThan(3);
    const p = trajectoryAt(tr, 150);
    expect(Math.abs(p[0] - 25)).toBeLessThan(3);
  });

  it('chmura punktów PLY', () => {
    const pc = parsePly(readBuffer('point_cloud_map.ply'));
    expect(pc.count).toBe(1282590);
    let maxZ = -Infinity;
    for (let i = 0; i < pc.count; i++) maxZ = Math.max(maxZ, pc.positions[3 * i + 2]);
    expect(maxZ).toBeGreaterThan(10);
  });

  it('indeks klatek termowizji i ground truth', () => {
    const idx = parseFrameIndex(readText('thermal_camera/index.csv'));
    expect(idx.length).toBe(424);
    expect(idx[0].file).toMatch(/\.png$/);
    const gt = parseSoundSourcesYaml(readText('ground_truth/sound_sources.yaml'));
    expect(gt.map(s => s.type)).toEqual(['voice', 'voice', 'tone', 'crackle']);
    expect(gt[0].xyz).toEqual([23, 3.5, 1]);
    expect(gt[0].f0).toBe(190);
  });

  it('WAV', () => {
    const w = parseWav(readBuffer('microphone/microphone.wav'));
    expect(w.sampleRate).toBe(16000);
    expect(w.channels).toBe(2);
    expect(w.frames / w.sampleRate).toBeGreaterThan(250);
  });
});

describe('geometria', () => {
  it('konwersja lokalne <-> lng/lat jest odwracalna', () => {
    const a = { lat0: 52.2297, lon0: 21.0122, mode: 'gps' as const };
    const [lng, lat] = localToLngLat(a, 30, -12);
    const [x, y] = lngLatToLocal(a, lng, lat);
    expect(x).toBeCloseTo(30, 6);
    expect(y).toBeCloseTo(-12, 6);
  });
  it('punkt w wielokącie i pole', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(11, 5, sq)).toBe(false);
    expect(polygonArea(sq)).toBe(100);
  });
});
