// Plan lotu zwiadowcy nad obszarem wyznaczonym przez operatora: trasa pokrycia "w kosiarkę"
// (boustrophedon) z odstępem linii wynikającym z pola widzenia termowizji i zakładki 30%.
// Układ lokalny ENU [m].
import type { Vec3 } from './types';

export interface FlightPlanOptions {
  altitude: number;
  /** poziome pole widzenia kamery [°] (termowizja 640 px, fx 554 → 60°) */
  hfovDeg: number;
  overlap: number;
  speed: number;
  climbRate: number;
  turnS: number;
}

export const DEFAULT_FLIGHT: FlightPlanOptions = { altitude: 30, hfovDeg: 60, overlap: 0.3, speed: 8, climbRate: 3, turnS: 3 };

export interface FlightPlan {
  waypoints: Vec3[];
  /** czas dotarcia do kolejnych punktów [s] od startu */
  times: number[];
  duration: number;
  base: Vec3;
  altitude: number;
  swath: number;
  spacing: number;
  lines: number;
  lengthM: number;
}

export function swathWidth(altitude: number, hfovDeg: number): number {
  return 2 * altitude * Math.tan((hfovDeg * Math.PI) / 360);
}

/** Kierunek najdłuższej krawędzi wielokąta — linie przelotu są do niej równoległe. */
function mainAxis(poly: [number, number][]): number {
  let best = 0, ang = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L > best) { best = L; ang = Math.atan2(y2 - y1, x2 - x1); }
  }
  return ang;
}

export function planCoverage(polyIn: [number, number][], opts: Partial<FlightPlanOptions> = {}): FlightPlan {
  const o = { ...DEFAULT_FLIGHT, ...opts };
  const poly = polyIn.length > 3 && polyIn[0][0] === polyIn[polyIn.length - 1][0] && polyIn[0][1] === polyIn[polyIn.length - 1][1] ? polyIn.slice(0, -1) : polyIn;
  const ang = mainAxis(poly);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const rot = ([x, y]: [number, number]): [number, number] => [x * c - y * s, x * s + y * c];
  const unrot = ([x, y]: [number, number]): [number, number] => [x * c + y * s, -x * s + y * c];
  const rp = poly.map(rot);
  const minY = Math.min(...rp.map(p => p[1])), maxY = Math.max(...rp.map(p => p[1]));
  const swath = swathWidth(o.altitude, o.hfovDeg);
  const spacing = swath * (1 - o.overlap);
  const width = maxY - minY;
  const nLines = Math.max(1, Math.ceil(width / spacing));
  const step = width / nLines;
  const lines: [[number, number], [number, number]][] = [];
  for (let k = 0; k < nLines; k++) {
    const y = minY + step * (k + 0.5);
    const xs: number[] = [];
    for (let i = 0; i < rp.length; i++) {
      const [x1, y1] = rp[i], [x2, y2] = rp[(i + 1) % rp.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length < 2) continue;
    const a = Math.min(...xs), b = Math.max(...xs);
    lines.push(k % 2 === 0 ? [[a, y], [b, y]] : [[b, y], [a, y]]);
  }
  if (lines.length === 0) {
    const cx = rp.reduce((q, p) => q + p[0], 0) / rp.length, cy = rp.reduce((q, p) => q + p[1], 0) / rp.length;
    lines.push([[cx - 1, cy], [cx + 1, cy]]);
  }
  // baza (start dronów) kilka metrów przed początkiem pierwszej linii, poza obszarem
  const [s0, s1] = lines[0];
  const dir = Math.sign(s1[0] - s0[0]) || 1;
  const base2 = unrot([s0[0] - dir * 8, s0[1] - step / 2 - 4]);
  const h = o.altitude;
  const wps: Vec3[] = [[base2[0], base2[1], 0], [base2[0], base2[1], h]];
  for (const [p, q] of lines) {
    const P = unrot(p), Q = unrot(q);
    wps.push([P[0], P[1], h], [Q[0], Q[1], h]);
  }
  wps.push([base2[0], base2[1], h], [base2[0], base2[1], 0]);
  const times = [0];
  let len = 0;
  for (let i = 1; i < wps.length; i++) {
    const dh = Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][1] - wps[i - 1][1]);
    const dz = Math.abs(wps[i][2] - wps[i - 1][2]);
    len += dh + dz;
    // nawrót między liniami (dojście do początku kolejnej linii)
    const turn = i >= 4 && i < wps.length - 2 && i % 2 === 0 ? o.turnS : 0;
    times.push(times[i - 1] + dh / o.speed + dz / o.climbRate + turn);
  }
  return { waypoints: wps, times, duration: times[times.length - 1], base: wps[0], altitude: h, swath, spacing: step, lines: lines.length, lengthM: len };
}

/** Pozycja drona na planie w chwili t [s od startu]. */
export function planPositionAt(plan: FlightPlan, t: number): Vec3 {
  const { waypoints: w, times } = plan;
  if (t <= 0) return [...w[0]] as Vec3;
  if (t >= plan.duration) return [...w[w.length - 1]] as Vec3;
  let i = 1;
  while (i < times.length && times[i] < t) i++;
  const f = (t - times[i - 1]) / Math.max(1e-9, times[i] - times[i - 1]);
  return [0, 1, 2].map(k => w[i - 1][k] + (w[i][k] - w[i - 1][k]) * Math.min(1, f)) as Vec3;
}

/**
 * Czas "zeskanowania" terenu: dla komórek siatki 1 m — pierwsza chwila, w której dron
 * (na wysokości przelotu) miał ją w pasie widzenia. Zwraca funkcję czasu dla punktu (x, y).
 */
export function scanTimeField(plan: FlightPlan, bounds: { minX: number; minY: number; maxX: number; maxY: number }, cell = 1): (x: number, y: number) => number {
  const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const ny = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cell));
  const T = new Float32Array(nx * ny).fill(Infinity);
  const R = plan.swath / 2;
  const dt = 0.25;
  for (let t = 0; t <= plan.duration; t += dt) {
    const p = planPositionAt(plan, t);
    if (p[2] < plan.altitude * 0.5) continue; // skanujemy dopiero po wzniesieniu
    const r = R * Math.min(1, p[2] / plan.altitude);
    const i0 = Math.max(0, Math.floor((p[0] - r - bounds.minX) / cell)), i1 = Math.min(nx - 1, Math.floor((p[0] + r - bounds.minX) / cell));
    const j0 = Math.max(0, Math.floor((p[1] - r - bounds.minY) / cell)), j1 = Math.min(ny - 1, Math.floor((p[1] + r - bounds.minY) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      if (T[k] <= t) continue;
      const cx = bounds.minX + (i + 0.5) * cell, cy = bounds.minY + (j + 0.5) * cell;
      if (Math.hypot(cx - p[0], cy - p[1]) <= r) T[k] = t;
    }
  }
  return (x, y) => {
    const i = Math.floor((x - bounds.minX) / cell), j = Math.floor((y - bounds.minY) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return Infinity;
    return T[j * nx + i];
  };
}
