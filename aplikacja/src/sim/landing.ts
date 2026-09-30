// Miejsca lądowania dronów fazy 2 z mapy wysokości (lidar):
// nachylenie < 15°, płaski fragment ≥ ~1,25 × 1,25 m, brak przeszkód dla śmigieł.
// Lądowiska szukamy jak najbliżej hot spotu (radar ma zasięg ~3 m w gruzie): najpierw do 2,5 m,
// dalej tylko wtedy, gdy brakuje bezpiecznych miejsc (maks. 5 m, jak w koncepcji).
import type { HeightMap } from './grid';
import type { Hotspot, LandingSite } from './types';

export interface LandingParams {
  /** połowa okna dopasowania płaszczyzny w komórkach (2 → okno 5×5 = 1,25 m przy 0,25 m) */
  halfWindow: number;
  /** połowa okna sprawdzania przeszkód dla śmigieł */
  clearanceHalfWindow: number;
  maxSlopeDeg: number;
  maxRoughness: number;
  maxObstacle: number;
  minDist: number;
  maxDist: number;
  preferredDist: number;
  /** kolejne promienie poszukiwań — większy tylko, gdy w mniejszym jest < 3 lądowisk */
  radiusSteps: number[];
  /** do tej odległości (3D) lądowiska mają pierwszeństwo przed sondą */
  nearLandingDist: number;
  /** wariant T: sonda radaru opuszczana na lince z zawisu, na nierówny gruz */
  allowProbe: boolean;
  probeMinDist: number;
  probeMaxDist: number;
  probeMaxSlopeDeg: number;
  maxSites: number;
  minSeparationDeg: number;
  minSpacing: number;
}

export const DEFAULT_LANDING_PARAMS: LandingParams = {
  halfWindow: 2,
  // obrys drona ~1 m + zapas → sprawdzamy przeszkody w oknie 1,25 × 1,25 m
  clearanceHalfWindow: 2,
  maxSlopeDeg: 15,
  maxRoughness: 0.08,
  maxObstacle: 0.4,
  minDist: 0.8,
  maxDist: 5.0,
  preferredDist: 1.3,
  radiusSteps: [2.0, 2.5, 3.0, 3.5, 4.0, 5.0],
  nearLandingDist: 2.5,
  allowProbe: true,
  probeMinDist: 0.6,
  probeMaxDist: 2.0,
  probeMaxSlopeDeg: 35,
  maxSites: 4,
  minSeparationDeg: 60,
  minSpacing: 1.2,
};

export interface CellEval {
  ok: boolean;
  z: number;
  slopeDeg: number;
  roughness: number;
  obstacle: number;
}

export function evaluateCell(hm: HeightMap, ix: number, iy: number, p: LandingParams = DEFAULT_LANDING_PARAMS): CellEval {
  const bad = { ok: false, z: NaN, slopeDeg: 90, roughness: Infinity, obstacle: Infinity };
  const h = p.halfWindow;
  const c = p.clearanceHalfWindow;
  if (ix - c < 0 || iy - c < 0 || ix + c >= hm.nx || iy + c >= hm.ny) return bad;
  // dopasowanie płaszczyzny z = a*x + b*y + c na symetrycznym oknie
  let sxz = 0, syz = 0, sz = 0, sxx = 0, syy = 0, n = 0;
  for (let dy = -h; dy <= h; dy++) {
    for (let dx = -h; dx <= h; dx++) {
      const z = hm.top[(iy + dy) * hm.nx + ix + dx];
      if (Number.isNaN(z)) return bad;
      const x = dx * hm.cell, y = dy * hm.cell;
      sxz += x * z; syz += y * z; sz += z; sxx += x * x; syy += y * y; n++;
    }
  }
  const a = sxz / sxx, b = syz / syy, z0 = sz / n;
  let se = 0;
  for (let dy = -h; dy <= h; dy++) {
    for (let dx = -h; dx <= h; dx++) {
      const z = hm.top[(iy + dy) * hm.nx + ix + dx];
      const r = z - (a * dx * hm.cell + b * dy * hm.cell + z0);
      se += r * r;
    }
  }
  const roughness = Math.sqrt(se / n);
  const slopeDeg = (Math.atan(Math.hypot(a, b)) * 180) / Math.PI;
  // przeszkody wystające ponad płaszczyznę w zasięgu śmigieł
  let obstacle = 0;
  for (let dy = -c; dy <= c; dy++) {
    for (let dx = -c; dx <= c; dx++) {
      const z = hm.top[(iy + dy) * hm.nx + ix + dx];
      if (Number.isNaN(z)) continue;
      obstacle = Math.max(obstacle, z - (a * dx * hm.cell + b * dy * hm.cell + z0));
    }
  }
  const ok = slopeDeg < p.maxSlopeDeg && roughness < p.maxRoughness && obstacle < p.maxObstacle;
  return { ok, z: z0, slopeDeg, roughness, obstacle };
}

/** Punkt dla sondy na lince (wariant T): wystarczy stabilny gruz, bez płaskiego lądowiska. */
export function evaluateProbeCell(hm: HeightMap, ix: number, iy: number, p: LandingParams = DEFAULT_LANDING_PARAMS): CellEval {
  const bad = { ok: false, z: NaN, slopeDeg: 90, roughness: Infinity, obstacle: Infinity };
  if (ix - 1 < 0 || iy - 1 < 0 || ix + 1 >= hm.nx || iy + 1 >= hm.ny) return bad;
  let sxz = 0, syz = 0, sz = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const z = hm.top[(iy + dy) * hm.nx + ix + dx];
    if (Number.isNaN(z)) return bad;
    sxz += dx * hm.cell * z; syz += dy * hm.cell * z; sz += z; n++;
  }
  const sxx = 6 * hm.cell * hm.cell;
  const a = sxz / sxx, b = syz / sxx, z0 = sz / n;
  let se = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const r = hm.top[(iy + dy) * hm.nx + ix + dx] - (a * dx * hm.cell + b * dy * hm.cell + z0);
    se += r * r;
  }
  const roughness = Math.sqrt(se / n);
  const slopeDeg = (Math.atan(Math.hypot(a, b)) * 180) / Math.PI;
  return { ok: slopeDeg < p.probeMaxSlopeDeg && roughness < 0.2, z: z0, slopeDeg, roughness, obstacle: 0 };
}

