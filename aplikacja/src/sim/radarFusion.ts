// Fuzja pomiarów radaru fazy 2 w hipotezy "zasypana osoba".
// Jedną osobę może "słyszeć" kilka lądowisk, także należących do różnych hot spotów, więc
// wyniki grupujemy globalnie: dwa punkty mogą wykrywać tę samą osobę tylko wtedy, gdy
// |s1 − s2| ≤ d1 + d2, gdzie d = R/√εr ≤ R/2 (εr ≥ 4) — nierówność trójkąta.
import { sampleHeight, type HeightMap } from './grid';
import { locateVictim, DEFAULT_MULTILAT_PARAMS, type SurfaceFn } from './multilateration';
import type { SiteMeasurement } from './scenario';
import type { Hotspot, Vec3, VictimEstimate } from './types';

export interface VictimHypothesis {
  members: SiteMeasurement[];
  estimate: VictimEstimate | null;
  /** pozycja (z lokalizacji 3D albo zgrubna — środek punktów z detekcją) */
  position: Vec3;
}

const usable = (m: SiteMeasurement) => m.detection.detected && m.rangeElectrical !== null;
const maxGeom = (m: SiteMeasurement) => m.rangeElectrical! / Math.sqrt(DEFAULT_MULTILAT_PARAMS.epsMin);

function centroid(ms: SiteMeasurement[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const m of ms) for (let k = 0; k < 3; k++) c[k] += m.sitePos[k] / ms.length;
  return c;
}

export interface FusionOptions {
  /** powierzchnia, od której liczymy głębokość */
  surfaceFn?: SurfaceFn;
  /** prognoza wysokości osoby (np. poziom źródła ciepła najbliższego hot spotu) */
  priorZ?: (x: number, y: number) => number | null;
}

function fit(ms: SiteMeasurement[], hm: HeightMap, o: FusionOptions = {}, guessBelow = 1): VictimEstimate | null {
  if (ms.length < 3) return null;
  const c = centroid(ms);
  const prior = o.priorZ?.(c[0], c[1]) ?? null;
  const surf = o.surfaceFn ? o.surfaceFn(c[0], c[1]) : sampleHeight(hm, c[0], c[1]);
  // prognoza: poziom źródła ciepła hot spotu, a bez niego ~1 m pod powierzchnią
  const guess: Vec3 = [c[0], c[1], prior ?? (Number.isNaN(surf) ? c[2] : surf) - guessBelow];
  const surfaceFn = o.surfaceFn;
  return locateVictim(ms.map(m => ({ site: m.sitePos, rangeElectrical: m.rangeElectrical! })), hm, 'V', guess, undefined, surfaceFn);
}

/** Podział grupy na dwie (2-średnie po pozycjach punktów, start od najdalszej pary). */
function split(ms: SiteMeasurement[]): [SiteMeasurement[], SiteMeasurement[]] {
  let a = 0, b = 1, best = -1;
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
    const d = Math.hypot(ms[i].sitePos[0] - ms[j].sitePos[0], ms[i].sitePos[1] - ms[j].sitePos[1]);
    if (d > best) { best = d; a = i; b = j; }
  }
  let ca = ms[a].sitePos, cb = ms[b].sitePos;
  let A: SiteMeasurement[] = [], B: SiteMeasurement[] = [];
  for (let it = 0; it < 5; it++) {
    A = []; B = [];
    for (const m of ms) (Math.hypot(m.sitePos[0] - ca[0], m.sitePos[1] - ca[1]) <= Math.hypot(m.sitePos[0] - cb[0], m.sitePos[1] - cb[1]) ? A : B).push(m);
    if (!A.length || !B.length) break;
    ca = centroid(A); cb = centroid(B);
  }
  return [A, B];
}

function resolve(group: SiteMeasurement[], hm: HeightMap, depth: number, o: FusionOptions = {}): VictimHypothesis[] {
  const est = fit(group, hm, o);
  if (group.length < 3) return [{ members: group, estimate: null, position: roughPosition(group) }];
  if (est && est.rmsResidual <= 0.08) return [{ members: group, estimate: est, position: est.position }];
  if (depth >= 2 || group.length < 4) return [{ members: group, estimate: est && est.rmsResidual <= 0.15 ? est : null, position: est && est.rmsResidual <= 0.15 ? est.position : roughPosition(group) }];
  const [A, B] = split(group);
  if (!A.length || !B.length) return [{ members: group, estimate: null, position: roughPosition(group) }];
  return [...resolve(A, hm, depth + 1, o), ...resolve(B, hm, depth + 1, o)];
}

/** Zgrubna pozycja bez lokalizacji 3D: środek punktów ważony odwrotnością zmierzonej odległości. */
function roughPosition(ms: SiteMeasurement[]): Vec3 {
  let w = 0;
  const c: Vec3 = [0, 0, 0];
  for (const m of ms) {
    const wi = 1 / Math.max(0.5, m.rangeElectrical!);
    for (let k = 0; k < 3; k++) c[k] += m.sitePos[k] * wi;
    w += wi;
  }
  return [c[0] / w, c[1] / w, c[2] / w];
}

export function clusterRadarDetections(measurements: SiteMeasurement[], hm: HeightMap, o: FusionOptions = {}): VictimHypothesis[] {
  const det = measurements.filter(usable);
  // łączenie jednokrotne wg nierówności trójkąta
  const parent = det.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < det.length; i++) for (let j = i + 1; j < det.length; j++) {
    const d = Math.hypot(det[i].sitePos[0] - det[j].sitePos[0], det[i].sitePos[1] - det[j].sitePos[1], det[i].sitePos[2] - det[j].sitePos[2]);
    if (d <= maxGeom(det[i]) + maxGeom(det[j]) + 0.3) parent[find(i)] = find(j);
  }
  const groups = new Map<number, SiteMeasurement[]>();
  det.forEach((m, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), m]); });
  return [...groups.values()].flatMap(g => resolve(g, hm, 0, o));
}

/** Hot spoty w pobliżu hipotezy — najbliższy pierwszy. */
export function hotspotsNear(p: Vec3, hotspots: Hotspot[], radius = 5): Hotspot[] {
  return hotspots
    .map(h => ({ h, d: Math.hypot(h.position[0] - p[0], h.position[1] - p[1]) }))
    .filter(o => o.d <= radius)
    .sort((a, b) => a.d - b.d)
    .map(o => o.h);
}
