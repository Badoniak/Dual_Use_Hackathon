import { describe, expect, it } from 'vitest';
import { runScoutPipeline } from '../../src/sim/pipeline';
import { parsePly } from '../../src/sim/parse';
import { diskSource, hasData, readBuffer } from './data';

describe.skipIf(!hasData)('rozdzielenie czujników: lidar i kamera RGB-D', () => {
  it('warstwa RGB-D z map głębi leży na powierzchniach mapy i ma kolory z kamery; lidar bez punktów kamery', async () => {
    const area: [number, number][] = [[-8, -16], [44, -16], [44, 16], [-8, 16]];
    const res = await runScoutPipeline(diskSource, { areaLocal: area });
    const { positions, colors, count, nLidar } = res.cloud;
    const nRgbd = count - nLidar;
    console.log('czasy', res.stats.timingsMs, `lidar ${nLidar}, RGB-D ${nRgbd} (klatki ${res.stats.rgbdFrames})`);
    expect(nLidar).toBeGreaterThan(100000);
    expect(nRgbd).toBeGreaterThan(100000);
    expect(res.stats.rgbdFrames).toBeGreaterThan(250);

    // punkty RGB-D leżą na powierzchniach scalonej mapy (woksel 0,1 m ± sąsiedztwo)
    const pc = parsePly(readBuffer('point_cloud_map.ply'));
    const key = (x: number, y: number, z: number) => `${Math.floor(x / 0.1)},${Math.floor(y / 0.1)},${Math.floor(z / 0.1)}`;
    const occ = new Set<string>();
    for (let i = 0; i < pc.count; i++) occ.add(key(pc.positions[3 * i], pc.positions[3 * i + 1], pc.positions[3 * i + 2]));
    let onSurface = 0, colored = 0, sample = 0;
    for (let i = nLidar; i < count; i += 23) {
      sample++;
      const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
      let hit = false;
      for (let dz = -1; dz <= 1 && !hit; dz++) for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) hit = occ.has(key(x + dx * 0.1, y + dy * 0.1, z + dz * 0.1));
      if (hit) onSurface++;
      if (!(colors[3 * i] === 170 && colors[3 * i + 1] === 170 && colors[3 * i + 2] === 170)) colored++;
    }
    console.log('na powierzchni', (onSurface / sample).toFixed(3), 'kolor z kamery', (colored / sample).toFixed(3));
    expect(onSurface / sample).toBeGreaterThan(0.95);
    expect(colored / sample).toBeGreaterThan(0.95);
  });
});
