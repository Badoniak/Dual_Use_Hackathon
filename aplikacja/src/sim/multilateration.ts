// Lokalizacja ofiary z kilku pomiarów radaru o znanych pozycjach (RTK + powierzchnia z lidaru).
// Radar mierzy odległość elektryczną R = √εr · d, a przenikalność gruzu εr (≈4–9) jest nieznana,
// więc dla każdej εr z przedziału rozwiązujemy pozycję (Gauss–Newton), a głębokość podajemy jako przedział
// z rozwiązań zgodnych z pomiarami.
import { sampleHeight, type HeightMap } from './grid';
import type { Vec3, VictimEstimate } from './types';

export interface RangeMeasurement {
  site: Vec3;
  rangeElectrical: number;
}

export interface MultilatParams {
  epsMin: number;
  epsMax: number;
  epsStep: number;
  /** oczekiwany błąd odległości geometrycznej [m] */
  sigma: number;
}

export const DEFAULT_MULTILAT_PARAMS: MultilatParams = { epsMin: 4, epsMax: 9, epsStep: 0.1, sigma: 0.02 };

function solveFixedEps(ms: RangeMeasurement[], eps: number, init: Vec3): { p: Vec3; rms: number } {
  const p: Vec3 = [...init];
  const se = Math.sqrt(eps);
  for (let it = 0; it < 40; it++) {
    // J^T J i J^T r (3×3)
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const g = [0, 0, 0];
    for (const m of ms) {
      const dx = p[0] - m.site[0], dy = p[1] - m.site[1], dz = p[2] - m.site[2];
      const d = Math.max(1e-6, Math.hypot(dx, dy, dz));
      const r = d - m.rangeElectrical / se;
      const J = [dx / d, dy / d, dz / d];
      for (let i = 0; i < 3; i++) { g[i] += J[i] * r; for (let j = 0; j < 3; j++) A[3 * i + j] += J[i] * J[j]; }
    }
    // regularyzacja Levenberga (3 punkty ≈ układ osobliwy w pionie)
    for (let i = 0; i < 3; i++) A[4 * i] += 1e-3;
    const step = solve3(A, g);
    if (!step) break;
    p[0] -= step[0]; p[1] -= step[1]; p[2] -= step[2];
    if (Math.hypot(step[0], step[1], step[2]) < 1e-5) break;
  }
  let se2 = 0;
  for (const m of ms) se2 += (Math.hypot(p[0] - m.site[0], p[1] - m.site[1], p[2] - m.site[2]) - m.rangeElectrical / se) ** 2;
  return { p, rms: Math.sqrt(se2 / ms.length) };
}

function solve3(A: number[], b: number[]): number[] | null {
  const [a, bb, c, d, e, f, g, h, i] = A;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    e * i - f * h, c * h - bb * i, bb * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, bb * g - a * h, a * e - bb * d,
  ].map(v => v / det);
  return [0, 1, 2].map(r => inv[3 * r] * b[0] + inv[3 * r + 1] * b[1] + inv[3 * r + 2] * b[2]);
}

/** Powierzchnia, od której liczymy głębokość (domyślnie wierzch mapy wysokości). */
export type SurfaceFn = (x: number, y: number) => number;

export function locateVictim(ms: RangeMeasurement[], hm: HeightMap, hotspotId: string, guess: Vec3, p: MultilatParams = DEFAULT_MULTILAT_PARAMS, surfaceFn?: SurfaceFn): VictimEstimate | null {
  if (ms.length < 3) return null;
  const surfaceAt: SurfaceFn = surfaceFn ?? ((x, y) => sampleHeight(hm, x, y));
  const sols: { eps: number; p: Vec3; rms: number; depth: number; surface: number }[] = [];
  // anteny leżą zwykle prawie w jednej płaszczyźnie → dwa lustrzane rozwiązania (nad i pod nią).
  // Rozwiązujemy z dwóch punktów startowych i wybieramy to pod powierzchnią, bliższe prognozie.
  const planeZ = ms.reduce((a, m) => a + m.site[2], 0) / ms.length;
  const mirror: Vec3 = [guess[0], guess[1], 2 * planeZ - guess[2]];
  for (let eps = p.epsMin; eps <= p.epsMax + 1e-9; eps += p.epsStep) {
    const cands = [solveFixedEps(ms, eps, guess), solveFixedEps(ms, eps, mirror)].map(s => {
      const surf = surfaceAt(s.p[0], s.p[1]);
      return { ...s, surf, below: Number.isNaN(surf) || s.p[2] <= surf + 0.05 };
    });
    const minR = Math.min(...cands.map(c => c.rms));
    const best = cands
      .filter(c => c.rms <= minR + 0.01)
      .sort((a, b) => Number(b.below) - Number(a.below) || Math.abs(a.p[2] - guess[2]) - Math.abs(b.p[2] - guess[2]))[0];
    sols.push({ eps, p: best.p, rms: best.rms, depth: best.surf - best.p[2], surface: best.surf });
  }
  const minRms = Math.min(...sols.map(s => s.rms));
  const thr = Math.max(2 * p.sigma, 1.5 * minRms);
  const ok = sols.filter(s => s.rms <= thr && s.depth > -0.2);
  if (ok.length === 0) return null;
  const best = ok.reduce((a, b) => (b.rms < a.rms ? b : a));
  // środek przedziału εr jako estymata punktowa, gdy pomiary nie rozróżniają εr
  const mid = ok[Math.floor(ok.length / 2)];
  const pick = ok.length > 3 && best.rms > 0.5 * p.sigma ? best : mid;
  const horiz = Math.max(0.2, ...ok.map(s => Math.hypot(s.p[0] - pick.p[0], s.p[1] - pick.p[1])));
  // głębokość liczona od powierzchni gruzu, która w promieniu niepewności położenia nie jest płaska
  // (percentyle 15–85 — pojedyncza ściana czy nawis w promieniu niepewności nie rozciąga przedziału)
  const surf: number[] = [];
  for (let dy = -horiz; dy <= horiz + 1e-9; dy += hm.cell) for (let dx = -horiz; dx <= horiz + 1e-9; dx += hm.cell) {
    if (dx * dx + dy * dy > horiz * horiz) continue;
    const z = surfaceAt(pick.p[0] + dx, pick.p[1] + dy);
    if (!Number.isNaN(z)) surf.push(z);
  }
  surf.sort((a, b) => a - b);
  const pct = (q: number) => surf[Math.min(surf.length - 1, Math.max(0, Math.round(q * (surf.length - 1))))];
  const sMin = surf.length ? Math.min(pick.surface, pct(0.15)) : pick.surface;
  const sMax = surf.length ? Math.max(pick.surface, pct(0.85)) : pick.surface;
  const zTop = Math.max(...ok.map(s => s.p[2])), zBot = Math.min(...ok.map(s => s.p[2]));
  return {
    hotspotId,
    position: pick.p,
    surfaceZ: pick.surface,
    depthBest: Math.max(0, pick.depth),
    depthMin: Math.max(0, Math.min(Math.min(...ok.map(s => s.depth)), sMin - zTop)),
    depthMax: Math.max(0, Math.max(Math.max(...ok.map(s => s.depth)), sMax - zBot)),
    epsBest: pick.eps,
    epsMin: Math.min(...ok.map(s => s.eps)),
    epsMax: Math.max(...ok.map(s => s.eps)),
    horizontalErr: horiz,
    rmsResidual: pick.rms,
    nMeasurements: ms.length,
  };
}
