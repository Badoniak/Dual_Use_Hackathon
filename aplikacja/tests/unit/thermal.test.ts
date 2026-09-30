import { describe, expect, it } from 'vitest';
import { decode } from 'fast-png';
import { parseFrameIndex, parsePly } from '../../src/sim/parse';
import { VoxelGrid } from '../../src/sim/grid';
import { ThermalMapper } from '../../src/sim/thermal';
import { hasData, readBuffer, readText } from './data';

describe.skipIf(!hasData)('termowizja rzutowana na mapę 3D', () => {
  it('wykrywa silną anomalię cieplną w miejscu z ground truth i obiekty o temperaturze ciała', () => {
    const pc = parsePly(readBuffer('point_cloud_map.ply'));
    const grid = VoxelGrid.fromPoints(pc.positions, pc.count, { minX: -50, minY: -40, minZ: -2, maxX: 60, maxY: 40, maxZ: 16 }, 0.25);
    const info = JSON.parse(readText('thermal_camera_info/thermal_camera_info.json'));
    const intr = { width: info.width, height: info.height, fx: info.K[0], fy: info.K[4], cx: info.K[2], cy: info.K[5] };
    const mapper = new ThermalMapper(grid, intr);
    const idx = parseFrameIndex(readText('thermal_camera/index.csv'));
    const t0 = performance.now();
    for (const f of idx) {
      const png = decode(new Uint8Array(readBuffer('thermal_camera/' + f.file)));
      mapper.addFrame(f, png.data as Uint16Array);
    }
    const ms = performance.now() - t0;
    const clusters = mapper.clusters();
    const fires = clusters.filter(c => c.kind === 'hot').sort((a, b) => b.hits - a.hits);
    const persons = clusters.filter(c => c.kind === 'body').sort((a, b) => b.hits - a.hits);
    console.log(`klatki: ${mapper.framesUsed}, promienie: ${mapper.raysCast}, ${ms.toFixed(0)} ms`);
    for (const c of [...persons.slice(0, 8), ...fires.slice(0, 5)]) {
      console.log(c.kind, c.centroid.map(v => v.toFixed(1)).join(','), 'vox', c.voxels, 'hits', c.hits, 'frames', c.frames, 'ratio', c.ratio.toFixed(2), 'T', c.maxTempK.toFixed(0), c.bestFrame);
    }
    // ground truth: smouldering_fire xyz [26, -5, 0.5]
    const nearFire = fires.find(c => Math.hypot(c.centroid[0] - 26, c.centroid[1] + 5) < 2.5);
    expect(nearFire).toBeTruthy();
    expect(persons.length).toBeGreaterThan(0);
  });
});
