import type { Feature, Polygon } from 'geojson';
import { localToLngLat } from '../../sim/geo';

/**
 * Obszar obejmujący miejsce zdarzenia z danych symulacji (remiza + zakład przemysłowy),
 * w prawdziwej lokalizacji z GPS drona. Wymiary w metrach w układzie świata Gazebo.
 */
export const SIM_ORIGIN = { lat0: 52.2296993, lon0: 21.0121988, mode: 'gps' as const };

export function simSitePreset(): Feature<Polygon> {
  const corners: [number, number][] = [[-8, -16], [44, -16], [44, 16], [-8, 16]];
  const ring = corners.map(([x, y]) => localToLngLat(SIM_ORIGIN, x, y));
  ring.push(ring[0]);
  return { type: 'Feature', properties: { name: 'Remiza — gruzowisko (symulacja)' }, geometry: { type: 'Polygon', coordinates: [ring] } };
}