export function findLandingSites(hm: HeightMap, hs: Hotspot, p: LandingParams = DEFAULT_LANDING_PARAMS, exclude: [number, number, number][] = [], excludeDist = 1.2): LandingSite[] {
  const [hx, hy, hz] = hs.position;
  const cand: LandingSite[] = [];
  const probes: LandingSite[] = [];
  const r = Math.ceil(p.maxDist / hm.cell);
  const cx = Math.floor((hx - hm.ox) / hm.cell), cy = Math.floor((hy - hm.oy) / hm.cell);
  const bearing = (x: number, y: number) => (Math.atan2(y - hy, x - hx) * 180) / Math.PI;
  for (let iy = cy - r; iy <= cy + r; iy++) {
    for (let ix = cx - r; ix <= cx + r; ix++) {
      const x = hm.ox + (ix + 0.5) * hm.cell, y = hm.oy + (iy + 0.5) * hm.cell;
      const dh = Math.hypot(x - hx, y - hy);
      if (dh < Math.min(p.minDist, p.probeMinDist) || dh > p.maxDist) continue;
      if (exclude.some(q => Math.hypot(q[0] - x, q[1] - y) < excludeDist)) continue;
      const e = evaluateCell(hm, ix, iy, p);
      // odległość 3D do hot spotu — dla radaru liczy się też różnica wysokości
      if (e.ok && dh >= p.minDist) {
        const d = Number.isNaN(hz) ? dh : Math.hypot(dh, e.z - hz);
        if (d <= p.maxDist) {
          const score = 0.25 * (1 - e.slopeDeg / p.maxSlopeDeg) + 0.2 * (1 - e.roughness / p.maxRoughness) + 0.55 * Math.exp(-(((d - p.preferredDist) / 1.0) ** 2));
          cand.push({ id: '', hotspotId: hs.id, position: [x, y, e.z], slopeDeg: e.slopeDeg, roughness: e.roughness, distance: d, horizontal: dh, bearingDeg: bearing(x, y), score, method: 'land' });
        }
      } else if (dh <= p.probeMaxDist) {
        const q = evaluateProbeCell(hm, ix, iy, p);
        if (!q.ok) continue;
        const d = Number.isNaN(hz) ? dh : Math.hypot(dh, q.z - hz);
        if (d > p.probeMaxDist + 0.5) continue;
        const score = 0.3 * (1 - q.slopeDeg / p.probeMaxSlopeDeg) + 0.7 * Math.exp(-(((d - 1.0) / 0.8) ** 2));
        probes.push({ id: '', hotspotId: hs.id, position: [x, y, q.z], slopeDeg: q.slopeDeg, roughness: q.roughness, distance: d, horizontal: dh, bearingDeg: bearing(x, y), score, method: 'probe' });
      }
    }
  }
  cand.sort((a, b) => b.score - a.score);
  probes.sort((a, b) => b.score - a.score);
  const pick = (pool: LandingSite[], sep: number, chosen: LandingSite[], maxR: number, limit: number) => {
    for (const c of pool) {
      if (chosen.length >= limit) break;
      if (c.distance > maxR || chosen.includes(c)) continue;
      const okSep = chosen.every(s => {
        let db = Math.abs(s.bearingDeg - c.bearingDeg) % 360;
        if (db > 180) db = 360 - db;
        return db >= sep && Math.hypot(s.position[0] - c.position[0], s.position[1] - c.position[1]) >= p.minSpacing;
      });
      if (okSep) chosen.push(c);
    }
    return chosen;
  };
  const steps = p.radiusSteps.filter(r => r <= p.maxDist + 1e-9);
  const near = steps.filter(R => R <= p.nearLandingDist);
  const far = steps.filter(R => R > p.nearLandingDist);
  let chosen: LandingSite[] = [];
  // 1) lądowiska blisko hot spotu
  near.forEach((R, k) => {
    if (chosen.length >= 3) return;
    const limit = k === 0 ? p.maxSites : 3;
    chosen = pick(cand, p.minSeparationDeg, [...chosen], R, limit);
    if (chosen.length < 3) chosen = pick(cand, 35, chosen, R, limit);
  });
  // 2) sonda na lince (wariant T) tuż przy hot spocie, gdy brakuje płaskich miejsc
  if (chosen.length < 3 && p.allowProbe) {
    chosen = pick(probes, p.minSeparationDeg, chosen, p.probeMaxDist + 0.5, 3);
    if (chosen.length < 3) chosen = pick(probes, 35, chosen, p.probeMaxDist + 0.5, 3);
  }
  // 3) dalsze lądowiska (do 5 m), tylko do 3 punktów
  far.forEach(R => {
    if (chosen.length >= 3) return;
    chosen = pick(cand, p.minSeparationDeg, chosen, R, 3);
    if (chosen.length < 3) chosen = pick(cand, 35, chosen, R, 3);
  });
  return chosen.sort((a, b) => a.distance - b.distance).map((s, i) => ({ ...s, id: `${hs.id}-${s.method === 'probe' ? 'T' : 'L'}${i + 1}` }));
}
