// Georeferencja układu lokalnego ENU (sfera o promieniu średnim Ziemi — błąd < 0,2% na kilkuset metrach).
import type { GeoAnchor, GpsFix, Trajectory, Vec3 } from './types';

const R_EARTH = 6371008.8;
const DEG = Math.PI / 180;
export const M_PER_DEG_LAT = R_EARTH * DEG;

export function mPerDegLon(lat: number): number {
  return M_PER_DEG_LAT * Math.cos(lat * DEG);
}

export function localToLngLat(a: GeoAnchor, x: number, y: number): [number, number] {
  return [a.lon0 + x / mPerDegLon(a.lat0), a.lat0 + y / M_PER_DEG_LAT];
}

export function lngLatToLocal(a: GeoAnchor, lng: number, lat: number): [number, number] {
  return [(lng - a.lon0) * mPerDegLon(a.lat0), (lat - a.lat0) * M_PER_DEG_LAT];
}

/** Interpolowana pozycja z trajektorii w chwili t (ekstrapolacja stałą na końcach). */
export function trajectoryAt(tr: Trajectory, t: number): Vec3 {
  const n = tr.t.length;
  if (n === 0) return [0, 0, 0];
  if (t <= tr.t[0]) return [tr.pos[0], tr.pos[1], tr.pos[2]];
  if (t >= tr.t[n - 1]) return [tr.pos[3 * n - 3], tr.pos[3 * n - 2], tr.pos[3 * n - 1]];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.t[mid] <= t) lo = mid; else hi = mid;
  }
  const f = (t - tr.t[lo]) / (tr.t[hi] - tr.t[lo] || 1);
  return [0, 1, 2].map(k => tr.pos[3 * lo + k] * (1 - f) + tr.pos[3 * hi + k] * f) as Vec3;
}

/** Kurs (yaw) z kwaternionu, stopnie od osi x przeciwnie do ruchu wskazówek. */
export function trajectoryYawAt(tr: Trajectory, t: number): number {
  const n = tr.t.length;
  let i = 0;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.t[mid] <= t) lo = mid; else hi = mid;
  }
  i = lo;
  const x = tr.quat[4 * i], y = tr.quat[4 * i + 1], z = tr.quat[4 * i + 2], w = tr.quat[4 * i + 3];
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) / DEG;
}

/**
 * Dopasowanie początku układu lokalnego do odczytów GPS drona (najmniejsze kwadraty przy znanej skali).
 * Zwraca (lat0, lon0) punktu (0,0) oraz średni błąd GPS w metrach.
 */
export function fitGpsAnchor(gps: GpsFix[], tr: Trajectory): { lat0: number; lon0: number; residualM: number } {
  if (gps.length === 0) throw new Error('Brak odczytów GPS');
  const lat0Guess = gps[0].lat;
  const kLon = mPerDegLon(lat0Guess);
  let sLat = 0, sLon = 0;
  const pts = gps.map(g => {
    const p = trajectoryAt(tr, g.t);
    return { g, x: p[0], y: p[1] };
  });
  for (const { g, x, y } of pts) {
    sLat += g.lat - y / M_PER_DEG_LAT;
    sLon += g.lon - x / kLon;
  }
  const lat0 = sLat / pts.length;
  const lon0 = sLon / pts.length;
  let se = 0;
  for (const { g, x, y } of pts) {
    const dy = (g.lat - lat0) * M_PER_DEG_LAT - y;
    const dx = (g.lon - lon0) * kLon - x;
    se += dx * dx + dy * dy;
  }
  return { lat0, lon0, residualM: Math.sqrt(se / pts.length) };
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Pole wielokąta w m² (współrzędne lokalne). */
export function polygonArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}
